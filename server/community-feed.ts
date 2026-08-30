import type {
  Candidate,
  CollectionTopicId,
  SourceRole,
  WorkflowRun,
} from "./types.js";

const storyTitleStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with",
  "new", "official", "video", "news", "says", "say",
]);

const storyTitleTerms = (title: string) => new Set(
  title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((term) => term.length > 1 && !storyTitleStopWords.has(term)),
);

const storyTitleSimilarity = (left: string, right: string) => {
  const leftTerms = storyTitleTerms(left);
  const rightTerms = storyTitleTerms(right);
  if (!leftTerms.size || !rightTerms.size) return 0;
  let intersection = 0;
  for (const term of leftTerms) if (rightTerms.has(term)) intersection += 1;
  const union = new Set([...leftTerms, ...rightTerms]).size;
  return Math.max(intersection / union, (intersection / Math.min(leftTerms.size, rightTerms.size)) * 0.88);
};

export interface CommunityTrendSnapshot {
  fetchedAt: string;
  points: number;
  comments: number;
}

export interface CommunityTrend {
  windowHours: number;
  pointsDelta: number;
  commentsDelta: number;
  pointsPerHour: number;
  commentsPerHour: number;
  direction: "rising" | "steady" | "cooling";
  snapshots: CommunityTrendSnapshot[];
}

export interface CommunitySupportingSource {
  runId: string;
  candidateId: string;
  sourceName: string;
  sourceRole?: SourceRole;
  title: string;
  url: string;
}

export interface CommunityFeedEntry {
  runId: string;
  candidate: Candidate;
  platform: string;
  reason: string;
  trendScore: number;
  ageHours: number;
  snapshotCount: number;
  trend?: CommunityTrend;
  supportingSources: CommunitySupportingSource[];
}

export interface CommunityFeedComposition {
  items: CommunityFeedEntry[];
  featured?: CommunityFeedEntry;
  recommended: CommunityFeedEntry[];
  remaining: CommunityFeedEntry[];
  expiredCount: number;
  duplicateCount: number;
  lastUpdatedAt?: string;
}

export interface CommunityFeedOptions {
  now?: string;
  expiryHours?: number;
  limit?: number;
  personalizationEnabled?: boolean;
}

interface CandidateRecord {
  runId: string;
  runCreatedAt: string;
  candidate: Candidate;
}

const communityIdentity = (candidate: Candidate) =>
  `${candidate.sourceRole || ""} ${candidate.sourceType} ${candidate.sourceName}`.toLocaleLowerCase();

export const isCommunityCandidate = (candidate: Candidate) => {
  const identity = communityIdentity(candidate);
  return candidate.sourceRole === "community"
    || /community|hackernews|hacker news|reddit|zhihu|知乎|twitter|\bx\b|threads|youtube|tiktok|instagram|last30days/u.test(identity)
    || Boolean(candidate.engagement?.discussionUrl);
};

const normalizedUrl = (value: string | undefined) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_|ref$|source$)/iu.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

const candidateKey = (candidate: Candidate) => normalizedUrl(
  candidate.engagement?.discussionUrl || candidate.canonicalUrl || candidate.url,
) || candidate.title.trim().toLocaleLowerCase();

const platformFor = (candidate: Candidate) => {
  const identity = communityIdentity(candidate);
  if (/hackernews|hacker news/u.test(identity)) return "Hacker News";
  if (/last30days/u.test(identity)) return "社区趋势";
  if (/zhihu|知乎/u.test(identity)) return "知乎";
  if (/reddit/u.test(identity)) return "Reddit";
  if (/twitter|\bx\b/u.test(identity)) return "X";
  if (/threads/u.test(identity)) return "Threads";
  if (/youtube/u.test(identity)) return "YouTube";
  if (/github/u.test(identity)) return "GitHub";
  return candidate.sourceName || "社区";
};

const protectedFromExpiry = (candidate: Candidate) =>
  candidate.selected
  || candidate.status === "drafted"
  || candidate.userFeedback === "interested"
  || candidate.userFeedback === "published";

const recordTime = (record: CandidateRecord) => {
  const fetched = Date.parse(record.candidate.fetchedAt || record.runCreatedAt);
  return Number.isFinite(fetched) ? fetched : Date.parse(record.runCreatedAt);
};

const briefingRank = (candidate: Candidate) => {
  if (!candidate.briefing) return 0;
  const basis = candidate.briefing.basis === "full-source"
    ? 3
    : candidate.briefing.basis === "excerpt"
      ? 2
      : 1;
  return basis * 10 + (candidate.communityInsight ? 4 : 0);
};

