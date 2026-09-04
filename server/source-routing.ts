import { collectionTopics, normalizeTopicIds, queryForTopics } from "./topics.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  SourceConfig,
  SourceRoute,
} from "./types.js";

export const allCollectionTopicIds = collectionTopics.map((topic) => topic.id);

export const googleNewsFeed = (query: string) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

export const keywordTerms = (input?: string) =>
  (input ?? "")
    .split(/[,，\n]+/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 8);

const nextDate = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
};

const quoteQueryTerm = (value: string) => {
  const cleaned = value.replace(/["()]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.includes(" ") ? `"${cleaned}"` : cleaned;
};

const modelVersionAliases = (value: string) => {
  const cleaned = value.normalize("NFKC").replace(/\s+/g, " ").trim();
  const match = /^([a-z]+)[\s_-]*(\d+(?:\.\d+)*)$/iu.exec(cleaned);
  if (!match) return [quoteQueryTerm(cleaned)].filter(Boolean);
  const [, family, version] = match;
  return [family + version, `"${family}-${version}"`, `"${family} ${version}"`];
};

export const buildDiscoveryQuery = (
  baseQuery: string,
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords"> = {},
) => {
  const terms = keywordTerms(filters.keywords);
  const keywordQuery = terms.length
    ? `(${[...new Set(terms.flatMap(modelVersionAliases))].join(" OR ")})`
    : "";
  return [
    baseQuery,
    keywordQuery,
    filters.dateFrom ? `after:${filters.dateFrom}` : "",
    filters.dateTo ? `before:${nextDate(filters.dateTo)}` : "",
  ].filter(Boolean).join(" ");
};

export const sourceTopicIds = (source: SourceConfig): CollectionTopicId[] => {
  const configured = source.topicIds?.length
    ? source.topicIds
    : source.routes?.map((route) => route.topicId);
  return normalizeTopicIds(configured ?? ["ai"]);
};

export const sourceRoleFor = (source: SourceConfig): NonNullable<SourceConfig["role"]> => {
  if (source.role) return source.role;
  if (source.kind === "hackernews" || source.kind === "zhihu" || source.kind === "last30days" || source.kind === "github") return "community";
  if (source.discoveryOnly) return "discovery";
  if (source.category === "ai-official" || source.id.includes("official")) return "official";
  if (["science", "politics"].includes(source.category)) return "research";
  return "verification";
};

export const sourceSupportsTopics = (source: SourceConfig, topicIds: CollectionTopicId[]) => {
  const available = new Set(sourceTopicIds(source));
  return normalizeTopicIds(topicIds).some((topicId) => available.has(topicId));
};

export const eligibleSourcesForTopics = (
  sources: Array<SourceConfig | undefined>,
  topicIds: CollectionTopicId[],
) => sources.filter((source): source is SourceConfig =>
  Boolean(source?.enabled && sourceSupportsTopics(source, topicIds)));

export const sourceRoutesFor = (source: SourceConfig, topicIds: CollectionTopicId[]) => {
  const selected = new Set(normalizeTopicIds(topicIds));
  return (source.routes ?? []).filter((route) => selected.has(route.topicId));
};

export interface RoutedFeed {
  name: string;
  url: string;
  category: string;
  profile: "tech-news";
}

export const routedFeedsForSource = (
  source: SourceConfig,
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords"> = {},
): RoutedFeed[] => {
  if (!sourceSupportsTopics(source, topicIds)) return [];
  if (source.kind === "google_news") {
    const baseQuery = source.query?.trim() || queryForTopics(topicIds);
    return [{
      name: source.name,
      url: googleNewsFeed(buildDiscoveryQuery(baseQuery, filters)),
      category: source.category,
      profile: "tech-news",
    }];
  }
  if (source.kind !== "rss") return [];
  const routes = sourceRoutesFor(source, topicIds);
  const candidates: SourceRoute[] = routes.length
    ? routes
    : [{
      topicId: sourceTopicIds(source)[0],
      label: source.name,
      url: source.url,
      query: source.query,
      category: source.category,
    }];
  const seen = new Set<string>();
  return candidates.flatMap((route) => {
    const url = route.query
      ? googleNewsFeed(buildDiscoveryQuery(route.query, filters))
      : route.url;
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{
      name: source.name,
      url,
      category: route.category ?? source.category,
      profile: "tech-news" as const,
    }];
  });
};

export const dynamicTopicQuery = (
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords"> = {},
) => buildDiscoveryQuery(queryForTopics(topicIds), filters);
