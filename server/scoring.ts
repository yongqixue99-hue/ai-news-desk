import { createHash } from "node:crypto";
import { normalizeTopicIds, topicDefinitionsFor } from "./topics.js";
import { keywordTerms } from "./source-routing.js";
import { personalizeCandidates } from "./personalization.js";
import type {
  Candidate,
  CandidateFeedback,
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  ScoreBreakdown,
  SourceImage,
} from "./types.js";

const consequencePattern = /launch|release|announc|acquir|funding|ban|law|regulat|safety|security|chip|model|api|pricing|partnership|lawsuit|fine|breach|open.source|benchmark/i;
const rumorPattern = /rumou?r|reportedly|may launch|could launch|anonymous sources?|leak(?:ed)?/i;
const promotionalEventPattern = /\b(?:(?:co)?workshop|webinar|founder house|register now|join us)\b/i;
const officialPattern = /^(OpenAI|Anthropic|Google DeepMind)$|OpenAI 官方|Anthropic 官方|LPL 官方|LoL Esports|DOTA2 官方|DOTA2 国服|Counter-Strike 官方|CS2 国服|官方|official/i;
const strongMediaPattern = /Reuters|Associated Press|AP AI|BBC|Bloomberg|华盛顿邮报|CNN/i;
const specialistMediaPattern = /TechCrunch|Ars Technica|MIT Technology Review|VentureBeat|IGN|The Verge|Wired|GamesIndustry|Polygon|Dot Esports|HLTV|Inven Global/i;
const publisherSuffixPattern = /\s+(?:[-–—|]\s*)?(?:IGN(?:\s+(?:India|Nordic|Southeast Asia|Africa))?|Reuters|BBC(?:\s+News)?|CNN|Bloomberg|Associated Press|AP News|TechCrunch|Ars Technica|The Washington Post)\s*$/iu;
const titleStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with",
  "new", "official", "video", "news", "says", "say",
]);

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const finiteMetadataNumber = (value: unknown) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
};

const engagementFor = (candidate: Candidate) => {
  const points = candidate.engagement?.points ?? 0;
  const comments = candidate.engagement?.comments ?? 0;
  if (!points && !comments) return 0;
  return clamp(Math.round(Math.log1p(points) * 5.5 + Math.log1p(comments) * 3.3), 0, 50);
};

const freshnessFor = (candidate: Candidate) => {
  const published = Date.parse(candidate.publishedAt);
  if (!Number.isFinite(published)) return 0;
  const hours = Math.max(0, (Date.now() - published) / 3_600_000);
  // Continuous decay avoids every story in a 6- or 12-hour bucket receiving
  // an identical number while still keeping freshness transparent.
  return clamp(Math.round(18 * Math.exp(-hours / 30)), 1, 18);
};

const normalizedStoryTitle = (title: string) => title
  .replace(publisherSuffixPattern, "")
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/g, " ")
  .trim();

const titleTerms = (title: string) => new Set(
  normalizedStoryTitle(title)
    .split(" ")
    .filter((term) => term.length > 1 && !titleStopWords.has(term)),
);

export const titleSimilarity = (left: string, right: string) => {
  const normalizedLeft = normalizedStoryTitle(left);
  const normalizedRight = normalizedStoryTitle(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  if (normalizedLeft === normalizedRight) return 1;
  const leftTerms = titleTerms(left);
  const rightTerms = titleTerms(right);
  if (!leftTerms.size || !rightTerms.size) return 0;
  let intersection = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) intersection += 1;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  const jaccard = intersection / union;
  const containment = intersection / Math.min(leftTerms.size, rightTerms.size);
  return Math.max(jaccard, containment * 0.88);
};

const escapePattern = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const keywordMatches = (text: string, keyword: string) => {
  const escaped = escapePattern(keyword).replace(/\s+/g, "\\s+");
  const ascii = /^[\x00-\x7f]+$/.test(keyword);
  const pattern = ascii
    ? new RegExp(`(?:^|[^a-z0-9])${escaped}(?=$|[^a-z0-9])`, "iu")
    : new RegExp(escaped, "iu");
  return pattern.test(text);
};

const normalizeSearchSeparators = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/(?<=\p{L})[\s_-]+(?=\p{N})/gu, "");

