import assert from "node:assert/strict";
import test from "node:test";
import { composeCommunityFeed, isCommunityCandidate } from "./community-feed.js";
import type { Candidate, WorkflowRun } from "./types.js";

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  rawId: id,
  sourceType: "hackernews",
  sourceName: "Hacker News",
  sourceRole: "community",
  title: `Story ${id}`,
  url: `https://example.com/${id}`,
  excerpt: "Community excerpt",
  publishedAt: "2026-08-27T08:00:00.000Z",
  fetchedAt: "2026-08-27T09:00:00.000Z",
  score: 10,
  scoreBreakdown: { consequence: 2, novelty: 2, evidence: 2, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 30,
  heatBreakdown: { engagement: 20, sourceReach: 0, crossSource: 0, freshness: 10 },
  recommendationScore: 70,
  clusterSize: 1,
  relatedSources: ["Hacker News"],
  evidence: "社区讨论",
  engagement: { points: 120, comments: 40, discussionUrl: `https://news.ycombinator.com/item?id=${id}` },
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  ...overrides,
});

const run = (id: string, candidates: Candidate[]): WorkflowRun => ({
  id,
  createdAt: "2026-08-27T09:00:00.000Z",
  updatedAt: "2026-08-27T09:00:00.000Z",
  status: "ready",
  stage: "候选就绪",
  windowHours: 24,
  sourceIds: ["hackernews"],
  scheduled: false,
  rawCount: candidates.length,
  candidates,
  logs: [],
});

test("community detection includes discussion-led sources but excludes ordinary news", () => {
  assert.equal(isCommunityCandidate(candidate("1")), true);
  assert.equal(isCommunityCandidate(candidate("2", {
    sourceType: "rss",
    sourceName: "Official blog",
    sourceRole: "official",
    engagement: undefined,
  })), false);
});

test("community feed merges repeated snapshots instead of discarding newer signals or older assets", () => {
  const repeated = candidate("same", {
    briefing: undefined,
    fetchedAt: "2026-08-27T10:00:00.000Z",
    engagement: { points: 180, comments: 70, discussionUrl: "https://news.ycombinator.com/item?id=same" },
  });
  const translated = candidate("copy", {
    engagement: { points: 120, comments: 40, discussionUrl: "https://news.ycombinator.com/item?id=same" },
    briefing: {
      titleZh: "中文标题",
      summaryZh: "这是一条有来源约束的中文摘要。",
      basis: "excerpt",
      generatedAt: "2026-08-27T10:30:00.000Z",
      providerId: "test",
    },
    images: [{
      id: "chart",
      url: "https://example.com/chart.png",
      caption: "Benchmark chart",
      attribution: "example.com",
      sourceUrl: "https://example.com/same",
      selected: true,
      rights: "check-required",
    }],
    imageCount: 1,
  });
  const feed = composeCommunityFeed([run("new", [repeated]), run("old", [translated])], {
    now: "2026-08-27T12:00:00.000Z",
  });

  assert.equal(feed.items.length, 1);
  assert.equal(feed.items[0].runId, "new");
  assert.equal(feed.items[0].candidate.briefing?.titleZh, "中文标题");
  assert.equal(feed.items[0].candidate.engagement?.points, 180);
  assert.equal(feed.items[0].candidate.images.length, 1);
  assert.equal(feed.items[0].snapshotCount, 2);
  assert.equal(feed.items[0].trend?.pointsDelta, 60);
  assert.equal(feed.duplicateCount, 1);
});

test("community feed matches a discussion with collected news evidence", () => {
  const discussion = candidate("discussion", {
    title: "OpenAI launches a new API",
    url: "https://example.com/openai-api",
  });
  const official = candidate("official", {
    sourceType: "rss",
    sourceName: "OpenAI",
    sourceRole: "official",
    title: "OpenAI launches a new API",
    url: "https://example.com/openai-api",
    engagement: undefined,
  });
  const communityRun = run("community", [discussion]);
  const officialRun = { ...run("official", [official]), sourceIds: ["openai"] };
  const feed = composeCommunityFeed([communityRun, officialRun], {
    now: "2026-08-27T12:00:00.000Z",
  });

  assert.equal(feed.items.length, 1);
  assert.deepEqual(feed.items[0].supportingSources.map((source) => source.sourceName), ["OpenAI"]);
});

test("expired and disliked community items leave the square", () => {
  const stale = candidate("stale", { publishedAt: "2026-08-10T08:00:00.000Z" });
  const disliked = candidate("disliked", { userFeedback: "not_interested" });
  const protectedStale = candidate("saved", {
    publishedAt: "2026-08-10T08:00:00.000Z",
    userFeedback: "interested",
  });
  const feed = composeCommunityFeed([run("run", [stale, disliked, protectedStale])], {
    now: "2026-08-27T12:00:00.000Z",
    expiryHours: 7 * 24,
  });

  assert.deepEqual(feed.items.map((item) => item.candidate.id), ["saved"]);
  assert.equal(feed.expiredCount, 1);
});

test("public discussion and recency affect community ranking", () => {
  const quiet = candidate("quiet", { recommendationScore: 78, engagement: { points: 3, comments: 1 } });
  const active = candidate("active", { recommendationScore: 70, engagement: { points: 800, comments: 320 } });
  const feed = composeCommunityFeed([run("run", [quiet, active])], {
    now: "2026-08-27T12:00:00.000Z",
  });

  assert.equal(feed.featured?.candidate.id, "active");
  assert.match(feed.featured?.reason ?? "", /320 条公开讨论/u);
});
