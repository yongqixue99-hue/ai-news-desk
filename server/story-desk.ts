import { createHash } from "node:crypto";
import type {
  EvidenceStrength,
  StoryExplanation,
  StorySignalView,
  StoryTrendView,
  StoryView,
  TodayView,
} from "./product-types.js";
import { assignStory } from "./editorial-desk.js";
import { isCommunityCandidate } from "./community-feed.js";
import { interleaveBySource } from "./source-diversity.js";
import { hasCurrentPublication } from "./publication-state.js";
import { isLocalImageFileReady, isNeutralImagePublishReady } from "./image-readiness.js";
import type { Candidate, CollectionTopicId, SourceConfig, WorkflowState } from "./types.js";

interface CandidateRecord {
  runId: string;
  candidate: Candidate;
}

interface StoryCluster {
  records: CandidateRecord[];
  exactKeys: Set<string>;
  titles: string[];
  /**
   * The first observed source identity is deliberately immutable. Page
   * extraction may discover a canonical URL later; that must enrich a Story,
   * not silently create a different Story id while a package job is running.
   */
  identityKey: string;
}

const titleStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with",
  "new", "news", "official", "report", "reports", "发布", "宣布", "推出", "消息", "报道", "关于", "一个", "这个",
]);
const titleTokenCache = new Map<string, Set<string>>();

const normalizedUrl = (value: string | undefined) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|spm|from)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString().toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

const titleTokens = (title: string) => {
  const cached = titleTokenCache.get(title);
  if (cached) return cached;
  const normalized = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim();
  const words = normalized.split(/\s+/u).filter((word) => word.length > 1 && !titleStopWords.has(word));
  const chinese = [...normalized.matchAll(/[\u3400-\u9fff]{2,}/gu)].flatMap((match) => {
    const value = match[0];
    return value.length <= 2
      ? [value]
      : Array.from({ length: value.length - 1 }, (_unused, index) => value.slice(index, index + 2));
  });
  const tokens = new Set([...words, ...chinese]);
  if (titleTokenCache.size >= 5_000) titleTokenCache.clear();
  titleTokenCache.set(title, tokens);
  return tokens;
};

const titleSimilarity = (left: string, right: string) => {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return Math.max(intersection / union, (intersection / Math.min(leftTokens.size, rightTokens.size)) * 0.9);
};

const recordTitles = (record: CandidateRecord) => [
  record.candidate.title,
  record.candidate.briefing?.titleZh,
].filter((value): value is string => Boolean(value));

const exactKeysFor = (candidate: Candidate) => [...new Set([
  normalizedUrl(candidate.url),
  normalizedUrl(candidate.canonicalUrl),
  normalizedUrl(candidate.engagement?.discussionUrl),
].filter(Boolean))];

const initialIdentityFor = (record: CandidateRecord) => exactKeysFor(record.candidate)[0]
  || `${record.candidate.title.toLocaleLowerCase()}:${record.candidate.publishedAt.slice(0, 10)}`;

const timeFor = (record: CandidateRecord) => {
  const fetched = Date.parse(record.candidate.fetchedAt);
  return Number.isFinite(fetched) ? fetched : Date.parse(record.candidate.publishedAt);
};

const withinMergeWindow = (left: CandidateRecord, right: CandidateRecord) => {
  const delta = Math.abs(Date.parse(left.candidate.publishedAt) - Date.parse(right.candidate.publishedAt));
  return Number.isFinite(delta) && delta <= 96 * 3_600_000;
};

