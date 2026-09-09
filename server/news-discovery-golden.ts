import path from "node:path";
import { fileURLToPath } from "node:url";
import { createDefaultState } from "./defaults.js";
import { collectDiscoveryCandidates } from "./discovery-funnel.js";
import { buildStories, buildTodayView } from "./story-desk.js";
import { parsePortableFeed } from "./structured-collector.js";
import { newsDiscoveryGoldenCases, type NewsDiscoveryGoldenCase } from "./fixtures/news-discovery-golden.js";
import type { CollectionFunnel } from "./types.js";

const xml = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");

export interface NewsDiscoveryGoldenResult {
  id: string;
  label: string;
  kind: NewsDiscoveryGoldenCase["kind"];
  category: string;
  passed: boolean;
  failures: string[];
  funnel: CollectionFunnel;
  storyCount: number;
  importantStoryCount: number;
  recommendationCount: number;
  recommendationTitles: string[];
  releaseHighlightCount: number;
  backlogCount: number;
  watchingCount: number;
  opportunities: Array<{ title: string; lane: string | undefined; reason: string | undefined }>;
}

/**
 * Replay known events through the real feed parser, collection policy, scorer,
 * Story aggregation and Today recommendation. The transport envelope is
 * synthesized: this does not measure live fetch recall, extraction or AI prose.
 */
export const evaluateNewsDiscoveryCase = (fixture: NewsDiscoveryGoldenCase): NewsDiscoveryGoldenResult => {
  const feed = `<rss version="2.0"><channel><title>${xml(fixture.sourceName)}</title>${fixture.items.map((item, index) =>
    `<item><guid>${xml(`${fixture.id}:${index}`)}</guid><title>${xml(item.title)}</title><link>${xml(item.url)}</link>${item.publishedAt === undefined ? "" : `<pubDate>${xml(item.publishedAt)}</pubDate>`}<description>${xml(item.excerpt)}</description></item>`,
  ).join("")}</channel></rss>`;
  const raw = parsePortableFeed(feed, {
    feedUrl: "https://fixture.invalid/feed.xml", feedName: fixture.sourceName,
    sourceId: `eval:${fixture.id}`, sourceRole: fixture.sourceRole, category: "AI",
    fetchedAt: fixture.now,
  });
  const { candidates, funnel } = collectDiscoveryCandidates(raw, {
    windowHours: fixture.windowHours, topicIds: ["ai"], now: Date.parse(fixture.now),
    filters: fixture.filters, personalizationEnabled: false,
  });
  // Only explicit adversarial cases add a translation. All historical cases
  // exercise the original official title and paraphrased source excerpt.
  for (const candidate of candidates) {
    const sourceItem = fixture.items.find((item) => item.url === candidate.url);
    if (sourceItem?.misleadingTitleZh) candidate.briefing = {
      titleZh: sourceItem.misleadingTitleZh, summaryZh: sourceItem.excerpt,
      basis: "excerpt", generatedAt: fixture.now, providerId: "synthetic-adversarial-fixture",
    };
  }
  const state = createDefaultState();
  state.sources = [];
  state.settings.personalizationEnabled = false;
  state.settings.editorialProfileEnabled = false;
  state.settings.recommendationMode = "focused";
  state.runs = [{
    id: `eval:${fixture.id}`, createdAt: fixture.now, updatedAt: fixture.now,
    completedAt: fixture.now, collectedAt: fixture.now,
    status: "ready", stage: "离线新闻发现评测", windowHours: fixture.windowHours,
    sourceIds: [], scheduled: false, rawCount: raw.length, candidates, logs: [],
  }];
  const stories = buildStories(state, fixture.now);
  const today = buildTodayView(state, fixture.now);
  const recommendations = [...today.mustReads, ...today.secondary, ...(today.interesting ?? [])];
  const highlights = today.releaseHighlights ?? [];
  const failures: string[] = [];
  if (raw.length !== fixture.items.length) failures.push(`解析丢失：输入 ${fixture.items.length}，得到 ${raw.length}`);
  if (funnel.candidateCount + funnel.rejections.reduce((sum, reason) => sum + reason.count, 0) !== raw.length) {
    failures.push("采集漏斗不能完整解释原始记录去向");
  }
  if (fixture.expectation === "recommend") {
    if (!candidates.length) failures.push("重要事件未进入候选");
    if (!stories.length) failures.push("重要事件未形成 Story");
    if (!recommendations.length) failures.push("重要事件未进入今日精选");
  } else if (fixture.expectation === "reject-before-candidate") {
    if (candidates.length || stories.length || recommendations.length || highlights.length) failures.push("无效日期或不匹配查询仍进入候选/推荐");
  } else if (fixture.expectation === "not-important") {
    if (stories.some((story) => story.opportunity?.lane === "important")) failures.push("普通动态或传闻被升格为重要事件");
    if (highlights.length) failures.push("普通动态或传闻误入近期重要发布");
    if ([...recommendations, ...today.backlog].some((story) => story.opportunity?.lane === "important")) failures.push("普通动态或传闻占用重要推荐位");
  } else if (fixture.expectation === "one-story") {
    if (candidates.length !== 1 || stories.length !== 1 || recommendations.length !== 1) failures.push(`重复入口未保持一条：候选 ${candidates.length} / Story ${stories.length} / 精选 ${recommendations.length}`);
    if (funnel.rejections.find((reason) => reason.code === "duplicate-url")?.count !== fixture.items.length - 1) failures.push("重复链接未在 URL 阶段解释");
  }
  return {
    id: fixture.id, label: fixture.label, kind: fixture.kind, category: fixture.category,
    passed: failures.length === 0, failures, funnel, storyCount: stories.length,
    importantStoryCount: stories.filter((story) => story.opportunity?.lane === "important").length,
    recommendationCount: recommendations.length, recommendationTitles: recommendations.map((story) => story.originalTitle),
    releaseHighlightCount: highlights.length,
    backlogCount: today.backlog.length, watchingCount: today.watching.length,
    opportunities: stories.map((story) => ({ title: story.originalTitle, lane: story.opportunity?.lane, reason: story.opportunity?.reason })),
  };
};

