import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { buildTodayView } from "./story-desk.js";
import { createTodayViewCache } from "./today-view-cache.js";

test("Today reuses computation within a revision/minute and isolates returned views", () => {
  const state = createDefaultState(); let calls = 0;
  const now = Date.parse("2026-10-07T10:00:01Z");
  const cached = createTodayViewCache({ now: () => now, build: (s, time) => { calls++; return buildTodayView(s, time); } });
  const first = cached(state, 1), expected = structuredClone(first);
  first.funnel.candidateCount = 999;
  first.mustReads.push({ title: "external mutation" } as never);
  assert.deepEqual(cached(state, 1), expected);
  assert.equal(calls, 1);
});

test("a new state revision or minute rebuilds Today, including time-sensitive fields", () => {
  const state = createDefaultState(); let calls = 0, now = Date.parse("2026-10-07T10:00:59Z");
  const cached = createTodayViewCache({ now: () => now, build: (s, time) => { calls++; return buildTodayView(s, time); } });
  const first = cached(state, 1);
  state.candidateFeedback.push({ id: "f", kind: "interested", candidateId: "c", runId: "r", title: "example", sourceName: "example", keywords: [], topicIds: ["ai"], createdAt: new Date(now).toISOString() });
  assert.equal(cached(state, 2).funnel.feedbackCount, 1); assert.equal(calls, 2);
  now += 1_000;
  const nextMinute = cached(state, 2);
  assert.equal(calls, 3); assert.notEqual(nextMinute.generatedAt, first.generatedAt);
  assert.deepEqual(nextMinute, buildTodayView(state, new Date(now).toISOString()));
});