const betterBriefing = (left: CandidateRecord, right: CandidateRecord) => {
  const delta = briefingRank(right.candidate) - briefingRank(left.candidate);
  if (delta) return delta > 0 ? right : left;
  return recordTime(right) > recordTime(left) ? right : left;
};

const imageKey = (candidateImage: Candidate["images"][number]) =>
  normalizedUrl(candidateImage.url) || candidateImage.id;

const mergeImages = (records: CandidateRecord[]) => {
  const images = new Map<string, Candidate["images"][number]>();
  for (const record of [...records].sort((left, right) => recordTime(right) - recordTime(left))) {
    for (const candidateImage of record.candidate.images) {
      const key = imageKey(candidateImage);
      const current = images.get(key);
      if (!current || (!current.localPath && candidateImage.localPath) || (!current.selected && candidateImage.selected)) {
        images.set(key, { ...candidateImage });
      }
    }
  }
  return [...images.values()].slice(0, 24);
};

const trendFor = (records: CandidateRecord[]): CommunityTrend | undefined => {
  const byTimestamp = new Map<number, CommunityTrendSnapshot>();
  for (const record of records) {
    const fetchedAt = record.candidate.fetchedAt || record.runCreatedAt;
    const at = Date.parse(fetchedAt);
    if (!Number.isFinite(at)) continue;
    const points = record.candidate.engagement?.points ?? 0;
    const comments = record.candidate.engagement?.comments ?? 0;
    if (!points && !comments) continue;
    byTimestamp.set(at, { fetchedAt, points, comments });
  }
  const snapshots = [...byTimestamp.entries()]
    .sort((left, right) => left[0] - right[0])
    .map((entry) => entry[1]);
  if (snapshots.length < 2) return undefined;

  const latest = snapshots.at(-1)!;
  const previous = snapshots.at(-2)!;
  const latestAt = Date.parse(latest.fetchedAt);
  const previousAt = Date.parse(previous.fetchedAt);
  const windowHours = Math.max(0.25, (latestAt - previousAt) / 3_600_000);
  const pointsDelta = Math.max(0, latest.points - previous.points);
  const commentsDelta = Math.max(0, latest.comments - previous.comments);
  const pointsPerHour = pointsDelta / windowHours;
  const commentsPerHour = commentsDelta / windowHours;
  let direction: CommunityTrend["direction"] = pointsPerHour + commentsPerHour * 2 >= 18
    ? "rising"
    : "steady";

  if (snapshots.length >= 3) {
    const before = snapshots.at(-3)!;
    const beforeHours = Math.max(
      0.25,
      (Date.parse(previous.fetchedAt) - Date.parse(before.fetchedAt)) / 3_600_000,
    );
    const previousRate = Math.max(0, previous.points - before.points) / beforeHours
      + Math.max(0, previous.comments - before.comments) * 2 / beforeHours;
    const latestRate = pointsPerHour + commentsPerHour * 2;
    if (previousRate > 0 && latestRate < previousRate * 0.65) direction = "cooling";
    else if (latestRate > Math.max(12, previousRate * 1.2)) direction = "rising";
    else direction = "steady";
  }

  return {
    windowHours: Math.round(windowHours * 10) / 10,
    pointsDelta,
    commentsDelta,
    pointsPerHour: Math.round(pointsPerHour * 10) / 10,
    commentsPerHour: Math.round(commentsPerHour * 10) / 10,
    direction,
    snapshots,
  };
};

