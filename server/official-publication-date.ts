import * as cheerio from "cheerio";
import { SourceRouteReadError, type SourceRouteReader } from "./source-route-cache.js";
import type { RawHorizonItem } from "./types.js";

const maximumPageBytes = 2 * 1024 * 1024;
const maximumChecks = 6;
const maximumDateClaims = 32;
const articleTypes = new Set(["Article", "NewsArticle", "BlogPosting", "TechArticle", "Report", "ScholarlyArticle", "AnalysisNewsArticle", "ReportageNewsArticle"]);
type DateClaim = { value: string; iso: string; day: string; dateOnly: boolean; basis: "article:published_time" | "jsonld:datePublished" };

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const clean = (value: unknown, limit: number) => {
  if (typeof value !== "string") return "";
  const $ = cheerio.load(value);
  $("script, style, noscript").remove();
  return $.root().text().replace(/\s+/gu, " ").trim().slice(0, limit);
};
const parseDate = (value: unknown, basis: DateClaim["basis"]): DateClaim | undefined => {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  // A timezone-free clock time is ambiguous. A declared calendar day is retained at day precision.
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/iu.test(raw)) return undefined;
  const day = raw.slice(0, 10);
  const dayValue = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(dayValue) || new Date(dayValue).toISOString().slice(0, 10) !== day) return undefined;
  const valueMs = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  if (!Number.isFinite(valueMs)) return undefined;
  return { value: raw, iso: new Date(valueMs).toISOString(), day, dateOnly: raw.length === 10, basis };
};

const samePage = (value: string, originalUrl: string) => {
  try {
    const current = new URL(originalUrl);
    const linked = new URL(value, current);
    return ["https:", "http:"].includes(linked.protocol) && !linked.username && !linked.password
      && current.origin === linked.origin
      && current.pathname.replace(/\/$/u, "") === linked.pathname.replace(/\/$/u, "")
      && current.search === linked.search;
  } catch { return false; }
};

const articleIdentities = (value: unknown): string[] => {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(articleIdentities);
  if (record(value)) return [value["@id"], value.url].filter((entry): entry is string => typeof entry === "string");
  return [];
};

