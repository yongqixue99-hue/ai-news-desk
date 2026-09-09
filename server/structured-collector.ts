import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { parseKnowledgeIndex } from "./official-knowledge.js";
import { officialIndexRoute } from "./official-news-index.js";
import { createSourceRouteReader, SourceRouteReadError, type SourceRouteReader } from "./source-route-cache.js";
import { workflowRoot } from "./workspace-paths.js";
import path from "node:path";
import { verifyOfficialPublicationDates } from "./official-publication-date.js";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";
import { routedFeedsForSource, sourceRoleFor } from "./source-routing.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
  SourceRouteResult,
} from "./types.js";

const maximumFeedBytes = 4 * 1024 * 1024;
const maximumItemsPerFeed = 100;
const minimumSharedSitemapLastmodCount = 10;
const sitemapSourceOrderReserve = Math.floor(maximumItemsPerFeed / 2);
const hackerNewsTopStories = "https://hacker-news.firebaseio.com/v0/topstories.json";
const defaultRouteReader = createSourceRouteReader({ cacheDirectory: path.join(workflowRoot, "source-cache") });

type CollectorFetcher = (url: string | URL, init: RequestInit) => Promise<Response>;

const requestSignal = (signal: AbortSignal | undefined, timeoutMs: number) => signal
  ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
  : AbortSignal.timeout(timeoutMs);

const collectionError = (error: unknown) => {
  if (!(error instanceof Error)) return "来源读取失败";
  if (error.name === "TimeoutError") return "读取超时，请检查网络或该来源的可用性";
  const cause = error.cause as { code?: string } | undefined;
  const networkErrors: Record<string, string> = {
    UND_ERR_CONNECT_TIMEOUT: "连接超时", ETIMEDOUT: "连接超时", ECONNRESET: "连接被中断",
    ENOTFOUND: "域名解析失败", EAI_AGAIN: "域名解析暂时失败",
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: "证书验证失败", CERT_HAS_EXPIRED: "证书已过期",
  };
  return (networkErrors[cause?.code ?? ""] ?? error.message).slice(0, 500);
};

export interface PortableStructuredCollectionOptions {
  fetcher?: CollectorFetcher;
  now?: () => Date;
  signal?: AbortSignal;
  routeReader?: SourceRouteReader;
}

const normalizedText = (value: string) => value.replace(/\s+/g, " ").trim();

const plainText = (value: string) => {
  if (!value.trim()) return "";
  const spacedBlocks = value
    .replace(/<br\s*\/?\s*>/giu, " ")
    .replace(/<\/(?:p|div|li|blockquote|h[1-6]|pre)>/giu, "$& ");
  return normalizedText(cheerio.load(`<body>${spacedBlocks}</body>`).text());
};

const validDate = (value: string) => {
  const parsed = new Date(value.trim());
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : undefined;
};

const stableItemId = (sourceType: string, value: string) =>
  `${sourceType}:${createHash("sha1").update(value).digest("hex").slice(0, 20)}`;

const directChild = (
  $: cheerio.CheerioAPI,
  entry: cheerio.Cheerio<AnyNode>,
  names: readonly string[],
) => {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  for (const node of entry.children().toArray()) {
    const rawName = "name" in node && typeof node.name === "string" ? node.name : "";
    const localName = rawName.toLowerCase().split(":").at(-1) ?? "";
    if (wanted.has(localName)) return normalizedText($(node).text());
  }
  return "";
};

const entryLink = (
  $: cheerio.CheerioAPI,
  entry: cheerio.Cheerio<AnyNode>,
) => {
  const links = entry.children().filter((_index, node) => {
    const rawName = "name" in node && typeof node.name === "string" ? node.name : "";
    return rawName.toLowerCase().split(":").at(-1) === "link";
  });
  for (const node of links.toArray()) {
    const link = $(node);
    const rel = (link.attr("rel") || "alternate").toLowerCase();
    const candidate = link.attr("href") || normalizedText(link.text());
    if (candidate && (rel === "alternate" || !link.attr("rel"))) return candidate;
  }
  return directChild($, entry, ["guid", "id"]);
};