const mergeCommunityCluster = (records: CandidateRecord[]) => {
  const sorted = [...records].sort((left, right) => recordTime(left) - recordTime(right));
  const latest = sorted.at(-1)!;
  const bestBriefingRecord = sorted.reduce(betterBriefing);
  const bestInsightRecord = [...sorted]
    .reverse()
    .find((record) => record.candidate.communityInsight);
  const bestScoreRecord = [...sorted].sort((left, right) =>
    right.candidate.score - left.candidate.score
    || right.candidate.recommendationScore - left.candidate.recommendationScore)[0]!;
  const images = mergeImages(sorted);
  const engagementRecords = [...sorted]
    .reverse()
    .filter((record) => record.candidate.engagement);
  const latestEngagement = engagementRecords[0]?.candidate.engagement;
  const excerpt = [...sorted]
    .sort((left, right) => right.candidate.excerpt.length - left.candidate.excerpt.length)[0]!
    .candidate.excerpt;
  const status = sorted.some((record) => record.candidate.status === "drafted")
    ? "drafted" as const
    : sorted.some((record) => record.candidate.status === "skipped")
      ? "skipped" as const
      : "candidate" as const;
  const merged: Candidate = {
    ...latest.candidate,
    author: latest.candidate.author || sorted.find((record) => record.candidate.author)?.candidate.author,
    canonicalUrl: latest.candidate.canonicalUrl
      || sorted.find((record) => record.candidate.canonicalUrl)?.candidate.canonicalUrl,
    excerpt,
    score: Math.max(...sorted.map((record) => record.candidate.score)),
    scoreBreakdown: bestScoreRecord.candidate.scoreBreakdown,
    heatScore: Math.max(...sorted.map((record) => record.candidate.heatScore)),
    recommendationScore: Math.max(...sorted.map((record) => record.candidate.recommendationScore)),
    briefing: bestBriefingRecord.candidate.briefing,
    communityInsight: bestInsightRecord?.candidate.communityInsight,
    engagement: latestEngagement ? {
      points: latestEngagement.points,
      comments: latestEngagement.comments,
      discussionUrl: latestEngagement.discussionUrl
        || engagementRecords.find((record) => record.candidate.engagement?.discussionUrl)?.candidate.engagement?.discussionUrl,
    } : undefined,
    clusterSize: Math.max(...sorted.map((record) => record.candidate.clusterSize)),
    relatedSources: [...new Set(sorted.flatMap((record) => record.candidate.relatedSources))],
    images,
    imageCount: images.length,
    selected: sorted.some((record) => record.candidate.selected),
    status,
    userFeedback: [...sorted].reverse().find((record) => record.candidate.userFeedback)?.candidate.userFeedback,
  };
  return {
    runId: latest.runId,
    candidate: merged,
    snapshotCount: sorted.length,
    trend: trendFor(sorted),
  };
};

const rolePriority = (role: SourceRole | undefined) => ({
  official: 4,
  verification: 3,
  research: 2,
  discovery: 1,
  community: 0,
})[role ?? "community"];

export const findCommunitySupportingCandidates = (
  runs: WorkflowRun[],
  communityCandidate: Candidate,
  limit = 5,
) => {
  const storyUrl = normalizedUrl(communityCandidate.canonicalUrl || communityCandidate.url);
  const discussionUrl = normalizedUrl(communityCandidate.engagement?.discussionUrl);
  const matched = runs.flatMap((run) => run.candidates.flatMap((candidate) => {
    if (isCommunityCandidate(candidate)) return [];
    const candidateUrl = normalizedUrl(candidate.canonicalUrl || candidate.url);
    const exactUrl = Boolean(storyUrl && candidateUrl && storyUrl === candidateUrl && candidateUrl !== discussionUrl);
    const similarTitle = storyTitleSimilarity(communityCandidate.title, candidate.title) >= 0.88;
    if (!exactUrl && !similarTitle) return [];
    return [{ runId: run.id, candidate }];
  }));
  const unique = new Map<string, typeof matched[number]>();
  for (const record of matched.sort((left, right) =>
    rolePriority(right.candidate.sourceRole) - rolePriority(left.candidate.sourceRole)
    || right.candidate.recommendationScore - left.candidate.recommendationScore
    || Date.parse(right.candidate.fetchedAt) - Date.parse(left.candidate.fetchedAt))) {
    const key = normalizedUrl(record.candidate.canonicalUrl || record.candidate.url)
      || `${record.candidate.sourceName}:${record.candidate.title}`;
    if (!unique.has(key)) unique.set(key, record);
  }
  return [...unique.values()].slice(0, Math.max(0, limit));
};

const supportingSourceViews = (
  runs: WorkflowRun[],
  candidate: Candidate,
): CommunitySupportingSource[] => findCommunitySupportingCandidates(runs, candidate).map(({ runId, candidate: source }) => ({
  runId,
  candidateId: source.id,
  sourceName: source.sourceName,
  sourceRole: source.sourceRole,
  title: source.briefing?.titleZh || source.title,
  url: source.canonicalUrl || source.url,
}));

const trendScoreFor = (
  candidate: Candidate,
  ageHours: number,
  personalizationEnabled: boolean,
  trend: CommunityTrend | undefined,
  supportingSourceCount: number,
) => {
  const engagement = candidate.engagement;
  const publicHeat = Math.min(22, Math.log2(1 + (engagement?.points ?? 0)) * 1.7)
    + Math.min(22, Math.log2(1 + (engagement?.comments ?? 0)) * 2.2);
  const recency = Math.max(0, 18 - ageHours / 4);
  const preference = personalizationEnabled ? (candidate.personalizationScore ?? 0) : 0;
  const velocity = trend
    ? Math.min(26, Math.log1p(trend.pointsPerHour) * 3 + Math.log1p(trend.commentsPerHour) * 5)
    : 0;
  const support = Math.min(8, supportingSourceCount * 2);
  return Math.round((candidate.recommendationScore + publicHeat + recency + preference + velocity + support) * 10) / 10;
};