export const runNewsDiscoveryGoldenSet = (fixtures = newsDiscoveryGoldenCases) => {
  const results = fixtures.map(evaluateNewsDiscoveryCase);
  const positives = results.filter((result) => result.kind === "historical-positive");
  const negatives = results.filter((result) => result.kind === "synthetic-negative");
  const nonDuplicates = negatives.filter((result) => result.category !== "duplicate");
  return {
    scope: "offline-primary-event-replay; synthetic-RSS-envelope; no-live-fetch-or-AI-quality-claim",
    total: results.length, passed: results.filter((result) => result.passed).length,
    failed: results.filter((result) => !result.passed).length,
    positive: {
      total: positives.length, parsed: positives.filter((result) => result.funnel.rawCount > 0).length,
      dateAccepted: positives.filter((result) => result.funnel.dateAcceptedCount > 0).length,
      candidate: positives.filter((result) => result.funnel.candidateCount > 0).length,
      story: positives.filter((result) => result.storyCount > 0).length,
      recommended: positives.filter((result) => result.recommendationCount > 0).length,
      releaseHighlight: positives.filter((result) => result.releaseHighlightCount > 0).length,
    },
    negative: {
      total: negatives.length, passed: negatives.filter((result) => result.passed).length,
      importantFalsePositives: nonDuplicates.filter((result) => result.importantStoryCount > 0).length,
      releaseFalsePositives: nonDuplicates.filter((result) => result.releaseHighlightCount > 0).length,
      duplicateChecksPassed: negatives.filter((result) => result.category === "duplicate" && result.passed).length,
    },
    categoryCounts: Object.fromEntries([...new Set(fixtures.map((fixture) => fixture.category))]
      .map((category) => [category, fixtures.filter((fixture) => fixture.category === category).length])),
    failures: results.filter((result) => !result.passed), results,
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = runNewsDiscoveryGoldenSet();
  if (process.argv.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`新闻发现离线黄金集：${report.passed}/${report.total} 通过`);
    console.log(`官方历史正例 ${report.positive.total}：解析 ${report.positive.parsed} → 日期合格 ${report.positive.dateAccepted} → 候选 ${report.positive.candidate} → Story ${report.positive.story} → 今日精选 ${report.positive.recommended}`);
    console.log(`合成反例 ${report.negative.total}：重要事件误选 ${report.negative.importantFalsePositives} · 重要发布误选 ${report.negative.releaseFalsePositives} · 重复入口通过 ${report.negative.duplicateChecksPassed}/5`);
    console.log("范围：固定历史时钟的解析与推荐回放；不代表实时热点采集覆盖率、原文抽取或 AI 改写质量。");
    for (const failure of report.failures) console.error(`- ${failure.id}: ${failure.failures.join("；")}`);
  }
  if (report.failed) process.exitCode = 1;
}
