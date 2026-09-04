import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { AnyNode } from "domhandler";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";
import { routedFeedsForSource, sourceRoleFor } from "./source-routing.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
} from "./types.js";

const maximumFeedBytes = 4 * 1024 * 1024;
const maximumItemsPerFeed = 100;
const minimumSharedSitemapLastmodCount = 10;
const sitemapSourceOrderReserve = Math.floor(maximumItemsPerFeed / 2);
const hackerNewsTopStories = "https://hacker-news.firebaseio.com/v0/topstories.json";

type CollectorFetcher = (url: string | URL, init: RequestInit) => Promise<Response>;

export interface PortableStructuredCollectionOptions {
  fetcher?: CollectorFetcher;
  now?: () => Date;
  signal?: AbortSignal;
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
    const publishedAt = validDate(directChild($, entry, ["pubdate", "published", "updated", "date"]));
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
        category: input.category,
        collector: "portable-typescript",
      },
    } satisfies RawHorizonItem];
  });
};

const collectFeed = async (
  source: SourceConfig,
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">,
  fetcher: CollectorFetcher,
  fetchedAt: string,
  signal?: AbortSignal,
) => {
  const feeds = routedFeedsForSource(source, topicIds, filters);
  const attempts = await Promise.allSettled(feeds.map(async (feed) => {
    const response = await fetcher(feed.url, {
      signal: signal ?? AbortSignal.timeout(18_000),
      headers: {
        accept: "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
        "user-agent": "AI-News-Desk/0.2 (portable collector)",
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`${feed.name} 返回 HTTP ${response.status}`);
    }
    const xml = (await readResponseBuffer(response, maximumFeedBytes)).toString("utf8");
    return parsePortableFeed(xml, {
      feedUrl: feed.url,
      feedName: feed.name,
      sourceId: source.id,
      sourceRole: sourceRoleFor(source),
      category: feed.category,
      fetchedAt,
    });
  }));
  const items = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? attempt.value : []);
  if (!items.length && attempts.some((attempt) => attempt.status === "rejected")) {
    const reasons = attempts.flatMap((attempt) =>
      attempt.status === "rejected"
        ? [attempt.reason instanceof Error ? attempt.reason.message : String(attempt.reason)]
        : []);
    throw new Error(reasons.join("；").slice(0, 700));
  }
  return items;
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
    signal: signal ?? AbortSignal.timeout(12_000),
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
          signal: signal ?? AbortSignal.timeout(8_000),
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
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const failures: Record<string, string> = {};
  const signal = options.signal ?? request.signal;
  const collected: RawHorizonItem[][] = Array.from({ length: sources.length }, () => []);
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length && !signal?.aborted) {
      const index = cursor++;
      const source = sources[index];
      try {
        if (source.kind === "hackernews") {
          collected[index] = await collectHackerNews(source, fetcher, fetchedAt, signal);
          continue;
        }
        collected[index] = await collectFeed(
          source,
          request.topicIds,
          request.filters ?? {},
          fetcher,
          fetchedAt,
          signal,
        );
      } catch (error) {
        failures[source.id] = error instanceof Error ? error.message : String(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, sources.length) }, worker));
  return {
    items: collected.flat(),
    failures,
    horizonRunId: `portable_${fetchedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`,
  };
};