const absoluteHttpUrl = (value: string, baseUrl: string) => {
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

export const parsePortableFeed = (
  xml: string,
  input: {
    feedUrl: string;
    feedName: string;
    sourceId: string;
    sourceRole: NonNullable<SourceConfig["role"]>;
    category: string;
    fetchedAt: string;
  },
): RawHorizonItem[] => {
  const $ = cheerio.load(xml, { xmlMode: true });
  const root = $.root().children().first().get(0);
  const format = root && "name" in root ? root.name.toLowerCase().split(":").at(-1) : "";
  if (format === "sitemapindex") throw new Error("此地址是 sitemap 目录索引，请配置具体的文章 sitemap 路线");
  if (!["rss", "rdf", "feed", "urlset"].includes(format ?? "")
    || (format === "rss" && !$("rss > channel").length)) {
    throw new Error("返回内容不是可识别的 RSS、Atom 或文章 sitemap，可能是网页、登录页或访问验证页");
  }
  const entries = $("item, entry").toArray().slice(0, maximumItemsPerFeed);
  if (!entries.length) {
    const parsedSitemapEntries = $("urlset > url").toArray()
      .map((node) => {
        const entry = $(node);
        const url = absoluteHttpUrl(directChild($, entry, ["loc"]), input.feedUrl);
        if (!url) return undefined;
        const publishedAt = validDate(directChild($, entry, ["lastmod"]));
        let title = "website update";
        try {
          const segment = decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).at(-1) ?? "");
          title = segment.replace(/\.[a-z0-9]+$/iu, "").replace(/[-_]+/gu, " ").trim() || title;
        } catch {
          // The URL was already validated; keep a neutral title if decoding fails.
        }
        return {
          url,
          title,
          publishedAt,
        };
      })
      .filter((entry): entry is { url: string; title: string; publishedAt: string | undefined } => Boolean(entry));
    const lastmodCounts = new Map<string, number>();
    for (const entry of parsedSitemapEntries) {
      if (!entry.publishedAt) continue;
      lastmodCounts.set(entry.publishedAt, (lastmodCounts.get(entry.publishedAt) ?? 0) + 1);
    }
    const normalizedSitemapEntries = parsedSitemapEntries
      .map((entry) => {
        const sharedBatch = Boolean(
          entry.publishedAt
          && (lastmodCounts.get(entry.publishedAt) ?? 0) >= minimumSharedSitemapLastmodCount,
        );
        return {
          ...entry,
          publishedAt: sharedBatch ? undefined : entry.publishedAt,
          lastmodStatus: sharedBatch
            ? "shared-batch"
            : entry.publishedAt
              ? "declared"
              : "missing",
        };
      });
    const newestDeclaredEntries = normalizedSitemapEntries
      .filter((entry) => Boolean(entry.publishedAt))
      .sort((left, right) => {
        const rightTime = Date.parse(right.publishedAt ?? "");
        const leftTime = Date.parse(left.publishedAt ?? "");
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      });
    // Some publishers rebuild a large leading section of their sitemap with
    // one shared lastmod. That value is not a publication date, but the source
    // order is still an important discovery signal. Reserve half the bounded
    // result for leading URLs, then fill from trustworthy declared dates.
    const sitemapEntries: typeof normalizedSitemapEntries = [];
    const seenUrls = new Set<string>();
    for (const entry of [
      ...normalizedSitemapEntries.slice(0, sitemapSourceOrderReserve),
      ...newestDeclaredEntries,
      ...normalizedSitemapEntries,
    ]) {
      if (seenUrls.has(entry.url)) continue;
      seenUrls.add(entry.url);
      sitemapEntries.push(entry);
      if (sitemapEntries.length >= maximumItemsPerFeed) break;
    }
    return sitemapEntries.map((entry) => ({
      id: stableItemId("rss", `${input.sourceId}:${entry.url}`),
      source_type: "rss",
      title: entry.title.slice(0, 500),
      url: entry.url,
      content: `Official website update: ${entry.title}`,
      published_at: entry.publishedAt,
      fetched_at: input.fetchedAt,
      metadata: {
        feed_name: input.feedName,
        feed_url: input.feedUrl,
        source_id: input.sourceId,
        source_role: input.sourceRole,
        source_format: "sitemap",
        date_basis: "sitemap-lastmod",
        sitemap_lastmod_status: entry.lastmodStatus,
        category: input.category,
        collector: "portable-typescript",
      },
    } satisfies RawHorizonItem));
  }
  return entries.flatMap((node) => {
    const entry = $(node);
    const title = plainText(directChild($, entry, ["title"]));
    const rawUrl = entryLink($, entry);
    const url = absoluteHttpUrl(rawUrl, input.feedUrl);
    if (!title || !url) return [];
    const content = plainText(directChild($, entry, ["encoded", "content", "summary", "description"]));
    const author = plainText(directChild($, entry, ["creator", "author"]));
    const declaredPublication = directChild($, entry, ["pubdate", "published", "date"]);
    const modifiedAt = validDate(directChild($, entry, ["updated"]));
    const publishedAt = declaredPublication ? validDate(declaredPublication) : modifiedAt;
    const identity = directChild($, entry, ["guid", "id"]) || url;
    return [{
      id: stableItemId("rss", `${input.sourceId}:${identity}`),
      source_type: "rss",
      title: title.slice(0, 500),
      url,
      content: content.slice(0, 12_000) || undefined,
      author: author.slice(0, 180) || undefined,
      published_at: publishedAt,
      fetched_at: input.fetchedAt,
      metadata: {
        feed_name: input.feedName,
        feed_url: input.feedUrl,
        source_id: input.sourceId,
        source_role: input.sourceRole,
        source_format: "feed",
        date_basis: new URL(input.feedUrl).hostname === "news.google.com" ? "news-index" : declaredPublication ? "feed-published" : "feed-updated",
        ...(modifiedAt ? { modified_at: modifiedAt } : {}),
        category: input.category,
        collector: "portable-typescript",
      },
    } satisfies RawHorizonItem];
  });
};