export const topicRelevance = (text: string, topicIds: CollectionTopicId[]) => {
  const definitions = topicDefinitionsFor(normalizeTopicIds(topicIds));
  const matchedTopics = definitions.filter((topic) =>
    topic.keywords.some((keyword) => keywordMatches(text, keyword)),
  );
  return matchedTopics.length ? Math.min(2, 1 + matchedTopics.length) : 0;
};

export const candidateScore = (
  item: RawHorizonItem,
  sourceName: string,
  windowHours: number,
  topicIds: CollectionTopicId[] = ["ai"],
): { total: number; breakdown: ScoreBreakdown; evidence: string } => {
  const text = `${item.title} ${item.content ?? ""}`;
  const ageHours = item.published_at
    ? Math.max(0, (Date.now() - Date.parse(item.published_at)) / 3_600_000)
    : windowHours;
  const relevance = topicRelevance(text, topicIds);
  const consequence = consequencePattern.test(text) ? 4 : relevance ? 2 : 1;
  const novelty = /launch|release|announc|new |first |introduc/i.test(text) ? 3 : 2;
  const evidence = officialPattern.test(sourceName)
    ? 3
    : strongMediaPattern.test(sourceName) || specialistMediaPattern.test(sourceName)
      ? 2
      : 1;
  const timeliness = ageHours <= Math.min(12, windowHours) ? 2 : ageHours <= windowHours ? 1 : 0;
  const confirmation = 0;
  // Workshops and registration pages are useful discovery signals, but they
  // should not tie an actual product/model release merely because they are
  // newer. Keep them eligible while applying a transparent, bounded penalty.
  const rumorPenalty = rumorPattern.test(text) ? 2 : 0;
  const promotionalEventPenalty = promotionalEventPattern.test(`${text} ${item.url}`) ? 2 : 0;
  const penalty = Math.min(4, rumorPenalty + promotionalEventPenalty);
  const breakdown = { consequence, novelty, evidence, relevance, timeliness, confirmation, penalty };
  const total = clamp(
    consequence + novelty + evidence + relevance + timeliness + confirmation - penalty,
    0,
    15,
  );
  const evidenceLabel = officialPattern.test(sourceName)
    ? "一手来源"
    : strongMediaPattern.test(sourceName)
      ? "可靠媒体"
      : specialistMediaPattern.test(sourceName)
        ? "专业媒体"
      : "待交叉核验";
  return { total, breakdown, evidence: evidenceLabel };
};

const sourceNameFor = (item: RawHorizonItem) => {
  if (item.source_type === "hackernews") return "Hacker News";
  const metadata = item.metadata ?? {};
  const feedName = typeof metadata.feed_name === "string" ? metadata.feed_name : undefined;
  return feedName || item.author || item.source_type;
};

const sourceRoleForItem = (item: RawHorizonItem): Candidate["sourceRole"] => {
  const role = item.metadata?.source_role;
  if (["official", "verification", "research", "discovery", "community"].includes(String(role))) {
    return String(role) as Candidate["sourceRole"];
  }
  if (["hackernews", "zhihu", "last30days", "github"].includes(item.source_type)) return "community";
  return undefined;
};

const decodeHtmlEntities = (value: string) => value
  .replace(/&#x([0-9a-f]+);/giu, (_match, point: string) => {
    try {
      return String.fromCodePoint(Number.parseInt(point, 16));
    } catch {
      return " ";
    }
  })
  .replace(/&#(\d+);/gu, (_match, point: string) => {
    try {
      return String.fromCodePoint(Number.parseInt(point, 10));
    } catch {
      return " ";
    }
  })
  .replace(/&(nbsp|amp|quot|apos|lt|gt);/giu, (_match, entity: string) => ({
    nbsp: " ",
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
  })[entity.toLocaleLowerCase()] ?? " ");

const cleanExcerpt = (content: string | undefined, maximum = 360) =>
  decodeHtmlEntities((content ?? "").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximum);

