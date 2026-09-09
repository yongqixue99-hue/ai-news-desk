import { composeCommunityFeed } from "./community-feed.js";
import type { Candidate, WorkflowState } from "./types.js";
import type { ZhihuHotItem, ZhihuHotView } from "./zhihu-hotlist.js";

export const communityPlatforms = ["zhihu", "hackernews", "v2ex", "github"] as const;
export type CommunityPlatform = typeof communityPlatforms[number];
export interface TopicFeedItem {
  id: string;
  title: string;
  originalTitle?: string;
  url: string;
  discussionUrl?: string;
  summary?: string;
  rank?: number;
  metric?: string;
  observedAt?: string;
  selected: boolean;
  runId?: string;
  candidateId?: string;
}
export interface TopicFeedView {
  platform: CommunityPlatform;
  kind: "hotlist" | "collection";
  status: "ready" | "stale" | "empty" | "unavailable" | "unread";
  items: TopicFeedItem[];
  updatedAt?: string;
  retryAt?: string;
  error?: string;
}

const hostname = (value?: string) => { try { return new URL(value ?? "").hostname; } catch { return ""; } };
const platformFor = (candidate: Candidate): CommunityPlatform | undefined => {
  const kind = candidate.sourceType.toLowerCase();
  const discussion = hostname(candidate.engagement?.discussionUrl);
  // Attribute a linked GitHub project to the community that discovered it.
  if (kind === "hackernews" || discussion === "news.ycombinator.com") return "hackernews";
  if (kind === "zhihu" || discussion === "www.zhihu.com") return "zhihu";
  if (kind === "v2ex" || /(^|\.)v2ex\.com$/u.test(discussion)) return "v2ex";
  if (kind === "github") return "github";
  const host = hostname(candidate.url);
  if (host === "www.zhihu.com") return "zhihu";
  if (/(^|\.)v2ex\.com$/u.test(host)) return "v2ex";
  if (host === "news.ycombinator.com") return "hackernews";
  return undefined;
};

const findQuestion = (state: WorkflowState, id: string) => {
  for (const run of state.runs) {
    const candidate = run.candidates.find((entry) => {
      try { const url = new URL(entry.url); return url.hostname === "www.zhihu.com" && url.pathname.replace(/\/$/u, "") === `/question/${id}`; }
      catch { return false; }
    });
    if (candidate) return { runId: run.id, candidate };
  }
  return undefined;
};

/** Read-only discovery view. Browsing it never requests an AI briefing. */
export const buildTopicFeed = (state: WorkflowState, platform: CommunityPlatform, hot?: ZhihuHotView, now = new Date().toISOString()): TopicFeedView => {
  if (platform === "zhihu") return {
    platform, kind: "hotlist", status: hot?.status ?? "unread", updatedAt: hot?.capturedAt, retryAt: hot?.retryAt, error: hot?.error,
    items: (hot?.items ?? []).map((item) => {
      const existing = findQuestion(state, item.id);
      return { ...item, observedAt: hot?.capturedAt, selected: existing?.candidate.selected ?? false,
        runId: existing?.runId, candidateId: existing?.candidate.id,
        metric: [item.heat, item.answers === undefined ? undefined : `${item.answers} 个回答`].filter(Boolean).join(" · ") };
    }),
  };
  // Filter before deduplication so a copy from another platform cannot replace
  // this platform's permalink or engagement units.
  const runs = state.runs.map((run) => ({ ...run, candidates: run.candidates.filter((candidate) => platformFor(candidate) === platform) }));
  const feed = composeCommunityFeed(runs, { now, expiryHours: 7 * 24, limit: 80 });
  const items = feed.items.map(({ runId, candidate }): TopicFeedItem => ({
    id: `${runId}:${candidate.id}`, runId, candidateId: candidate.id,
    title: candidate.briefing?.titleZh || candidate.title,
    originalTitle: candidate.briefing?.titleZh ? candidate.title : undefined,
    url: candidate.url, discussionUrl: candidate.engagement?.discussionUrl,
    summary: candidate.briefing?.summaryZh,
    observedAt: candidate.fetchedAt, selected: candidate.selected,
    metric: platform === "hackernews" ? [candidate.engagement?.points === undefined ? undefined : `${candidate.engagement.points} points`,
      candidate.engagement?.comments === undefined ? undefined : `${candidate.engagement.comments} 条评论`].filter(Boolean).join(" · ")
      : platform === "v2ex" && candidate.engagement?.comments !== undefined ? `${candidate.engagement.comments} 条回复` : undefined,
  }));
  return { platform, kind: "collection", status: !items.length ? "empty" : feed.lastUpdatedAt && Date.parse(now) - Date.parse(feed.lastUpdatedAt) > 24 * 3_600_000 ? "stale" : "ready", items, updatedAt: feed.lastUpdatedAt };
};

/** A user-selected headline enters StoryDesk as an explicitly unverified lead. */
export const retainZhihuTopic = (state: WorkflowState, item: ZhihuHotItem, capturedAt: string, now = new Date().toISOString()) => {
  const existing = findQuestion(state, item.id);
  if (existing) {
    existing.candidate.selected = true;
    return { runId: existing.runId, candidateId: existing.candidate.id };
  }
  const candidate: Candidate = {
    id: `zhihu-hot-${item.id}`, rawId: `zhihu:${item.id}`, sourceType: "zhihu", sourceName: "知乎热榜", sourceRole: "community",
    title: item.title, url: item.url, canonicalUrl: item.url, excerpt: "", publishedAt: capturedAt, publicationDateKnown: false, fetchedAt: capturedAt,
    hotlist: { rank: item.rank, heat: item.heat, observedAt: capturedAt },
    score: 0, scoreBreakdown: { consequence: 0, novelty: 0, evidence: 0, relevance: 0, timeliness: 0, confirmation: 0, penalty: 0 },
    heatScore: 0, heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 }, recommendationScore: 0,
    engagement: { comments: item.answers, discussionUrl: item.url }, clusterSize: 1, relatedSources: ["知乎热榜"],
    evidence: "仅有热榜标题，尚未读取问题或回答正文。", imageCount: 0, images: [], selected: true, status: "candidate",
  };
  const runId = `zhihu-hot-${item.id}`;
  state.runs.unshift({ id: runId, createdAt: now, updatedAt: now, collectedAt: capturedAt, completedAt: now, status: "ready",
    stage: "已保留热榜选题，待核对原文", windowHours: 24, sourceIds: ["zhihu-community"], scheduled: false,
    rawCount: 1, candidates: [candidate], logs: [], origin: "link-intake", intake: { sourceLabel: "知乎热榜", sourceUrl: item.url } });
  return { runId, candidateId: candidate.id };
};
