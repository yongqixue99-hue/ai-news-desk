import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { buildStories, buildTodayView } from "./story-desk.js";
import type { Candidate, WorkflowRun } from "./types.js";

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName: "Official",
  sourceRole: "official",
  title: "Acme releases Model X",
  url: "https://acme.example/model-x",
  canonicalUrl: "https://acme.example/model-x",
  excerpt: "Acme released Model X with a documented API and public weights.",
  publishedAt: "2026-08-30T01:00:00.000Z",
  fetchedAt: "2026-08-30T01:05:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Official"],
  evidence: "一手来源",
  briefing: {
    titleZh: "Acme 发布 Model X",
    summaryZh: "Acme 发布了 Model X，并同步开放 API 与权重。",
    basis: "full-source",
    generatedAt: "2026-08-30T01:10:00.000Z",
    providerId: "codex",
    explanation: {
      voiceVersion: 2,
      whatHappenedZh: "Acme 正式发布 Model X，并在同一天开放模型 API 和公开权重。",
      readerBriefZh: "Acme 发布了 Model X，API 和公开权重在同一天开放。生产环境是否稳定，还要等开发者实测。",
      keyPointsZh: ["开发者可以调用公开 API。", "模型权重允许本地测试。"],
      whyItMattersZh: "开发者可以比较托管 API 与本地部署两种使用方式。",
      affectedZh: "需要评估模型部署方式的 AI 开发者。",
      editorNoteZh: "API 和权重都已开放，可以写一篇简短发布稿。",
      unknownsZh: ["真实生产负载下的稳定性仍需验证。"],
    },
  },
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (id: string, candidates: Candidate[]): WorkflowRun => ({
  id,
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

test("StoryDesk merges official, news and community signals into one story", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [
    candidate("official"),
    candidate("news", {
      sourceName: "Newsroom",
      sourceRole: "verification",
      url: "https://news.example/acme-model-x",
      canonicalUrl: "https://news.example/acme-model-x",
      title: "Acme launches its Model X API and weights",
    }),
    candidate("community", {
      sourceType: "hackernews",
      sourceName: "Hacker News",
      sourceRole: "community",
      url: "https://acme.example/model-x",
      engagement: { points: 220, comments: 80, discussionUrl: "https://news.ycombinator.com/item?id=1" },
      excerpt: "--- Top Comments --- [alice]: This is a detailed practitioner response about deployment tradeoffs and API reliability. [bob]: Another concrete response about model weights and local testing. [c]: A third useful comment about latency and cost. [d]: A fourth comment about integration. [e]: A fifth comment about operational experience.",
      communityInsight: {
        summaryZh: "讨论主要集中在部署成本和 API 稳定性。",
        focusZh: ["本地部署成本", "API 稳定性"],
        basis: "discussion-excerpt",
        generatedAt: "2026-08-30T01:10:00.000Z",
        providerId: "codex",
      },
    }),
  ])];

  const stories = buildStories(state, "2026-08-30T02:00:00.000Z");
  assert.equal(stories.length, 1);
  assert.equal(stories[0]?.factSourceCount, 2);
  assert.equal(stories[0]?.communitySourceCount, 1);
  assert.equal(stories[0]?.assignment.mode, "community");
  assert.equal(stories[0]?.communitySummary, "讨论主要集中在部署成本和 API 稳定性。");
  assert.equal(stories[0]?.explanation.status, "ready");
  assert.equal(stories[0]?.explanation.voiceVersion, 2);
  assert.equal(stories[0]?.explanation.readerBrief, "Acme 发布了 Model X，API 和公开权重在同一天开放。生产环境是否稳定，还要等开发者实测。");
  assert.equal(stories[0]?.explanation.editorNote, "API 和权重都已开放，可以写一篇简短发布稿。");
  assert.equal(stories[0]?.explanation.whatHappened, "Acme 正式发布 Model X，并在同一天开放模型 API 和公开权重。");
  assert.deepEqual(stories[0]?.explanation.keyPoints, ["开发者可以调用公开 API。", "模型权重允许本地测试。"]);
  assert.equal(stories[0]?.explanation.sources.length, 2);
});

test("weak community-only signals stay in watch instead of becoming a draft", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [candidate("community", {
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    engagement: { comments: 100, points: 300, discussionUrl: "https://news.ycombinator.com/item?id=2" },
    briefing: { titleZh: "社区流传一条未经核验的消息", summaryZh: "目前只有社区标题。", basis: "title", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "codex" },
  })])];

  const today = buildTodayView(state, "2026-08-30T02:00:00.000Z");
  assert.equal(today.mustReads.length, 0);
  assert.equal(today.watching[0]?.assignment.mode, "watch");
  assert.match(today.watching[0]?.assignment.blockers[0] ?? "", /证据不足/u);
  assert.equal(today.watching[0]?.explanation.status, "partial");
  assert.equal(today.watching[0]?.explanation.basis, "title");
  assert.match(today.watching[0]?.explanation.unknowns[0] ?? "", /只有标题级证据/u);
});

test("legacy fixed-field explanations remain readable but request a v2 editorial refresh", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [candidate("legacy", {
    briefing: {
      titleZh: "Acme 发布 Model X",
      summaryZh: "Acme 发布了 Model X。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
      explanation: {
        whatHappenedZh: "Acme 发布了 Model X，并开放 API。",
        keyPointsZh: ["API 已经开放。"],
        whyItMattersZh: "开发者可以开始测试。",
        unknownsZh: ["价格尚未说明。"],
      },
    },
  })])];

  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0];
  assert.equal(story?.explanation.status, "partial");
  assert.equal(story?.explanation.voiceVersion, 1);
  assert.equal(story?.explanation.readerBrief, "Acme 发布了 Model X，并开放 API。");
});

test("Story id remains stable when extraction adds a canonical URL", () => {
  const state = createDefaultState();
  state.runs = [run("run-1", [candidate("official", {
    url: "https://acme.example/news/model-x?utm_source=feed",
    canonicalUrl: undefined,
  })])];

  const before = buildStories(state, "2026-08-30T02:00:00.000Z")[0];
  state.runs[0]!.candidates[0]!.canonicalUrl = "https://acme.example/model-x";
  const after = buildStories(state, "2026-08-30T02:00:00.000Z")[0];

  assert.ok(before);
  assert.equal(after?.id, before.id);
});