const indexMatchStopWords = new Set([
  "a", "an", "and", "the", "of", "for", "in", "on", "to", "with", "new", "generation", "intelligence",
  "introducing", "introduces", "introduced", "releases", "released", "launches", "launched", "announcing",
  "openai", "anthropic", "official", "com", "www",
]);
const indexMatchTokens = (value: string) => new Set(value.normalize("NFKC").toLowerCase()
  .split(/[^\p{L}\p{N}]+/u).filter((word) => word && !indexMatchStopWords.has(word)));

/** Resolve unambiguous publisher links and prefer original RSS publication
 * evidence. Preserve the index's observed date separately from event time. */
export const resolveOfficialFeedLinks = (items: RawHorizonItem[], source: SourceConfig) => {
  if (sourceRoleFor(source) !== "official" || !source.homepageUrl) return items;
  const owner = new URL(source.homepageUrl).hostname.replace(/^www\./u, "");
  const indexed = items.filter((item) => {
    const url = new URL(item.url);
    return url.hostname === owner || url.hostname.endsWith(`.${owner}`);
  });
  return items.map((item) => {
    if (new URL(item.url).hostname !== "news.google.com") return item;
    const title = indexMatchTokens(item.title);
    const matches = indexed.map((entry) => {
      const slug = decodeURIComponent(new URL(entry.url).pathname.split("/").filter(Boolean).at(-1) ?? "");
      const tokens = indexMatchTokens(slug);
      const shared = [...tokens].filter((word) => title.has(word)).length;
      return { entry, shared, valid: shared >= 3 && shared === tokens.size && shared / Math.max(1, title.size) >= 0.65 };
    }).filter((match) => match.valid).sort((a, b) => b.shared - a.shared);
    const best = matches[0];
    const identity = (entry: RawHorizonItem) => entry.url.replace(/\/$/u, "");
    if (!best || matches.some((match) => match.shared === best.shared && identity(match.entry) !== identity(best.entry))) return item;
    const publications = matches.filter((match) => identity(match.entry) === identity(best.entry)
      && match.entry.metadata?.date_basis === "feed-published" && match.entry.published_at);
    const dates = new Set(publications.map((match) => match.entry.published_at));
    const original = dates.size === 1 ? publications[0]?.entry : undefined;
    return { ...item, ...(original ? { published_at: original.published_at } : {}), metadata: { ...item.metadata,
      canonical_url: best.entry.url, canonical_evidence: "publisher-index",
      ...(original ? { date_basis: "publisher-feed", indexed_at: item.published_at,
        date_source_url: original.url, date_publication_precision: "timestamp" } : {}),
    } };
  });
};

