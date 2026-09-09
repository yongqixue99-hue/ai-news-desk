import test from "node:test";
import assert from "node:assert/strict";
import { applySourceRunResult, sourceResultsForRun } from "./source-health.js";
import type { Candidate, RawHorizonItem, SourceConfig } from "./types.js";

const source = (id: string, name: string, kind: SourceConfig["kind"]): SourceConfig => ({
  id,
  name,
  kind,
  enabled: true,
  selected: true,
  category: "ai-news",
  discoveryOnly: false,
});

const item = (id: string, sourceType: string, feedName?: string): RawHorizonItem => ({
  id,
  source_type: sourceType,
  title: id,
  url: `https://example.com/${id}`,
  metadata: feedName ? { feed_name: feedName } : {},
});

const candidate = (rawId: string): Candidate => ({
  id: rawId,
  rawId,
  sourceType: "rss",
  sourceName: "OpenAI 官方",
  title: rawId,
  url: `https://example.com/${rawId}`,
  excerpt: "",
  publishedAt: "2026-08-11T00:00:00.000Z",
  fetchedAt: "2026-08-11T00:00:00.000Z",
  score: 10,
  scoreBreakdown: { consequence: 1, novelty: 1, evidence: 1, relevance: 1, timeliness: 1, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 40,
  clusterSize: 1,
  relatedSources: ["OpenAI 官方"],
  evidence: "一手来源",
  imageCount: null,
  images: [],
  selected: false,
  status: "candidate",
});

test("source health separates successful yield from a quiet collection window", () => {
  const sources = [
    source("openai", "OpenAI 官方", "rss"),
    source("bbc", "BBC Technology", "rss"),
    source("hn", "Hacker News", "hackernews"),
  ];
  const rawItems = [
    item("openai-1", "rss", "OpenAI 官方"),
    item("bbc-1", "rss", "BBC Technology"),
  ];
  const results = sourceResultsForRun(sources, rawItems, [candidate("openai-1")]);
  assert.deepEqual(results.map(({ sourceId, status, healthImpact, rawCount, candidateCount }) => ({ sourceId, status, healthImpact, rawCount, candidateCount })), [
    { sourceId: "openai", status: "healthy", healthImpact: "success", rawCount: 1, candidateCount: 1 },
    { sourceId: "bbc", status: "warning", healthImpact: "success", rawCount: 1, candidateCount: 0 },
    { sourceId: "hn", status: "warning", healthImpact: "success", rawCount: 0, candidateCount: 0 },
  ]);
  assert.match(results[0].detail, /连接与解析正常/);
  assert.match(results[1].detail, /没有窗口内候选/);
  assert.match(results[2].detail, /不判为连接故障/);
});

test("old parsed entries do not make a source fully healthy when none survive the current window", () => {
  const target = source("archive", "旧条目来源", "rss");
  const [result] = sourceResultsForRun(
    [target],
    [item("old-1", "rss", target.name), item("old-2", "rss", target.name)],
    [],
  );

  assert.equal(result.status, "warning");
  assert.equal(result.healthImpact, "success");
  assert.equal(result.rawCount, 2);
  assert.equal(result.candidateCount, 0);
  assert.match(result.detail, /发布时间、日期\/关键词、去重或当前主题频道/);
});

test("consecutive zero yield explains likely editorial causes without reporting an outage", () => {
  const target = source("quiet", "安静来源", "rss");
  target.health = "warning";
  target.lastCheckedAt = "2026-08-30T10:00:00.000Z";
  target.lastRawCount = 4;
  target.lastCandidateCount = 0;
  target.consecutiveFailures = 2;

  const [result] = sourceResultsForRun([target], [], []);
  assert.equal(result.status, "warning");
  assert.equal(result.healthImpact, "success");
  assert.match(result.detail, /连续多轮/);
  assert.match(result.detail, /主题\/频道路由/);
  assert.match(result.detail, /不判为连接故障/);

  applySourceRunResult(target, result, "2026-08-31T10:00:00.000Z");
  assert.equal(target.health, "warning");
  assert.equal(target.lastSuccessfulAt, "2026-08-31T10:00:00.000Z");
  assert.equal(target.consecutiveFailures, 0);
});

test("a connector-specific failure is reported without marking unrelated sources as failed", () => {
  const sources = [
    source("zhihu", "知乎科技讨论", "zhihu"),
    source("openai", "OpenAI 官方", "rss"),
  ];
  const results = sourceResultsForRun(sources, [item("openai-1", "rss", "OpenAI 官方")], [], {
    zhihu: "知乎 CLI 超时或尚未登录",
  });

  assert.equal(results[0].status, "error");
  assert.match(results[0].detail, /尚未登录/);
  assert.equal(results[1].status, "warning");
  assert.equal(results[1].healthImpact, "success");
  assert.match(results[1].detail, /连接与解析正常/);
  assert.doesNotMatch(results[1].detail, /知乎/);
});

test("X adapter output remains attributable when optional feed metadata is absent", () => {
  const target = source("x-ai", "AI 官方账号（X）", "x");
  const [result] = sourceResultsForRun([target], [item("x:200", "x")], [candidate("x:200")]);

  assert.equal(result.rawCount, 1);
  assert.equal(result.candidateCount, 1);
  assert.equal(result.status, "healthy");
});

test("neutral collection yield preserves health while explicit failures change the streak", () => {
  const target = source("microsoft", "Microsoft 官方博客", "rss");
  target.health = "healthy";
  target.consecutiveFailures = 0;
  target.lastSuccessfulAt = "2026-08-18T10:00:00.000Z";

  applySourceRunResult(target, {
    sourceId: target.id,
    sourceName: target.name,
    status: "warning",
    healthImpact: "neutral",
    rawCount: 0,
    candidateCount: 0,
    detail: "本轮时间窗口内没有新条目，不计为来源失败",
  }, "2026-08-18T12:00:00.000Z");
  assert.equal(target.health, "healthy");
  assert.equal(target.consecutiveFailures, 0);
  assert.equal(target.lastSuccessfulAt, "2026-08-18T10:00:00.000Z");

  applySourceRunResult(target, {
    sourceId: target.id,
    sourceName: target.name,
    status: "error",
    healthImpact: "failure",
    rawCount: 0,
    candidateCount: 0,
    detail: "来源连接失败：CLI 未登录",
  }, "2026-08-18T13:00:00.000Z");
  assert.equal(target.health, "error");
  assert.equal(target.consecutiveFailures, 1);
});

test("source IDs retain attribution after a rename and prevent same-name sources sharing yield", () => {
  const sources = [source("one", "Renamed", "rss"), source("two", "Renamed", "rss")];
  const raw = { ...item("r1", "rss", "Old name"), metadata: { source_id: "one", feed_name: "Old name" } };
  const results = sourceResultsForRun(sources, [raw], [candidate("r1")]);
  assert.deepEqual(results.map((result) => [result.rawCount, result.candidateCount]), [[1, 1], [0, 0]]);
});

test("partial source coverage is a visible warning while successful items remain usable", () => {
  const target = source("one", "Publisher", "rss");
  const routes = [
    { sourceId: "one", url: "https://example.com/feed", status: "success" as const, rawCount: 1 },
    { sourceId: "one", url: "https://example.com/sitemap", status: "error" as const, rawCount: 0, detail: "HTTP 503" },
  ];
  const [result] = sourceResultsForRun([target], [item("r1", "rss", "Publisher")], [candidate("r1")], {}, routes);
  assert.equal(result.status, "warning");
  assert.equal(result.healthImpact, "success");
  assert.equal(result.candidateCount, 1);
  assert.match(result.detail, /部分.*路线失败/);
  assert.match(result.detail, /503/);
  assert.deepEqual(result.routes, routes);
});