const shortHours = (hours: number) => Number.isInteger(hours) ? String(hours) : hours.toFixed(1);

const reasonFor = (
  candidate: Candidate,
  ageHours: number,
  trend: CommunityTrend | undefined,
  supportingSourceCount: number,
) => {
  if (trend && (trend.pointsDelta >= 20 || trend.commentsDelta >= 10)) {
    const direction = trend.direction === "rising"
      ? "仍在升温"
      : trend.direction === "cooling"
        ? "增长正在放缓"
        : "热度保持稳定";
    return `近 ${shortHours(trend.windowHours)} 小时新增 ${trend.pointsDelta} 积分、${trend.commentsDelta} 条讨论，${direction}`;
  }
  if (supportingSourceCount > 0) return `已匹配 ${supportingSourceCount} 个新闻或官方来源，可继续核验`;
  const comments = candidate.engagement?.comments ?? 0;
  const points = candidate.engagement?.points ?? 0;
  if (comments >= 100) return `已有 ${comments} 条公开讨论，社区观点已与事件摘要分开整理`;
  if (points >= 200) return `已有 ${points} 点公开互动，热度较高但仍需核验事实`;
  if (ageHours <= 12) return "刚出现的新讨论，适合尽快判断是否跟进";
  if ((candidate.personalizationScore ?? 0) > 0 && candidate.personalizationReasons?.[0]) {
    return candidate.personalizationReasons[0];
  }
  if (candidate.score >= 11) return "社区热度之外，还有较明确的信息增量";
  return "讨论热度、时效和内容价值综合靠前";
};

export const composeCommunityFeed = (
  runs: WorkflowRun[],
  options: CommunityFeedOptions = {},
): CommunityFeedComposition => {
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const expiryMs = Math.max(1, options.expiryHours ?? 7 * 24) * 3_600_000;
  const clusters = new Map<string, CandidateRecord[]>();
  let expiredCount = 0;
  let duplicateCount = 0;

  for (const run of runs) {
    for (const candidate of run.candidates) {
      if (!isCommunityCandidate(candidate) || candidate.userFeedback === "not_interested") continue;
      const publishedMs = Date.parse(candidate.publishedAt);
      const stale = !Number.isFinite(publishedMs)
        || (Number.isFinite(nowMs) && nowMs - publishedMs > expiryMs);
      if (stale && !protectedFromExpiry(candidate)) {
        expiredCount += 1;
        continue;
      }
      const key = candidateKey(candidate);
      const records = clusters.get(key) ?? [];
      if (records.length) duplicateCount += 1;
      records.push({ runId: run.id, runCreatedAt: run.createdAt, candidate });
      clusters.set(key, records);
    }
  }

  const personalizationEnabled = options.personalizationEnabled ?? true;
  const items = [...clusters.values()]
    .map((records) => {
      const merged = mergeCommunityCluster(records);
      const publishedMs = Date.parse(merged.candidate.publishedAt);
      const ageHours = Number.isFinite(publishedMs) && Number.isFinite(nowMs)
        ? Math.max(0, (nowMs - publishedMs) / 3_600_000)
        : options.expiryHours ?? 7 * 24;
      const supportingSources = supportingSourceViews(runs, merged.candidate);
      return {
        runId: merged.runId,
        candidate: merged.candidate,
        platform: platformFor(merged.candidate),
        reason: reasonFor(merged.candidate, ageHours, merged.trend, supportingSources.length),
        trendScore: trendScoreFor(
          merged.candidate,
          ageHours,
          personalizationEnabled,
          merged.trend,
          supportingSources.length,
        ),
        ageHours,
        snapshotCount: merged.snapshotCount,
        trend: merged.trend,
        supportingSources,
      } satisfies CommunityFeedEntry;
    })
    .sort((left, right) => right.trendScore - left.trendScore
      || Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt))
    .slice(0, Math.max(1, Math.floor(options.limit ?? 36)));

  const lastUpdatedAt = items
    .map((item) => item.candidate.fetchedAt)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0];

  return {
    items,
    featured: items[0],
    recommended: items.slice(1, 5),
    remaining: items.slice(5),
    expiredCount,
    duplicateCount,
    lastUpdatedAt,
  };
};

export const candidateMatchesTopic = (candidate: Candidate, topic: "all" | CollectionTopicId) =>
  topic === "all" || (candidate.topicIds ?? []).includes(topic);