const collectFeed = async (
  source: SourceConfig,
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">,
  fetcher: CollectorFetcher,
  fetchedAt: string,
  signal?: AbortSignal,
  routeReader?: SourceRouteReader,
) => {
  const feeds = routedFeedsForSource(source, topicIds, filters);
  if (!feeds.length) throw new Error("当前频道没有可读取的来源路线");
  const attempts = await Promise.allSettled(feeds.map(async (feed) => {
    const index = officialIndexRoute(feed.format, feed.url);
    return (routeReader ?? createSourceRouteReader({ fetcher: (url, init) => fetcher(url, init ?? {}) })).read({
      sourceId: source.id, url: index?.requestUrl ?? feed.url, format: feed.format ?? "feed",
      parserVersion: `dated-events-v2:${source.name}:${sourceRoleFor(source)}:${feed.category}`,
      maxBytes: index?.maxBytes ?? maximumFeedBytes,
      init: {
      signal: requestSignal(signal, 18_000),
      headers: {
        accept: index?.accept ?? "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        ...(feed.format === "gemini-changelog" ? { "accept-language": "en-US,en;q=0.9" } : {}),
        "user-agent": "AI-News-Desk/0.2 (portable collector)",
      },
      },
      parse: (content) => index ? index.parse(content, source, fetchedAt) : parsePortableFeed(content, {
      feedUrl: feed.url,
      feedName: feed.name,
      sourceId: source.id,
      sourceRole: sourceRoleFor(source),
      category: feed.category,
      fetchedAt,
      }),
    });
  }));
  const items = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? attempt.value.items : []);
  const routes = attempts.map((attempt, index): SourceRouteResult => ({
    sourceId: source.id,
    url: feeds[index]!.url,
    status: attempt.status === "fulfilled" ? "success" : "error",
    rawCount: attempt.status === "fulfilled" ? attempt.value.items.length : 0,
    ...(attempt.status === "fulfilled" ? { cacheStatus: attempt.value.cacheStatus, lastSuccessfulAt: attempt.value.lastSuccessfulAt,
      ...(attempt.value.cacheStatus === "not-modified" ? { detail: "官方确认内容未变化，沿用已解析记录" } : {}) }
      : { detail: collectionError(attempt.reason), ...(attempt.reason instanceof SourceRouteReadError ? {
        errorCode: attempt.reason.code, retryAt: attempt.reason.retryAt, httpStatus: attempt.reason.statusCode,
      } : {}) }),
  }));
  return { items: resolveOfficialFeedLinks(items, source), routes };
};

interface HackerNewsItem {
  id?: number;
  by?: string;
  descendants?: number;
  score?: number;
  time?: number;
  title?: string;
  text?: string;
  type?: string;
  url?: string;
  deleted?: boolean;
  dead?: boolean;
}

