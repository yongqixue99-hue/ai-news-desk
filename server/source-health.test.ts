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
    { sourceId: "bbc", status: "healthy", healthImpact: "success", rawCount: 1, candidateCount: 0 },
    { sourceId: "hn", status: "warning", healthImpact: "neutral", rawCount: 0, candidateCount: 0 },
  ]);
  assert.match(results[2].detail, /不计为失败/);
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
  assert.equal(results[1].status, "healthy");
  assert.doesNotMatch(results[1].detail, /知乎/);
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
