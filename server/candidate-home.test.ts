import assert from "node:assert/strict";
import test from "node:test";
import { composeCandidateHome } from "./candidate-home.js";
import type { Candidate } from "./types.js";

const candidate = (
  id: string,
  publishedAt: string,
  overrides: Partial<Candidate> = {},
): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName: "Official source",
  title: `Story ${id}`,
  url: `https://example.com/${id}`,
  excerpt: "Source-backed excerpt",
  publishedAt,
  fetchedAt: publishedAt,
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Official source"],
  evidence: "一手来源",
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  ...overrides,
});

test("candidate home archives stale stories but keeps stale stories already in the editorial workflow", () => {
  const now = "2026-08-27T12:00:00.000Z";
  const recent = candidate("recent", "2026-08-27T08:00:00.000Z");
  const stale = candidate("stale", "2026-08-24T08:00:00.000Z");
  const selectedStale = candidate("selected-stale", "2026-08-23T08:00:00.000Z", { selected: true });

  const home = composeCandidateHome([recent, stale, selectedStale], { now, expiryHours: 48 });

  assert.deepEqual(home.active.map((item) => item.id), ["recent", "selected-stale"]);
  assert.deepEqual(home.expired.map((item) => item.id), ["stale"]);
});

test("a protected stale story stays below today's featured and secondary recommendations", () => {
  const now = "2026-08-27T12:00:00.000Z";
  const selectedStale = candidate("selected-stale", "2026-08-23T08:00:00.000Z", { selected: true });
  const first = candidate("first", "2026-08-27T10:00:00.000Z");
  const second = candidate("second", "2026-08-27T09:00:00.000Z");

  const home = composeCandidateHome([selectedStale, first, second], {
    now,
    expiryHours: 48,
    secondaryCount: 1,
  });

  assert.equal(home.featured?.id, "first");
  assert.deepEqual(home.recommended.map((item) => item.id), ["second"]);
  assert.deepEqual(home.others.map((item) => item.id), ["selected-stale"]);
});