const collectHackerNews = async (
  source: SourceConfig,
  fetcher: CollectorFetcher,
  fetchedAt: string,
  signal?: AbortSignal,
) => {
  const topResponse = await fetcher(hackerNewsTopStories, {
    signal: requestSignal(signal, 12_000),
    headers: { accept: "application/json", "user-agent": "AI-News-Desk/0.2" },
  });
  if (!topResponse.ok) throw new Error(`Hacker News 返回 HTTP ${topResponse.status}`);
  const ids = (await topResponse.json() as unknown[])
    .map(Number)
    .filter((id) => Number.isSafeInteger(id) && id > 0)
    .slice(0, 50);
  const items: RawHorizonItem[] = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < ids.length && !signal?.aborted) {
      const id = ids[cursor++];
      try {
        const response = await fetcher(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
          signal: requestSignal(signal, 8_000),
          headers: { accept: "application/json", "user-agent": "AI-News-Desk/0.2" },
        });
        if (!response.ok) continue;
        const item = await response.json() as HackerNewsItem;
        if (item.deleted || item.dead || item.type !== "story" || !item.id || !item.title) continue;
        const discussionUrl = `https://news.ycombinator.com/item?id=${item.id}`;
        items.push({
          id: `hackernews:${item.id}`,
          source_type: "hackernews",
          title: item.title,
          url: absoluteHttpUrl(item.url || discussionUrl, discussionUrl) || discussionUrl,
          content: plainText(item.text || "").slice(0, 12_000) || undefined,
          author: item.by,
          published_at: item.time ? new Date(item.time * 1_000).toISOString() : undefined,
          fetched_at: fetchedAt,
          metadata: {
            feed_name: source.name,
            source_id: source.id,
            source_role: "community",
            score: item.score ?? 0,
            descendants: item.descendants ?? 0,
            discussion_url: discussionUrl,
            collector: "portable-typescript",
          },
        });
      } catch {
        // One removed or temporarily unavailable HN item must not fail the batch.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, ids.length) }, worker));
  return items;
};

export const collectPortableStructuredSources = async (
  sources: SourceConfig[],
  request: {
    topicIds: CollectionTopicId[];
    filters?: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">;
    signal?: AbortSignal;
  },
  options: PortableStructuredCollectionOptions = {},
) => {
  const fetcher = options.fetcher ?? ((url, init) => fetchRemote(url, init, 3));
  const routeReader = options.routeReader ?? (options.fetcher ? createSourceRouteReader({ fetcher: (url, init) => fetcher(url, init ?? {}), now: options.now }) : defaultRouteReader);
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const failures: Record<string, string> = {};
  const routeResults: SourceRouteResult[][] = sources.map(() => []);
  const signal = options.signal ?? request.signal;
  const collected: RawHorizonItem[][] = Array.from({ length: sources.length }, () => []);
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length && !signal?.aborted) {
      const index = cursor++;
      const source = sources[index];
      try {
        if (source.kind === "documentation") {
          const response = await fetcher(source.url || source.homepageUrl || "", { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(18_000)]) : AbortSignal.timeout(18_000), headers: { accept: "text/html", "user-agent": "AI-News-Desk/0.2 (official learning index)" } });
          if (!response.ok) { await response.body?.cancel(); throw new Error(`技术目录返回 HTTP ${response.status}`); }
          collected[index] = parseKnowledgeIndex((await readResponseBuffer(response, maximumFeedBytes)).toString("utf8"), source, fetchedAt);
          if (!collected[index].length) throw new Error("技术目录未识别到文章链接，请检查页面结构");
          continue;
        }
        if (source.kind === "hackernews") {
          collected[index] = await collectHackerNews(source, fetcher, fetchedAt, signal);
          continue;
        }
        const feed = await collectFeed(
          source,
          request.topicIds,
          request.filters ?? {},
          fetcher,
          fetchedAt,
          signal,
          routeReader,
        );
        collected[index] = feed.items;
        routeResults[index] = feed.routes;
        if (feed.routes.every((route) => route.status === "error")) {
          failures[source.id] = feed.routes.map((route) => route.detail).join("；").slice(0, 700);
        }
      } catch (error) {
        failures[source.id] = collectionError(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, worker));
  const items = await verifyOfficialPublicationDates(collected.flat(), { routeReader, signal, now: options.now });
  return {
    items,
    failures,
    routeResults: routeResults.flat(),
    horizonRunId: `portable_${fetchedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
  };
};
