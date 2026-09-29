import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import type { Candidate, WorkflowRun } from "../types.js";

import { CommunityWorkspace, communityBriefingLabel } from "./CommunityWorkspace.js";
import { RunsPage, runOriginLabel } from "./RunsPage.js";

const now = new Date().toISOString();
const candidate: Candidate = {
  id: "community-status", rawId: "raw-status", sourceType: "hackernews", sourceName: "Hacker News", sourceRole: "community",
  title: "An original community headline", url: "https://example.com/status", excerpt: "The original source excerpt.",
  publishedAt: now, fetchedAt: now, score: 10,
  scoreBreakdown: { consequence: 2, novelty: 2, evidence: 2, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 30, heatBreakdown: { engagement: 20, sourceReach: 0, crossSource: 0, freshness: 10 }, recommendationScore: 70,
  clusterSize: 1, relatedSources: ["Hacker News"], evidence: "社区讨论", imageCount: 0, images: [], selected: false, status: "candidate",
};
const run: WorkflowRun = { id: "run-status", createdAt: now, updatedAt: now, status: "ready", stage: "候选就绪", windowHours: 24, sourceIds: [], scheduled: false, rawCount: 1, candidates: [candidate], logs: [] };
const renderCommunity = (runs: WorkflowRun[]) => renderToStaticMarkup(createElement(CommunityWorkspace, {
  runs, sources: [], settings: createDefaultState().settings,
  onFeedback: async () => undefined, onRestoreFeedback: async () => undefined,
  onCreateDraft: async () => undefined, onAutoBrief: async () => undefined,
}));

test("empty community feed never claims Chinese summaries are ready", () => {
  const markup = renderCommunity([]);
  assert.doesNotMatch(markup, /中文速览已自动准备/u);
  assert.match(markup, /等待首批社区信号/u);
});

test("unprepared community summaries keep original content visible and show a pending state", () => {
  const markup = renderCommunity([run]);
  assert.doesNotMatch(markup, /中文速览已自动准备/u);
  assert.match(markup, /1 条待补全/u);
  assert.match(markup, /An original community headline/u);
});

test("run history identifies imported work instead of calling every unscheduled run manual", () => {
  const markup = renderToStaticMarkup(createElement(RunsPage, {
    runs: [{ ...run, origin: "screenshot-intake" }, { ...run, id: "link-run", origin: "link-intake" }, { ...run, id: "evidence-run", origin: "evidence-supplement" }],
    aiRunTraces: [], onOpenRun: () => undefined, onRetry: () => undefined, onOpenSchedule: () => undefined,
  }));
  assert.match(markup, /截图导入/u);
  assert.match(markup, /链接导入/u);
  assert.match(markup, /补充证据/u);
});

test("community summary status follows the available results, including a partial or failed request", () => {
  assert.equal(communityBriefingLabel("error", 3, 2), "部分中文速览暂未生成 · 2 条待补全");
  assert.equal(communityBriefingLabel("loading", 3, 2), "正在补全中文速览");
  assert.equal(communityBriefingLabel("complete", 3, 2), "2 条待补全 · 可先查看原始内容");
  assert.equal(communityBriefingLabel("idle", 3, 0), "中文速览已准备");
  assert.equal(communityBriefingLabel("complete", 0, 0), "等待首批社区信号");
});

test("manual and scheduled collection origins remain distinct from imported work", () => {
  assert.equal(runOriginLabel({ scheduled: false }), "手动采集");
  assert.equal(runOriginLabel({ scheduled: false, origin: "collection" }), "手动采集");
  assert.equal(runOriginLabel({ scheduled: true, origin: "collection" }), "定时采集");
  assert.equal(runOriginLabel({ scheduled: false, origin: "evidence-supplement" }), "补充证据");
});