const clustersFor = (state: WorkflowState) => {
  const clusters: StoryCluster[] = [];
  const exactIndex = new Map<string, StoryCluster>();
  const titleIndex = new Map<string, Set<StoryCluster>>();
  const records = state.runs.flatMap((run) => run.candidates.map((candidate) => ({ runId: run.id, candidate })))
    .sort((left, right) => timeFor(left) - timeFor(right));

  for (const record of records) {
    const exactKeys = exactKeysFor(record.candidate);
    let cluster = exactKeys.map((key) => exactIndex.get(key)).find(Boolean);
    if (!cluster) {
      const nearbyClusters = new Set<StoryCluster>();
      for (const title of recordTitles(record)) {
        for (const token of titleTokens(title)) {
          for (const candidateCluster of titleIndex.get(token) ?? []) nearbyClusters.add(candidateCluster);
        }
      }
      cluster = [...nearbyClusters].find((candidateCluster) => {
        const latest = candidateCluster.records.at(-1)!;
        if (!withinMergeWindow(record, latest)) return false;
        return recordTitles(record).some((leftTitle) => candidateCluster.titles.some((rightTitle) =>
          titleSimilarity(leftTitle, rightTitle) >= 0.78));
      });
    }
    if (!cluster) {
      cluster = { records: [], exactKeys: new Set(), titles: [], identityKey: initialIdentityFor(record) };
      clusters.push(cluster);
    }
    cluster.records.push(record);
    for (const key of exactKeys) {
      cluster.exactKeys.add(key);
      exactIndex.set(key, cluster);
    }
    const titles = recordTitles(record);
    cluster.titles.push(...titles);
    for (const title of titles) {
      for (const token of titleTokens(title)) {
        const indexed = titleIndex.get(token) ?? new Set<StoryCluster>();
        indexed.add(cluster);
        titleIndex.set(token, indexed);
      }
    }
  }
  return clusters;
};

const roleRank = (candidate: Candidate) => ({
  official: 5,
  research: 4,
  verification: 3,
  discovery: 2,
  community: 1,
})[candidate.sourceRole ?? (isCommunityCandidate(candidate) ? "community" : "discovery")];

const briefingRank = (candidate: Candidate) => ({
  "full-source": 3,
  excerpt: 2,
  title: 1,
})[candidate.briefing?.basis ?? "title"];

const uniqueBy = <T>(items: T[], keyFor: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const commentSamplesIn = (candidate: Candidate) => {
  const bracketed = candidate.excerpt.match(/\[[^\]]{1,80}\]:\s*[\s\S]{20,}?(?=\s+\[[^\]]{1,80}\]:|$)/gu)?.length ?? 0;
  const labeled = candidate.excerpt.match(/社区原句[:：]/gu)?.length ?? 0;
  return Math.max(bracketed, labeled, candidate.author && candidate.excerpt.length >= 80 ? 1 : 0);
};

const trendFor = (records: CandidateRecord[]): StoryTrendView => {
  const communityRecords = records.filter((record) => isCommunityCandidate(record.candidate) && record.candidate.engagement)
    .sort((left, right) => timeFor(left) - timeFor(right));
  const platformCount = new Set(communityRecords.map((record) => record.candidate.sourceName)).size;
  if (!communityRecords.length) return { direction: "unknown", summary: "暂无公开社区热度快照", platformCount: 0 };
  const latest = communityRecords.at(-1)!;
  const latestEngagement = latest.candidate.engagement!;
  const sameDiscussion = communityRecords.filter((record) =>
    normalizedUrl(record.candidate.engagement?.discussionUrl)
      === normalizedUrl(latest.candidate.engagement?.discussionUrl));
  if (sameDiscussion.length < 2) {
    return {
      direction: "steady",
      summary: `当前记录 ${latestEngagement.points ?? 0} 积分、${latestEngagement.comments ?? 0} 条讨论`,
      platformCount,
      latestPoints: latestEngagement.points,
      latestComments: latestEngagement.comments,
    };
  }
  const previous = sameDiscussion.at(-2)!;
  const hours = Math.max(0.25, (timeFor(latest) - timeFor(previous)) / 3_600_000);
  const pointsDelta = Math.max(0, (latestEngagement.points ?? 0) - (previous.candidate.engagement?.points ?? 0));
  const commentsDelta = Math.max(0, (latestEngagement.comments ?? 0) - (previous.candidate.engagement?.comments ?? 0));
  const rate = pointsDelta / hours + commentsDelta * 2 / hours;
  const direction = rate >= 18 ? "rising" : rate >= 2 ? "steady" : "cooling";
  const directionLabel = direction === "rising" ? "仍在升温" : direction === "cooling" ? "增长放缓" : "热度稳定";
  return {
    direction,
    summary: `近 ${Math.round(hours * 10) / 10} 小时新增 ${pointsDelta} 积分、${commentsDelta} 条讨论，${directionLabel}`,
    platformCount,
    latestPoints: latestEngagement.points,
    latestComments: latestEngagement.comments,
    pointsDelta,
    commentsDelta,
    windowHours: Math.round(hours * 10) / 10,
  };
};

