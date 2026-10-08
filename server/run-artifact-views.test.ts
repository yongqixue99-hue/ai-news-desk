import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalDatabase } from "./local-database.js";
import { artifactFixture, seedSchema6 } from "./run-artifact-fixture.js";
import { collectDiscoveryCandidates } from "./discovery-funnel.js";
import { aggregationSnapshot, buildAggregationView, retainAggregationEntry } from "./aggregation-desk.js";
import { buildStories, buildTodayView } from "./story-desk.js";
import { buildCommunityView } from "./community-view.js";
import { traceDiscoveryUrl, captureRecommendationSnapshot } from "./discovery-trace.js";
import { buildWorkflowPerformance } from "./workflow-performance.js";
import { runDiagnosticsView } from "./bootstrap-view.js";
import { candidateFromRun, candidatePool } from "./candidate-pool.js";
import { createVisualHydrationStorage } from "./visual-desk.js";
import { materializeRunArtifactForMutation } from "./run-artifacts.js";
import type { WorkflowState, RawHorizonItem } from "./types.js";
const at = "2026-10-07T12:00:00.000Z";
const url = "https://example.com/synthetic-model";

test("lean projections preserve complete stories, supporting evidence, aggregation, traces and diagnostics", async () => {
  let state = artifactFixture();
  const raw: RawHorizonItem = { id: "synthetic-official", source_type: "rss", title: "Aster releases a new AI model",
    url, content: "The AI model API is now available.", published_at: at, fetched_at: at,
    metadata: { feed_name: "Official", source_role: "official" } };
  const official = collectDiscoveryCandidates([raw], { now: Date.parse(at), windowHours: 48, topicIds: ["ai"] }).candidates[0]!;
  assert.ok(official);
  const community = { ...structuredClone(official), id: "synthetic-community", sourceRole: "community" as const,
    sourceName: "Hacker News", engagement: { points: 50, comments: 20, discussionUrl: "https://news.ycombinator.com/item?id=123456" } };
  state.runs[0]!.candidates = [community]; state.runs[0]!.evidenceCandidates = [official];
  state.runs[0]!.discoveryTrace = [{ ...state.runs[0]!.discoveryTrace![0]!, url, rawId: official.rawId, candidateId: community.id }];
  state.runs[0]!.aggregationItems = aggregationSnapshot([{ ...raw, metadata: { source_id: "aihot-news" } }]);
  state.runs[0]!.sourceResults = [{ sourceId: "aihot-news", sourceName: "隔离聚合", status: "healthy", healthImpact: "success", rawCount: 1, candidateCount: 0, detail: "示例" }];
  state = JSON.parse(JSON.stringify(state)) as WorkflowState; // The old SQLite representation also persisted JSON, without undefined properties.
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-artifact-views-"));
  await seedSchema6(root, state);
  const store = await LocalDatabase.open({ workflowRoot: root, initialState: artifactFixture });
  try {
    const lean = store.readStateLean<WorkflowState>(); const read = store.getRunArtifact.bind(store);
    const original = JSON.stringify(lean);
    const fullStory = buildStories(state, at)[0]!;
    const visual = createVisualHydrationStorage(fullStory.id, {
      project: async select => structuredClone(select(lean, read)), update: async mutate => await mutate(structuredClone(lean)),
    });
    assert.deepEqual((await visual.getStory())!.signals.map(signal => signal.candidateId), fullStory.signals.map(signal => signal.candidateId));
    assert.equal(buildAggregationView(state, Date.parse(at)).entries.length, 1);
    assert.ok(buildStories(state, at).some(story => story.signals.some(signal => signal.candidateId === official.id)));
    assert.ok(buildCommunityView(state, at).feed.items.some(item => item.supportingSources.length > 0));
    assert.deepEqual(buildAggregationView(lean, Date.parse(at), read), buildAggregationView(state, Date.parse(at)));
    assert.deepEqual(buildStories(lean, at, read), buildStories(state, at));
    assert.deepEqual(buildTodayView(lean, at, read), buildTodayView(state, at));
    assert.deepEqual(buildCommunityView(lean, at, read), buildCommunityView(state, at));
    assert.deepEqual(traceDiscoveryUrl(lean, url, at, read), traceDiscoveryUrl(state, url, at));
    assert.deepEqual(buildWorkflowPerformance(lean, { now: at, readArtifact: read }), buildWorkflowPerformance(state, { now: at }));
    assert.deepEqual(runDiagnosticsView(lean, lean.runs[0]!.id, read), runDiagnosticsView(state, state.runs[0]!.id));
    assert.deepEqual(captureRecommendationSnapshot(lean, at, read), captureRecommendationSnapshot(state, at));
    assert.deepEqual(candidateFromRun(lean.runs[0], official.id, read), state.runs[0]!.evidenceCandidates![0]);
    assert.deepEqual(candidatePool(lean.runs[0]!, new Set([official.id]), read), state.runs[0]!.evidenceCandidates);
    assert.equal(JSON.stringify(lean), original, "pure projections never reattach artifacts to the cache");
    const target = structuredClone(lean);
    materializeRunArtifactForMutation(target.runs[0]!, "evidenceCandidates", read);
    target.runs[0]!.evidenceCandidates![0]!.briefing = { titleZh: "隔离讲解", summaryZh: "固定示例摘要", basis: "excerpt", providerId: "fake", generatedAt: at };
    store.writeState(target);
    assert.equal(store.getRunArtifact(target.runs[0]!.id, "evidenceCandidates")![0]!.briefing?.titleZh, "隔离讲解");
    const fullTarget = structuredClone(state); const thinTarget = store.readStateLean<WorkflowState>();
    const entry = buildAggregationView(state, Date.parse(at)).entries[0]!;
    assert.deepEqual(retainAggregationEntry(thinTarget, entry.id, read), retainAggregationEntry(fullTarget, entry.id));
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});

test("each projection reads a run artifact once even with many hidden candidates or community entries", () => {
  const state = artifactFixture();
  const raw: RawHorizonItem = { id: "raw", source_type: "rss", title: "Aster releases a new AI model", url,
    content: "The AI model API is now available.", published_at: at, fetched_at: at, metadata: { feed_name: "Official", source_role: "official" } };
  const candidate = collectDiscoveryCandidates([raw], { now: Date.parse(at), windowHours: 48, topicIds: ["ai"] }).candidates[0]!;
  state.runs[0]!.candidates = [candidate];
  delete state.runs[0]!.discoveryTrace; delete state.runs[0]!.evidenceCandidates; delete state.runs[0]!.aggregationItems;
  const counts = new Map<string, number>();
  const reader: import("./run-artifacts.js").RunArtifactReader = (_id, kind) => {
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return structuredClone(kind === "evidenceCandidates" ? Array.from({ length: 200 }, (_, i) => ({ ...candidate, id: `hidden-${i}`, rawId: `raw-${i}` }))
      : kind === "discoveryTrace" ? [{ rawId: "raw-0", url, title: candidate.title, candidateId: candidate.id, stage: "merged-event" }] : []) as never;
  };
  buildStories(state, at, reader);
  assert.equal(counts.get("evidenceCandidates"), 1);
  assert.equal(counts.get("discoveryTrace"), 1);
  counts.clear();
  state.runs[0]!.candidates = [1, 2].map(i => ({ ...candidate, id: `community-${i}`, sourceRole: "community", sourceName: "Hacker News",
    engagement: { points: 30, discussionUrl: `https://news.ycombinator.com/item?id=${i}` } }));
  const view = buildCommunityView(state, at, reader);
  assert.equal(view.feed.items.length, 2);
  assert.equal(counts.get("evidenceCandidates"), 1);
});
