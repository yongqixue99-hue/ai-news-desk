import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { buildContentPackage } from "./package-desk.js";
import { buildStories } from "./story-desk.js";
import type { Candidate, WorkflowRun } from "./types.js";

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName: "Acme 官方",
  sourceRole: "official",
  title: "Acme releases Model X",
  url: "https://acme.example/model-x",
  excerpt: "Acme released Model X with an API and public weights.",
  publishedAt: "2026-08-30T01:00:00.000Z",
  fetchedAt: "2026-08-30T01:05:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Acme 官方"],
  evidence: "一手来源",
  briefing: {
    titleZh: "Acme 发布 Model X",
    summaryZh: "Acme 发布了 Model X，并同步开放 API 与权重。",
    basis: "full-source",
    generatedAt: "2026-08-30T01:10:00.000Z",
    providerId: "codex",
  },
  imageCount: 1,
  images: [{
    id: "image-1",
    url: "https://acme.example/model-x-chart.png",
    caption: "Model X 基准图表",
    attribution: "Acme",
    sourceUrl: "https://acme.example/model-x",
    selected: true,
    rights: "official",
    allowedPlatforms: ["wechat"],
  }],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (candidates: Candidate[]): WorkflowRun => ({
  id: "run-1",
  createdAt: "2026-08-30T01:05:00.000Z",
  updatedAt: "2026-08-30T01:05:00.000Z",
  status: "ready",
  stage: "完成",
  windowHours: 24,
  sourceIds: [],
  scheduled: false,
  rawCount: candidates.length,
  candidates,
  logs: [],
});

test("PackageDesk freezes claims, community quotations and governed images", () => {
  const state = createDefaultState();
  state.runs = [run([
    candidate("official"),
    candidate("community", {
      sourceType: "hackernews",
      sourceName: "Hacker News",
      sourceRole: "community",
      engagement: { points: 100, comments: 30, discussionUrl: "https://news.ycombinator.com/item?id=10" },
      excerpt: "[alice]: We tested the API in production and latency was stable. [bob]: The local weights solve a real deployment problem. [carol]: How does the license work for commercial use? [dan]: A workaround is to pin the runtime version. [erin]: However the published benchmark leaves out long context.",
    }),
  ])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    mode: "community",
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.status, "ready");
  assert.equal(contentPackage.facts[0]?.status, "supported");
  assert.equal(contentPackage.discussionSamples.length, 5);
  assert.match(contentPackage.communityEvidenceLabel, /不足以宣称多数或共识/u);
  assert.equal(contentPackage.assets[0]?.rightsDecision, "allowed");
  assert.equal(contentPackage.sources.every((source) => /^https?:\/\//u.test(source.url)), true);
});

test("PackageDesk refuses to turn a Watch story into a package", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("community", {
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    briefing: { titleZh: "未经核验的社区消息", summaryZh: "只有社区标题。", basis: "title", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "codex" },
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  assert.throws(() => buildContentPackage(state, { storyId: story.id, now: "2026-08-30T02:00:00.000Z" }), /证据不足/u);
});