const evidenceStrengthFor = (factRecords: CandidateRecord[]) => {
  const domains = new Set(factRecords.map((record) => {
    try { return new URL(record.candidate.canonicalUrl || record.candidate.url).hostname; } catch { return record.candidate.sourceName; }
  }));
  const hasOfficial = factRecords.some((record) => record.candidate.sourceRole === "official");
  const hasFullSource = factRecords.some((record) => record.candidate.briefing?.basis === "full-source");
  if ((hasOfficial && domains.size >= 2) || domains.size >= 3) return "strong" satisfies EvidenceStrength;
  if (hasOfficial || hasFullSource || domains.size >= 2) return "moderate" satisfies EvidenceStrength;
  return "weak" satisfies EvidenceStrength;
};

const briefingBasisFor = (candidate: Candidate) => candidate.briefing?.basis
  ?? (candidate.excerpt.trim() ? "excerpt" : "title");

const explanationRank = (candidate: Candidate) => {
  const explanation = candidate.briefing?.explanation;
  if (!explanation) return 0;
  return explanation.voiceVersion === 2 && explanation.readerBriefZh ? 2 : 1;
};

const explanationFor = (
  records: CandidateRecord[],
  primary: CandidateRecord,
  assignment: ReturnType<typeof assignStory>,
): StoryExplanation => {
  const ordered = [...records].sort((left, right) =>
    explanationRank(right.candidate) - explanationRank(left.candidate)
      || briefingRank(right.candidate) - briefingRank(left.candidate)
      || roleRank(right.candidate) - roleRank(left.candidate));
  const explained = ordered.find((record) => record.candidate.briefing?.explanation);
  const selected = explained ?? ordered[0] ?? primary;
  const detailed = selected.candidate.briefing?.explanation;
  const sourceRecords = uniqueBy(
    records.filter((record) => !isCommunityCandidate(record.candidate)),
    (record) => normalizedUrl(record.candidate.canonicalUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const evidenceRecords = sourceRecords.length ? sourceRecords : uniqueBy(
    records,
    (record) => normalizedUrl(record.candidate.canonicalUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const sources = evidenceRecords.slice(0, 6).map((record) => ({
    signalId: `${record.runId}:${record.candidate.id}`,
    sourceName: record.candidate.sourceName,
    role: record.candidate.sourceRole ?? (isCommunityCandidate(record.candidate) ? "community" : "discovery"),
    basis: briefingBasisFor(record.candidate),
    summary: record.candidate.briefing?.summaryZh
      || record.candidate.excerpt.replace(/\s+/gu, " ").trim().slice(0, 300)
      || record.candidate.title,
    url: record.candidate.canonicalUrl || record.candidate.url,
  }));
  const fallbackOverview = selected.candidate.briefing?.summaryZh
    || primary.candidate.briefing?.summaryZh
    || primary.candidate.excerpt.replace(/\s+/gu, " ").trim().slice(0, 420)
    || primary.candidate.title;
  const fallbackPoints = uniqueBy(
    sources.map((source) => source.summary).filter((summary) => summary && summary !== fallbackOverview),
    (summary) => summary,
  ).slice(0, 4);
  const basis = briefingBasisFor(selected.candidate);
  const voiceReady = detailed?.voiceVersion === 2 && Boolean(detailed.readerBriefZh);
  return {
    status: voiceReady ? "ready" : "partial",
    basis,
    voiceVersion: detailed?.voiceVersion ?? 1,
    readerBrief: detailed?.readerBriefZh || detailed?.whatHappenedZh || fallbackOverview,
    editorNote: detailed?.editorNoteZh,
    whatHappened: detailed?.whatHappenedZh || fallbackOverview,
    keyPoints: detailed?.keyPointsZh.length ? detailed.keyPointsZh : (fallbackPoints.length ? fallbackPoints : [fallbackOverview]),
    whyItMatters: detailed?.whyItMattersZh || assignment.audienceValue,
    affected: detailed?.affectedZh,
    unknowns: detailed?.unknownsZh.length
      ? detailed.unknownsZh
      : basis === "title"
        ? ["当前只有标题级证据，正文细节、数据与实际影响仍未确认。"]
        : ["当前为扫描级摘要；打开后会继续读取来源正文并补齐具体细节。"],
    qualityFlags: detailed?.qualityFlags ?? [],
    sources,
    generatedAt: selected.candidate.briefing?.generatedAt,
  };
};

const storyFromCluster = (cluster: StoryCluster, now: string): StoryView => {
  const records = [...cluster.records].sort((left, right) => timeFor(right) - timeFor(left));
  const uniqueSignals = uniqueBy(records, (record) => `${record.runId}:${record.candidate.id}`);
  const factRecords = uniqueBy(
    records.filter((record) => !isCommunityCandidate(record.candidate)),
    (record) => normalizedUrl(record.candidate.canonicalUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const communityRecords = uniqueBy(
    records.filter((record) => isCommunityCandidate(record.candidate)),
    (record) => normalizedUrl(record.candidate.engagement?.discussionUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const primary = [...records].sort((left, right) =>
    roleRank(right.candidate) - roleRank(left.candidate)
      || briefingRank(right.candidate) - briefingRank(left.candidate)
      || right.candidate.recommendationScore - left.candidate.recommendationScore)[0]!;
  const bestBriefing = [...records].sort((left, right) =>
    briefingRank(right.candidate) - briefingRank(left.candidate)
      || roleRank(right.candidate) - roleRank(left.candidate))[0]!.candidate.briefing;
  const bestInsight = records.find((record) => record.candidate.communityInsight)?.candidate.communityInsight;
  const images = uniqueBy(records.flatMap((record) => record.candidate.images), (image) => normalizedUrl(image.url) || image.id)
    .slice(0, 24);
  const localImages = images.filter(isLocalImageFileReady);
  const publishReadyImages = localImages.filter((image) => isNeutralImagePublishReady(image, now));
  const publishedTimes = records.map((record) => Date.parse(record.candidate.publishedAt)).filter(Number.isFinite);
  const fetchedTimes = records.map(timeFor).filter(Number.isFinite);
  const fallbackTime = Date.parse(now);
  const publishedAt = new Date(publishedTimes.length ? Math.max(...publishedTimes) : fallbackTime).toISOString();
  const firstSeenAt = new Date(fetchedTimes.length ? Math.min(...fetchedTimes) : fallbackTime).toISOString();
  const lastSeenAt = new Date(fetchedTimes.length ? Math.max(...fetchedTimes) : fallbackTime).toISOString();
  const ageHours = Math.max(0, (Date.parse(now) - Date.parse(publishedAt)) / 3_600_000);
  const evidenceStrength = evidenceStrengthFor(factRecords);
  const communitySampleCount = Math.max(0, ...records.filter((record) => isCommunityCandidate(record.candidate)).map((record) => commentSamplesIn(record.candidate)));
  const protectedStory = records.some((record) => record.candidate.selected
    || record.candidate.status === "drafted"
    || record.candidate.userFeedback === "interested"
    || record.candidate.userFeedback === "published");
  const title = bestBriefing?.titleZh || primary.candidate.briefing?.titleZh || primary.candidate.title;
  const assignment = assignStory({
    title,
    ageHours,
    evidenceStrength,
    factSourceCount: factRecords.length,
    communitySourceCount: communityRecords.length,
    communitySampleCount,
    longestExcerpt: Math.max(...records.map((record) => record.candidate.excerpt.length)),
    protected: protectedStory,
    now,
  });
  const id = `story_${createHash("sha1").update(cluster.identityKey).digest("hex").slice(0, 16)}`;
  const sourceCount = uniqueBy(records, (record) => `${record.candidate.sourceName}:${normalizedUrl(record.candidate.url)}`).length;
  const topicIds = [...new Set(records.flatMap((record) => record.candidate.topicIds ?? []))] as CollectionTopicId[];
  const signals: StorySignalView[] = uniqueSignals.map((record) => ({
    runId: record.runId,
    candidateId: record.candidate.id,
    sourceName: record.candidate.sourceName,
    sourceRole: record.candidate.sourceRole,
    sourceType: record.candidate.sourceType,
    title: record.candidate.title,
    titleZh: record.candidate.briefing?.titleZh,
    summaryZh: record.candidate.briefing?.summaryZh,
    briefingBasis: record.candidate.briefing?.basis,
    url: record.candidate.canonicalUrl || record.candidate.url,
    discussionUrl: record.candidate.engagement?.discussionUrl,
    author: record.candidate.author,
    publishedAt: record.candidate.publishedAt,
    fetchedAt: record.candidate.fetchedAt,
    isCommunity: isCommunityCandidate(record.candidate),
    engagement: record.candidate.engagement ? {
      points: record.candidate.engagement.points,
      comments: record.candidate.engagement.comments,
    } : undefined,
    feedback: record.candidate.userFeedback,
    drafted: record.candidate.status === "drafted",
  }));
  return {
    id,
    title,
    originalTitle: primary.candidate.title,
    summary: bestBriefing?.summaryZh || primary.candidate.excerpt.slice(0, 240) || "等待补充来源摘要",
    whyImportant: assignment.audienceValue,
    communitySummary: bestInsight?.summaryZh,
    communityFocus: bestInsight?.focusZh ?? [],
    disagreement: bestInsight?.disagreementZh,
    explanation: explanationFor(records, primary, assignment),
    topicIds,
    firstSeenAt,
    lastSeenAt,
    publishedAt,
    ageHours,
    recommendationScore: Math.max(...records.map((record) => record.candidate.recommendationScore)),
    evidenceStrength,
    sourceCount,
    factSourceCount: factRecords.length,
    communitySourceCount: communityRecords.length,
    communitySampleCount,
    images,
    imageCount: images.length,
    localImageCount: localImages.length,
    publishReadyImageCount: publishReadyImages.length,
    rightsReviewImageCount: localImages.length - publishReadyImages.length,
    selected: records.some((record) => record.candidate.selected),
    drafted: records.some((record) => record.candidate.status === "drafted"),
    published: records.some((record) => record.candidate.userFeedback === "published"),
    ignored: records.some((record) => record.candidate.userFeedback === "not_interested"),
    assignment,
    trend: trendFor(records),
    signals,
  };
};

const storyRank = (story: StoryView) => {
  const evidence = story.evidenceStrength === "strong" ? 18 : story.evidenceStrength === "moderate" ? 9 : 0;
  const trend = story.trend.direction === "rising" ? 15 : story.trend.direction === "steady" ? 5 : 0;
  const images = Math.min(6, (story.localImageCount ?? 0) * 2 + Math.min(2, story.imageCount)) * 1.5;
  const recency = Math.max(0, 16 - story.ageHours / 3);
  return story.recommendationScore + evidence + trend + images + recency;
};

export const buildStories = (state: WorkflowState, now = new Date().toISOString()) => clustersFor(state)
  .map((cluster) => storyFromCluster(cluster, now))
  .sort((left, right) => storyRank(right) - storyRank(left));

const diagnosticsFor = (sources: SourceConfig[]) => sources
  .filter((source) => source.selected && source.enabled && source.health && source.health !== "healthy")
  .map((source) => ({
    sourceId: source.id,
    name: source.name,
    kind: source.kind,
    role: source.role,
    status: source.health ?? "unknown",
    detail: source.lastHealthDetail || "来源需要检查",
    consecutiveFailures: source.consecutiveFailures ?? 0,
  }));

export const buildTodayView = (state: WorkflowState, now = new Date().toISOString()): TodayView => {
  const stories = buildStories(state, now);
  const active = stories.filter((story) => story.ageHours <= 48 && !story.ignored && !story.published);
  const ready = interleaveBySource(
    active.filter((story) => story.assignment.canDraft && !story.drafted),
    (story) => story.signals.find((signal) => !signal.isCommunity)?.sourceName
      ?? story.signals[0]?.sourceName
      ?? "未知来源",
  );
  const watching = active.filter((story) => story.assignment.mode === "watch").slice(0, 6);
  const backlog = interleaveBySource(
    stories.filter((story) => story.ageHours > 48
      && story.ageHours <= 7 * 24
      && !story.ignored
      && !story.published
      && !story.drafted
      && story.assignment.canDraft),
    (story) => story.signals.find((signal) => !signal.isCommunity)?.sourceName
      ?? story.signals[0]?.sourceName
      ?? "未知来源",
  ).slice(0, 6);
  const drafts = state.drafts;
  const autoUsableMaterials = state.materials.filter((material) => isNeutralImagePublishReady(material, now));
  const sourceImageReadyCount = active.filter((story) => (story.localImageCount ?? 0) >= 2).length;
  const publishReadyStoryCount = active.filter((story) => (story.publishReadyImageCount ?? 0) >= 2).length;
  return {
    generatedAt: now,
    mustReads: ready.slice(0, 3),
    secondary: ready.slice(3, 8),
    backlog,
    watching,
    diagnostics: diagnosticsFor(state.sources),
    funnel: {
      candidateCount: state.runs.reduce((total, run) => total + run.candidates.length, 0),
      storyCount: stories.length,
      selectedCount: state.runs.reduce((total, run) => total + run.candidates.filter((candidate) => candidate.selected).length, 0),
      draftCount: drafts.length,
      syncedCount: drafts.filter((draft) => Boolean(draft.wechatDraft) || draft.status === "filled").length,
      publishedCount: drafts.filter((draft) => draft.publicationConfirmations
        ? hasCurrentPublication(draft)
        : draft.status === "published" && Boolean(draft.publicationConfirmedAt)).length,
      feedbackCount: state.candidateFeedback.length,
      materialLibraryTotal: state.materials.length,
      autoUsableMaterialCount: autoUsableMaterials.length,
      rightsReviewMaterialCount: state.materials.length - autoUsableMaterials.length,
      reusableMaterialCount: autoUsableMaterials.length,
    },
    coverage: {
      activeStoryCount: active.length,
      risingCount: active.filter((story) => story.trend.direction === "rising").length,
      sourceImageReadyCount,
      publishReadyStoryCount,
      imageReadyCount: sourceImageReadyCount,
      strongEvidenceCount: active.filter((story) => story.evidenceStrength === "strong").length,
      topicIds: [...new Set(active.flatMap((story) => story.topicIds))] as CollectionTopicId[],
    },
  };
};

export const storyById = (state: WorkflowState, storyId: string, now = new Date().toISOString()) =>
  buildStories(state, now).find((story) => story.id === storyId);
