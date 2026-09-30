import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { composeCommunityFeed } from "./community-feed.js";
import { buildCommunityView } from "./community-view.js";
import type { Candidate } from "./types.js";

const now = "2026-09-30T01:00:00.000Z";
const candidate: Candidate = {
  id: "community", rawId: "raw", sourceType: "hackernews", sourceName: "Hacker News", sourceRole: "community",
  title: "Open tool for observing agent file edits", url: "https://example.test/agent-edits", excerpt: "A community discovery example, not factual evidence.",
  fetchedAt: now, publishedAt: now, score: 10,
  scoreBreakdown: { consequence: 2, novelty: 2, evidence: 2, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 30, heatBreakdown: { engagement: 20, sourceReach: 0, crossSource: 0, freshness: 10 }, recommendationScore: 70,
  clusterSize: 1, relatedSources: ["Hacker News"], evidence: "社区线索", imageCount: 0, images: [], selected: false, status: "candidate",
};
test("the lightweight community view preserves feed results without leaking the workspace archive", () => {
  const state = createDefaultState();
  state.runs = [{ id: "community-run", createdAt: now, updatedAt: now, status: "ready", stage: "候选就绪", windowHours: 24, sourceIds: [], scheduled: false, rawCount: 1, candidates: [candidate], logs: [] }];
  const before = structuredClone(state);
  const expected = composeCommunityFeed(state.runs, { now, limit: 120, expiryHours: 7 * 24, personalizationEnabled: state.settings.personalizationEnabled });
  const view = buildCommunityView(state, now);
  assert.equal(view.feed.items.length, 1);
  assert.deepEqual(view.feed.items, expected.items);
  assert.equal(view.feed.expiredCount, expected.expiredCount);
  assert.deepEqual(Object.keys(view).sort(), ["feed", "settings", "sources"]);
  assert.deepEqual(Object.keys(view.settings), ["personalizationEnabled"]);
  assert.ok(view.sources.every(source => source.role === "community"));
  assert.deepEqual(state, before);
});