const applicableArticles = (values: unknown[], originalUrl: string) => {
  const articles: Record<string, unknown>[] = [];
  const queue = values.map((value) => ({ value, depth: 0 }));
  for (let visited = 0; queue.length && visited < 2000; visited += 1) {
    const { value, depth } = queue.shift()!;
    if (depth > 12) continue;
    if (Array.isArray(value)) {
      queue.push(...value.slice(0, 2000 - visited).map((entry) => ({ value: entry, depth: depth + 1 })));
      continue;
    }
    if (!record(value)) continue;
    const types = Array.isArray(value["@type"]) ? value["@type"] : [value["@type"]];
    if (types.some((type) => typeof type === "string" && articleTypes.has(type.split(/[\/#]/u).at(-1)!))) {
      const identities = [value.url, value["@id"], value.mainEntityOfPage].flatMap(articleIdentities);
      // Related articles and cross-site canonical identities are not publication evidence for this URL.
      if (!identities.length || identities.every((identity) => samePage(identity, originalUrl))) articles.push(value);
    }
    // Only top-level graph members and the page's main entity describe this publication.
    // Walking arbitrary properties would treat related-item lists or citations as this article.
    const children = [value["@graph"], value.mainEntity].filter((entry) => record(entry) || Array.isArray(entry));
    queue.push(...children.map((entry) => ({ value: entry, depth: depth + 1 })));
  }
  return articles;
};

const authorNames = (value: unknown): string[] => {
  if (typeof value === "string") return [clean(value, 180)];
  if (Array.isArray(value)) return value.slice(0, 3).flatMap(authorNames);
  return record(value) ? [clean(value.name, 180)] : [];
};

const parsePublicationPage = (html: string, item: RawHorizonItem): RawHorizonItem => {
  const $ = cheerio.load(html);
  const meta = new Map<string, string[]>();
  $("meta").each((_index, element) => {
    const key = ($(element).attr("property") ?? $(element).attr("name") ?? "").toLowerCase();
    if (!key) return;
    const values = meta.get(key) ?? [];
    values.push($(element).attr("content") ?? "");
    meta.set(key, values);
  });
  const structured: unknown[] = [];
  $("script").each((_index, element) => {
    if (($(element).attr("type") ?? "").toLowerCase().split(";")[0].trim() !== "application/ld+json") return;
    try { structured.push(JSON.parse($(element).text())); } catch { /* Unparseable JSON is not evidence. */ }
  });
  const articles = applicableArticles(structured, item.url);
  const declared: Array<{ value: unknown; basis: DateClaim["basis"] }> = [
    ...(meta.get("article:published_time") ?? []).map((value) => ({ value, basis: "article:published_time" as const })),
    ...articles.filter((article) => Object.hasOwn(article, "datePublished")).map((article) => ({ value: article.datePublished, basis: "jsonld:datePublished" as const })),
  ];
  const claims = declared.slice(0, maximumDateClaims).map((value) => parseDate(value.value, value.basis));
  let unavailable: string | undefined;
  if (!declared.length) unavailable = "missing-publication-date";
  else if (declared.length > maximumDateClaims) unavailable = "too-many-publication-dates";
  else if (claims.some((claim) => !claim)) unavailable = "invalid-publication-date";
  const dates = claims.filter((claim): claim is DateClaim => Boolean(claim));
  const precise = dates.filter((claim) => !claim.dateOnly);
  const days = dates.filter((claim) => claim.dateOnly);
  if (!unavailable && (new Set(precise.map((claim) => claim.iso)).size > 1
    || new Set(days.map((claim) => claim.day)).size > 1
    || (days.length && precise.some((claim) => claim.day !== days[0].day)))) unavailable = "conflicting-publication-dates";
  if (unavailable) return { ...item, published_at: undefined, metadata: {
    ...item.metadata, date_verification: "unavailable", date_verification_reason: unavailable,
  } };

  const chosen = precise[0] ?? dates[0];
  $("script, style, nav, footer, aside, form, noscript, svg").remove();
  const root = $("article").first().length ? $("article").first() : $("main").first();
  const headline = articles.map((article) => clean(article.headline, 500)).find(Boolean);
  const title = clean(meta.get("og:title")?.[0], 500) || clean(root.find("h1").first().text(), 500)
    || headline || clean($("h1").first().text(), 500) || clean($("title").first().text(), 500) || item.title;
  const description = clean(meta.get("description")?.[0] ?? meta.get("og:description")?.[0], 2000)
    || articles.map((article) => clean(article.description, 2000)).find(Boolean);
  const body = clean(root.find("p").toArray().slice(0, 4).map((element) => $(element).text()).join(" "), 2000)
    || articles.map((article) => clean(article.articleBody, 2000)).find(Boolean);
  const author = clean(meta.get("author")?.[0], 180) || articles.flatMap((article) => authorNames(article.author)).filter(Boolean).slice(0, 3).join("、").slice(0, 180) || item.author;
  return { ...item, title, content: description || body || item.content, author, published_at: chosen.iso, metadata: {
    ...item.metadata, sitemap_original_title: item.title, date_verification: "verified",
    date_verification_basis: [...new Set(dates.map((claim) => claim.basis))],
    date_publication_evidence: dates.map((claim) => ({ value: claim.value, basis: claim.basis })),
    date_publication_precision: chosen.dateOnly ? "day" : "timestamp",
  } };
};

const releasePriority = (title: string) => {
  const release = /\b(?:introduc\w*|launch\w*|releas\w*|announc\w*)\b|发布|推出|上线|开源/iu.test(title);
  const product = /\b(?:models?|gpt\w*|claude|gemini|deepseek|qwen|llama|api|assistant|products?)\b|模型|产品|助手/iu.test(title);
  return Number(release) * 2 + Number(product);
};

/** Recover a small number of original publication dates before the collection's time gate. */
export const verifyOfficialPublicationDates = async (items: RawHorizonItem[], options: {
  routeReader: SourceRouteReader;
  signal?: AbortSignal;
  now?: () => Date;
  maxChecks?: number;
}): Promise<RawHorizonItem[]> => {
  options.signal?.throwIfAborted();
  const limit = Math.max(0, Math.min(maximumChecks, Number.isFinite(options.maxChecks) ? Math.floor(options.maxChecks!) : maximumChecks));
  const result = [...items];
  const eligible = items.map((item, index) => ({ item, index }))
    .filter(({ item }) => item.metadata?.source_role === "official" && item.metadata?.source_format === "sitemap" && !item.published_at?.trim())
    .sort((left, right) => releasePriority(right.item.title) - releasePriority(left.item.title) || left.index - right.index);
  for (const { item, index } of eligible) result[index] = { ...item, published_at: undefined, metadata: { ...item.metadata, date_verification: "pending-limit" } };
  const selected = eligible.slice(0, limit);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(2, selected.length) }, async () => {
    while (next < selected.length) {
      options.signal?.throwIfAborted();
      const { item, index } = selected[next++];
      const checkedAt = (options.now?.() ?? new Date()).toISOString();
      try {
        const timeout = AbortSignal.timeout(18_000);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
        const read = await options.routeReader.read({
          sourceId: typeof item.metadata?.source_id === "string" ? item.metadata.source_id : "official",
          url: item.url, format: "official-publication-html", parserVersion: "publication-date-v1", samePageOnly: true, maxBytes: maximumPageBytes,
          init: { signal, headers: { accept: "text/html,application/xhtml+xml", "user-agent": "AI-News-Desk/0.2 (publication date verifier)" } },
          parse: (html) => [parsePublicationPage(html, item)],
        });
        options.signal?.throwIfAborted();
        const page = read.items.length === 1 && read.items[0].url === item.url ? read.items[0] : undefined;
        const verified = page?.metadata?.date_verification === "verified"
          && Boolean(parseDate(page.published_at, "article:published_time"));
        if (!page) throw new Error("Cached page identity mismatch");
        result[index] = { ...item,
          ...(verified ? { title: page.title, content: page.content, author: page.author, published_at: page.published_at } : { published_at: undefined }),
          metadata: { ...item.metadata,
            date_verification: verified ? "verified" : "unavailable",
            date_verification_checked_at: checkedAt,
            date_verification_cache_status: read.cacheStatus,
            ...(verified ? {
              sitemap_original_title: item.title, date_verification_basis: page.metadata?.date_verification_basis,
              date_publication_evidence: page.metadata?.date_publication_evidence, date_publication_precision: page.metadata?.date_publication_precision,
            } : { date_verification_reason: page.metadata?.date_verification_reason ?? "missing-publication-date" }),
          },
        };
      } catch (error) {
        options.signal?.throwIfAborted();
        result[index] = { ...item, published_at: undefined, metadata: { ...item.metadata,
          date_verification: "unavailable", date_verification_checked_at: checkedAt,
          date_verification_reason: error instanceof SourceRouteReadError ? error.code : "unverifiable-page",
          ...(error instanceof SourceRouteReadError && error.retryAt ? { date_verification_retry_at: error.retryAt } : {}),
        } };
      }
    }
  }));
  options.signal?.throwIfAborted();
  return result;
};