const canonicalUrlForItem = (item: RawHorizonItem) => {
  const value = item.metadata?.canonical_url;
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/u.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const xSourceImagesForItem = (item: RawHorizonItem): SourceImage[] => {
  if (item.source_type !== "x" || !Array.isArray(item.metadata?.x_media)) return [];
  const attribution = item.author?.trim() || "X 官方账号";
  const entityTags = [item.metadata?.x_user_name, item.metadata?.x_username]
    .filter((value): value is string => typeof value === "string" && Boolean(value.trim()))
    .map((value) => value.trim());
  const seen = new Set<string>();
  return item.metadata.x_media.flatMap((rawMedia, index) => {
    if (!rawMedia || typeof rawMedia !== "object") return [];
    const media = rawMedia as Record<string, unknown>;
    const mediaKey = typeof media.media_key === "string" ? media.media_key.trim() : "";
    const rawUrl = typeof media.url === "string" ? media.url.trim() : "";
    if (!mediaKey || !rawUrl || seen.has(mediaKey)) return [];
    try {
      const url = new URL(rawUrl);
      if (!/^https?:$/u.test(url.protocol)) return [];
      seen.add(mediaKey);
      const kind = media.kind === "preview" ? "preview" : "photo";
      const altText = typeof media.alt_text === "string" ? media.alt_text.trim().slice(0, 180) : "";
      const width = finiteMetadataNumber(media.width);
      const height = finiteMetadataNumber(media.height);
      return [{
        id: `x-media:${mediaKey || index}`,
        url: url.toString(),
        caption: altText || `${attribution} 发布的 X ${kind === "preview" ? "视频预览图" : "图片"}`,
        attribution,
        sourceUrl: item.url,
        width: width && width > 0 ? width : undefined,
        height: height && height > 0 ? height : undefined,
        selected: false,
        rights: "check-required",
        evidenceNote: "来自 X 官方账号原帖，仅作新闻线索或评论性引用；发布前必须人工核验转载授权与平台规则。",
        allowedPlatforms: [],
        entityTags,
      } satisfies SourceImage];
    } catch {
      return [];
    }
  });
};

const shanghaiBoundary = (date: string, endExclusive = false) => {
  const value = new Date(`${date}T00:00:00+08:00`);
  if (endExclusive) value.setDate(value.getDate() + 1);
  return value.getTime();
};

export type RawItemTimeRejectionReason =
  | "missing-published-at"
  | "invalid-published-at"
  | "future-published-at"
  | "outside-date-range"
  | "outside-window";

interface RawItemSearchOptions {
  /** Required for automatic collection. Omit when only applying keyword filters. */
  windowHours?: number;
  /** Injectable clock for deterministic filtering and tests. */
  now?: number;
}

export const rawItemTimeRejectionReason = (
  item: RawHorizonItem,
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo"> = {},
  options: RawItemSearchOptions = {},
): RawItemTimeRejectionReason | undefined => {
  const hasExplicitRange = Boolean(filters.dateFrom || filters.dateTo);
  if (!hasExplicitRange && options.windowHours === undefined) return undefined;

  const rawPublishedAt = item.published_at?.trim();
  if (!rawPublishedAt) return "missing-published-at";
  const publishedAt = Date.parse(rawPublishedAt);
  if (!Number.isFinite(publishedAt)) return "invalid-published-at";

  const currentTime = Number.isFinite(options.now) ? options.now! : Date.now();
  if (publishedAt > currentTime) return "future-published-at";

  if (hasExplicitRange) {
    if (filters.dateFrom && publishedAt < shanghaiBoundary(filters.dateFrom)) return "outside-date-range";
    if (filters.dateTo && publishedAt >= shanghaiBoundary(filters.dateTo, true)) return "outside-date-range";
    return undefined;
  }

  const windowHours = Math.max(1, options.windowHours ?? 1);
  return publishedAt < currentTime - windowHours * 3_600_000 ? "outside-window" : undefined;
};

export const rawItemMatchesSearch = (
  item: RawHorizonItem,
  filters: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords"> = {},
  options: RawItemSearchOptions = {},
) => {
  if (rawItemTimeRejectionReason(item, filters, options)) return false;
  const terms = keywordTerms(filters.keywords);
  if (!terms.length) return true;
  const searchable = normalizeSearchSeparators(`${item.title} ${item.content ?? ""}`);
  return terms.some((term) => keywordMatches(searchable, normalizeSearchSeparators(term)));
};

export const rawItemToCandidate = (
  item: RawHorizonItem,
  windowHours: number,
  topicIds: CollectionTopicId[] = ["ai"],
): Candidate => {
  const sourceName = sourceNameFor(item);
  const sourceRole = sourceRoleForItem(item);
  const scored = candidateScore(item, sourceName, windowHours, topicIds);
  const xPoints = item.source_type === "x"
    ? Math.min(Number.MAX_SAFE_INTEGER, ["like_count", "retweet_count", "quote_count"]
      .reduce((total, key) => total + (finiteMetadataNumber(item.metadata?.[key]) ?? 0), 0))
    : undefined;
  const points = finiteMetadataNumber(item.metadata?.score) ?? xPoints;
  const comments = finiteMetadataNumber(item.metadata?.descendants ?? item.metadata?.comment_count)
    ?? (item.source_type === "x" ? finiteMetadataNumber(item.metadata?.reply_count) ?? 0 : undefined);
  const discussionUrl = typeof item.metadata?.discussion_url === "string"
    ? item.metadata.discussion_url
    : item.source_type === "x" ? item.url : undefined;
  const sourceImages = xSourceImagesForItem(item);
  const id = createHash("sha1").update(`${item.id}:${item.url}`).digest("hex").slice(0, 14);
  return {
    id,
    rawId: item.id,
    sourceType: item.source_type,
    sourceName,
    sourceRole,
    author: item.author,
    title: item.title,
    url: item.url,
    canonicalUrl: canonicalUrlForItem(item),
    // Community writing is valuable evidence in its own right. Preserve
    // enough of the discussion for a separate community synthesis instead of
    // squeezing it into the news-summary-sized 360-character window.
    excerpt: cleanExcerpt(item.content, sourceRole === "community" ? 2_400 : 360),
    publishedAt: item.published_at ?? item.fetched_at ?? new Date().toISOString(),
    fetchedAt: item.fetched_at ?? new Date().toISOString(),
    score: scored.total,
    scoreBreakdown: scored.breakdown,
    heatScore: 0,
    heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
    recommendationScore: 0,
    personalizationScore: 0,
    personalizationReasons: [],
    topicIds: normalizeTopicIds(topicIds),
    engagement: points !== undefined || comments !== undefined || discussionUrl
      ? { points, comments, discussionUrl }
      : undefined,
    clusterSize: 1,
    relatedSources: [sourceName],
    evidence: scored.evidence,
    imageCount: item.source_type === "x" ? sourceImages.length : null,
    images: sourceImages,
    selected: false,
    status: "candidate",
  };
};

export const sortCandidates = (
  candidates: Candidate[],
  feedback: CandidateFeedback[] = [],
  personalizationEnabled = true,
) => {
  const eligible = candidates.filter(
    (candidate) => candidate.score >= 7 && candidate.scoreBreakdown.relevance > 0,
  );
  const clusters: Candidate[][] = [];
  for (const candidate of eligible) {
    const cluster = clusters.find((entries) => titleSimilarity(entries[0].title, candidate.title) >= 0.78);
    if (cluster) cluster.push(candidate);
    else clusters.push([candidate]);
  }

  const ranked = clusters.map((cluster) => {
    const relatedSources = [...new Set(cluster.map((candidate) => candidate.sourceName))];
    const crossSource = clamp((relatedSources.length - 1) * 12, 0, 24);
    const enriched = cluster.map((candidate) => {
      const engagement = engagementFor(candidate);
      const confirmed = relatedSources.length > 1 && candidate.scoreBreakdown.confirmation === 0;
      const scoreBreakdown = confirmed
        ? { ...candidate.scoreBreakdown, confirmation: 1 }
        : candidate.scoreBreakdown;
      const score = confirmed ? Math.min(15, candidate.score + 1) : candidate.score;
      // Propagation is evidence, not an editorial estimate. Only observable
      // public interaction and independent pickup count here. Absence is
      // "unknown", never a fabricated low-heat score.
      const heatScore = clamp(engagement + crossSource, 0, 100);
      return {
        ...candidate,
        score,
        scoreBreakdown,
        heatScore,
        heatBreakdown: { engagement, sourceReach: 0, crossSource, freshness: 0 },
        // Missing public propagation data is unknown, not a negative signal.
        // Observable pickup/interaction may add a small bonus, never erase
        // otherwise strong editorial value.
        recommendationScore: Math.round((score / 15) * 100 + heatScore * 0.25),
        clusterSize: cluster.length,
        relatedSources,
      };
    });
    return enriched.sort((left, right) => {
      if (right.recommendationScore !== left.recommendationScore) {
        return right.recommendationScore - left.recommendationScore;
      }
      return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    })[0];
  });

  const baseRanking = ranked
    .sort((left, right) => {
      if (right.recommendationScore !== left.recommendationScore) {
        return right.recommendationScore - left.recommendationScore;
      }
      if (right.score !== left.score) return right.score - left.score;
      return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    });
  return personalizeCandidates(baseRanking, feedback, personalizationEnabled).slice(0, 60);
};
