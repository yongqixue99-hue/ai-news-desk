import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import type { Candidate, WorkflowRun } from "../../server/types.js";
import { Workbench } from "./Workbench.js";
import { load } from "cheerio";

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

const layoutFixture = () => {
  const state = createDefaultState();
  const now = new Date().toISOString();
  const items = Array.from({ length: 10 }, (_, index) => ({
    ...candidate(now), id: `layout-${index}`, rawId: `layout-${index}`,
    title: `Original source headline ${index}`, url: `https://example.com/layout/${index}`,
    canonicalUrl: `https://example.com/layout/${index}`, recommendationScore: 90 - index,
    selected: index < 2, briefing: { titleZh: `隔离候选 ${index}`, summaryZh: "只有来源支持的信息才能进入文章。", basis: "full-source" as const, generatedAt: now, providerId: "fixture" },
  }));
  return renderToStaticMarkup(createElement(Workbench, {
    settings: state.settings, sources: [], activeProvider: state.aiSettings.providers[0]!,
    run: { id: "layout-run", createdAt: now, updatedAt: now, status: "ready", stage: "完成", windowHours: 48, sourceIds: [], scheduled: false, rawCount: 10, candidates: items, logs: [] },
    busy: false, feedbackCount: 0,
    onSettings: () => undefined, onSourceToggle: () => undefined, onAddSource: () => undefined,
    onCollect: () => undefined, onCancel: () => undefined, onSelect: () => undefined,
    onFeedback: async () => undefined, onRestoreFeedback: async () => undefined,
    onTogglePersonalization: async () => undefined, onClearFeedback: async () => undefined,
    onGenerate: () => undefined, onCommunityDraft: async () => undefined, onOpenDrafts: () => undefined,
    onClearCandidates: async () => undefined, onBriefCandidates: async () => undefined,
    onQuickDraftUrl: async () => { throw new Error("fixture only"); },
    onQuickDraftXPost: async () => { throw new Error("fixture only"); },
    onQuickDraftScreenshot: async () => { throw new Error("fixture only"); },
    onConfirmQuickDraftReview: async () => undefined, onOpenAiSettings: () => undefined,
  }));
};

test("collection dates stay available in a closed disclosure with the original input labels", () => {
  const $ = load(layoutFixture());
  const dates = $('input[aria-label="开始日期"]').closest("details");
  assert.equal(dates.length, 1);
  assert.equal(dates.attr("open"), undefined);
  assert.equal(dates.find('input[aria-label="结束日期"]').length, 1);
  assert.match(dates.find("summary").text(), /搜寻日期/u);
  assert.equal($('input[type="search"]').length, 1);
  assert.match($(".collect-actions").text(), /开始采集/u);
});

test("all candidate rows preserve original headlines, source links, selection and editorial actions", () => {
  const $ = load(layoutFixture());
  assert.equal($(".candidate-table").length, 0);
  for (let index = 0; index < 10; index++) {
    const row = $(`#candidate-layout-${index}`);
    assert.equal(row.prop("tagName"), "ARTICLE");
    assert.equal(row.find("h4").text(), `隔离候选 ${index}`);
    assert.match(row.text(), new RegExp(`Original source headline ${index}`));
    assert.equal(row.find(`a[href="https://example.com/layout/${index}"]`).length, 1);
    assert.equal(row.attr("tabindex"), "0");
  }
  assert.equal($('[aria-label="感兴趣：Original source headline 9"]').length, 1);
  assert.equal($('[aria-label="不感兴趣：Original source headline 9"]').length, 1);
  assert.equal($('[aria-label="加入待写：隔离候选 9"]').length, 1);
  assert.match($(".selection-summary").text(), /Example News · 媒体报道/u);
  assert.match($(".run-rail-actions").text(), /生成 2 篇草稿/u);
});

test("candidate card keeps the original headline while the Chinese summary is being generated", () => {
  const state = createDefaultState();
  state.settings.recommendationMode = "balanced";
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
  state.settings.recommendationMode = "balanced";
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

  assert.match(markup, />待写选题 /u);
  assert.match(markup, /OpenAI launches a new model/u);
  assert.match(markup, /OpenAI · 官方一手来源/u);
  assert.match(markup, /2 张来源图/u);
  assert.match(markup, /Anthropic publishes a safety report/u);
  assert.match(markup, /缺少来源图/u);
  assert.match(markup, /aria-label="从待写移除：OpenAI launches a new model"/u);
  assert.match(markup, />生成 2 篇草稿</u);
  assert.doesNotMatch(markup, /生成所选文章/u);
});
