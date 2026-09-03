import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import type { Candidate, WorkflowRun } from "../../server/types.js";
import { Workbench } from "./Workbench.js";

const candidate = (publishedAt: string): Candidate => ({
  id: "candidate-1",
  rawId: "raw-1",
  sourceType: "rss",
  sourceName: "Example News",
  sourceRole: "verification",
  title: "The original English headline",
  url: "https://example.com/news",
  canonicalUrl: "https://example.com/news",
  excerpt: "An English excerpt that has not been translated yet.",
  publishedAt,
  fetchedAt: publishedAt,
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Example News"],
  evidence: "媒体报道",
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
});

test("candidate card keeps the original headline while the Chinese summary is being generated", () => {
  const state = createDefaultState();
  const now = new Date().toISOString();
  const run: WorkflowRun = {
    id: "run-generating-briefing",
    createdAt: now,
    updatedAt: now,
    status: "extracting",
    stage: "生成中文速读",
    windowHours: 48,
    sourceIds: [],
    scheduled: false,
    rawCount: 1,
    candidates: [candidate(now)],
    logs: [],
  };

  const markup = renderToStaticMarkup(createElement(Workbench, {
    settings: state.settings,
    sources: [],
    run,
    activeProvider: state.aiSettings.providers[0]!,
    busy: true,
    onSettings: () => undefined,
    onSourceToggle: () => undefined,
    onAddSource: () => undefined,
    onCollect: () => undefined,
    onCancel: () => undefined,
    onSelect: () => undefined,
    feedbackCount: 0,
    onFeedback: async () => undefined,
    onRestoreFeedback: async () => undefined,
    onTogglePersonalization: async () => undefined,
    onClearFeedback: async () => undefined,
    onGenerate: () => undefined,
    onCommunityDraft: async () => undefined,
    onOpenDrafts: () => undefined,
    onClearCandidates: async () => undefined,
    onBriefCandidates: async () => undefined,
    onQuickDraftUrl: async () => { throw new Error("not used"); },
    onQuickDraftXPost: async () => { throw new Error("not used"); },
    onQuickDraftScreenshot: async () => { throw new Error("not used"); },
    onConfirmQuickDraftReview: async () => undefined,
    onOpenAiSettings: () => undefined,
  }));

  assert.match(markup, /<h4>The original English headline<\/h4>/u);
  assert.doesNotMatch(markup, /<h4>中文摘要待生成<\/h4>/u);
  assert.match(markup, />中文摘要生成中</u);
});

test("collection recommendations use candidate-level wording and only expose implemented draft modes", () => {
  const state = createDefaultState();
  const now = new Date().toISOString();
  const run: WorkflowRun = {
    id: "run-ready",
    createdAt: now,
    updatedAt: now,
    status: "ready",
    stage: "生成中文速读",
    windowHours: 48,
    sourceIds: [],
    scheduled: false,
    rawCount: 1,
    candidates: [candidate(now)],
    logs: [],
  };

  const markup = renderToStaticMarkup(createElement(Workbench, {
    settings: state.settings,
    sources: [],
    run,
    activeProvider: state.aiSettings.providers[0]!,
    busy: false,
    onSettings: () => undefined,
    onSourceToggle: () => undefined,
    onAddSource: () => undefined,
    onCollect: () => undefined,
    onCancel: () => undefined,
    onSelect: () => undefined,
    feedbackCount: 0,
    onFeedback: async () => undefined,
    onRestoreFeedback: async () => undefined,
    onTogglePersonalization: async () => undefined,
    onClearFeedback: async () => undefined,
    onGenerate: () => undefined,
    onCommunityDraft: async () => undefined,
    onOpenDrafts: () => undefined,
    onClearCandidates: async () => undefined,
    onBriefCandidates: async () => undefined,
    onQuickDraftUrl: async () => { throw new Error("not used"); },
    onQuickDraftXPost: async () => { throw new Error("not used"); },
    onQuickDraftScreenshot: async () => { throw new Error("not used"); },
    onConfirmQuickDraftReview: async () => undefined,
    onOpenAiSettings: () => undefined,
  }));

  assert.match(markup, />本次采集优先候选</u);
  assert.match(markup, /候选级/u);
  assert.match(markup, /48 小时/u);
  assert.match(markup, />加入待写</u);
  assert.doesNotMatch(markup, /今日推荐|加入成稿|合并汇总/u);
});

test("selection summary names every queued candidate, surfaces gaps, and shows the exact draft count", () => {
  const state = createDefaultState();
  const now = new Date().toISOString();
  const first = {
    ...candidate(now),
    id: "candidate-selected-1",
    rawId: "raw-selected-1",
    title: "OpenAI launches a new model",
    sourceName: "OpenAI",
    evidence: "官方一手来源",
    imageCount: 2,
    selected: true,
  } satisfies Candidate;
  const second = {
    ...candidate(now),
    id: "candidate-selected-2",
    rawId: "raw-selected-2",
    title: "Anthropic publishes a safety report",
    sourceName: "Anthropic",
    evidence: "单源摘要",
    imageCount: 0,
    selected: true,
  } satisfies Candidate;
  const run: WorkflowRun = {
    id: "run-selected",
    createdAt: now,
    updatedAt: now,
    status: "ready",
    stage: "生成中文速读",
    windowHours: 48,
    sourceIds: [],
    scheduled: false,
    rawCount: 2,
    candidates: [first, second],
    logs: [],
  };

  const markup = renderToStaticMarkup(createElement(Workbench, {
    settings: state.settings,
    sources: [],
    run,
    activeProvider: state.aiSettings.providers[0]!,
    busy: false,
    onSettings: () => undefined,
    onSourceToggle: () => undefined,
    onAddSource: () => undefined,
    onCollect: () => undefined,
    onCancel: () => undefined,
    onSelect: () => undefined,
    feedbackCount: 0,
    onFeedback: async () => undefined,
    onRestoreFeedback: async () => undefined,
    onTogglePersonalization: async () => undefined,
    onClearFeedback: async () => undefined,
    onGenerate: () => undefined,
    onCommunityDraft: async () => undefined,
    onOpenDrafts: () => undefined,
    onClearCandidates: async () => undefined,
    onBriefCandidates: async () => undefined,
    onQuickDraftUrl: async () => { throw new Error("not used"); },
    onQuickDraftXPost: async () => { throw new Error("not used"); },
    onQuickDraftScreenshot: async () => { throw new Error("not used"); },
    onConfirmQuickDraftReview: async () => undefined,
    onOpenAiSettings: () => undefined,
  }));

  assert.match(markup, />选型总结</u);
  assert.match(markup, /OpenAI launches a new model/u);
  assert.match(markup, /OpenAI · 官方一手来源/u);
  assert.match(markup, /2 张来源图/u);
  assert.match(markup, /Anthropic publishes a safety report/u);
  assert.match(markup, /缺少来源图/u);
  assert.match(markup, /aria-label="从待写移除：OpenAI launches a new model"/u);
  assert.match(markup, />生成 2 篇草稿</u);
  assert.doesNotMatch(markup, /生成所选文章/u);
});
