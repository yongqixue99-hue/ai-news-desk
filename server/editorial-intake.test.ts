import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { inspectEditorialIntake } from "./editorial-intake.js";
import { buildContentPackage } from "./package-desk.js";
import type { Candidate, WorkflowRun } from "./types.js";

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "signal-1",
  rawId: "hackernews:1",
  sourceType: "hackernews",
  sourceName: "Hacker News",
  sourceRole: "community",
  title: "CEO fired developers to make room for AI",
  url: "https://github.com/example/open-executive",
  canonicalUrl: "https://github.com/example/open-executive",
  excerpt: "--- Top Comments --- [reader]: One cached opinion that must not become the article.",
  publishedAt: "2026-09-01T01:00:00.000Z",
  fetchedAt: "2026-09-01T01:05:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 12,
  heatBreakdown: { engagement: 3, sourceReach: 3, crossSource: 3, freshness: 3 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Hacker News"],
  evidence: "社区线索",
  briefing: {
    titleZh: "开源 AI 高管项目受到关注",
    summaryZh: "OpenExecutive 提供由多个专业代理组成的虚拟高管入口。",
    basis: "full-source",
    generatedAt: "2026-09-01T01:10:00.000Z",
    providerId: "codex",
    explanation: {
      voiceVersion: 2,
      whatHappenedZh: "OpenExecutive 公开了一个由多个专业代理组成的虚拟高管入口。",
      readerBriefZh: "OpenExecutive 是一个开源虚拟高管项目，近日因 Hacker News 帖子重新受到关注。",
      keyPointsZh: ["项目已开源。", "多个专业代理协同工作。"],
      whyItMattersZh: "读者可以判断它是否具有真实产品价值。",
      unknownsZh: ["帖子标题中的裁员说法没有一手来源。"],
    },
  },
  engagement: { points: 800, comments: 500, discussionUrl: "https://news.ycombinator.com/item?id=1" },
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (item: Candidate): WorkflowRun => ({
  id: "run-1",
  createdAt: "2026-09-01T01:05:00.000Z",
  updatedAt: "2026-09-01T01:05:00.000Z",
  status: "ready",
  stage: "完成",
  windowHours: 24,
  sourceIds: [],
  scheduled: false,
  rawCount: 1,
  candidates: [item],
  logs: [],
});

test("a linked community post recommends news and treats the external page as factual evidence", () => {
  const state = createDefaultState();
  state.runs = [run(candidate())];
  const result = inspectEditorialIntake(state, { runId: "run-1", candidateId: "signal-1" }, "2026-09-01T02:00:00.000Z");

  assert.equal(result.intake.sourceKind, "linked-community");
  assert.equal(result.intake.recommendedIntent, "news");
  assert.equal(result.story.factSourceCount, 1);
  assert.equal(result.story.communitySourceCount, 1);
  assert.equal(result.intake.options.find((option) => option.intent === "news")?.available, true);
  assert.equal(result.intake.options.find((option) => option.intent === "community")?.available, false);
  assert.match(result.intake.recommendationReason, /先读取外部页面/u);

  const contentPackage = buildContentPackage(state, {
    storyId: result.story.id,
    mode: "brief",
    intent: "news",
    intakeReason: result.intake.recommendationReason,
    now: "2026-09-01T02:00:00.000Z",
  });
  const factSource = contentPackage.sources.find((source) => !source.isCommunity);
  const discussionSource = contentPackage.sources.find((source) => source.isCommunity);
  assert.equal(factSource?.url, "https://github.com/example/open-executive");
  assert.equal(discussionSource?.url, "https://news.ycombinator.com/item?id=1");
  assert.equal(contentPackage.intent, "news");
  assert.equal(contentPackage.discussionSamples.length, 0, "news packages must not carry a comment corpus into generation");
  assert.equal(contentPackage.facts.some((fact) => /CEO fired developers/u.test(fact.text)), false);
  assert.ok(contentPackage.facts.every((fact) => fact.sourceUrls?.includes("https://github.com/example/open-executive")));
});

test("a title-only community link stays news-directed but blocks generation until the source is read", () => {
  const state = createDefaultState();
  state.runs = [run(candidate({
    briefing: {
      titleZh: "社区流传一条未经核验的消息",
      summaryZh: "目前只有帖子标题。",
      basis: "title",
      generatedAt: "2026-09-01T01:10:00.000Z",
      providerId: "codex",
    },
  }))];
  const result = inspectEditorialIntake(state, { runId: "run-1", candidateId: "signal-1" }, "2026-09-01T02:00:00.000Z");

  assert.equal(result.intake.recommendedIntent, "news");
  assert.equal(result.story.factSourceCount, 0);
  assert.equal(result.intake.options.find((option) => option.intent === "news")?.available, false);
  assert.match(result.intake.options.find((option) => option.intent === "news")?.reason ?? "", /先读取外部来源/u);
});

test("linked-source reading cards exclude repository badges and duplicate preview images", () => {
  const state = createDefaultState();
  state.runs = [run(candidate({
    images: [
      { id: "hero-a", url: "https://opengraph.githubassets.com/a/example/repo", caption: "GitHub - example/repo: Open Executive", attribution: "GitHub", sourceUrl: "https://github.com/example/repo", selected: true, rights: "check-required" },
      { id: "hero-b", url: "https://opengraph.githubassets.com/b/example/repo", caption: "GitHub - example/repo: Open Executive", attribution: "GitHub", sourceUrl: "https://github.com/example/repo", selected: true, rights: "check-required" },
      { id: "license", url: "https://camo.githubusercontent.com/license", caption: "License: Apache 2.0", attribution: "GitHub", sourceUrl: "https://github.com/example/repo", selected: true, rights: "check-required" },
      { id: "demo", url: "https://example.com/demo.jpg", caption: "Open Executive 产品演示", attribution: "GitHub", sourceUrl: "https://github.com/example/repo", selected: true, rights: "check-required" },
    ],
    imageCount: 4,
  }))];

  const result = inspectEditorialIntake(state, { runId: "run-1", candidateId: "signal-1" }, "2026-09-01T02:00:00.000Z");
  assert.deepEqual(result.story.images.map((image) => image.id), ["hero-a", "demo"]);
});
