import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultState } from "./defaults.js";
import { rawItemToCandidate } from "./scoring.js";
import { bootstrapView, runDiagnosticsView } from "./bootstrap-view.js";
import type { RawHorizonItem } from "./types.js";

const fixture = () => {
  const state = createDefaultState();
  const at = "2026-10-07T08:00:00Z";
  const raw: RawHorizonItem = { id: "raw", source_type: "rss", title: "Fixture model released",
    url: "https://example.com/release", published_at: at, fetched_at: at, content: "Fixture evidence", metadata: {} };
  const candidate = rawItemToCandidate(raw, 48, ["ai"]);
  candidate.score = 13;
  candidate.scoreBreakdown = { consequence: 3, novelty: 3, evidence: 3, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 };
  candidate.recommendationScore = 87;
  state.runs = [{ id: "fixture", createdAt: at, updatedAt: at, status: "ready", stage: "完成",
    windowHours: 48, sourceIds: [], scheduled: false, rawCount: 1, candidates: [candidate], logs: [],
    discoveryTrace: [{ rawId: raw.id, title: raw.title, url: raw.url, stage: "candidate" }],
    evidenceCandidates: [candidate], aggregationItems: [raw] }];
  return state;
};

test("bootstrap omits only heavy run artifacts and existing lazy history while preserving other fields", () => {
  const state = fixture(), before = structuredClone(state);
  const view = bootstrapView(state);
  for (const name of ["discoveryTrace", "evidenceCandidates", "aggregationItems"]) assert.equal(Object.hasOwn(view.runs[0], name), false);
  const { discoveryTrace, evidenceCandidates, aggregationItems, ...rest } = state.runs[0];
  assert.deepEqual(view.runs[0], rest);
  const expected = { ...state, runs: [rest], draftRevisions: [], draftTrash: [], articleAgentThreads: [] };
  assert.deepEqual(view, expected);
  assert.deepEqual(state, before);
  assert.deepEqual(runDiagnosticsView(state, "fixture"), { runId: "fixture", discoveryTrace, evidenceCandidates, aggregationItems });
  assert.equal(runDiagnosticsView(state, "missing"), undefined);
});

test("bootstrap projection and on-demand diagnostics never rewrite or expose mutable storage", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-bootstrap-view-"));
  process.env.AI_NEWS_DESK_WORKFLOW_ROOT = root;
  const { replaceState, readStateProjection, readState, getLocalDatabase } = await import("./storage.js");
  try {
    await replaceState(fixture());
    const database = await getLocalDatabase();
    const before = database.readState();
    const cachedBefore = await readState();
    const view = await readStateProjection(bootstrapView);
    view.runs[0].candidates[0].title = "outside mutation";
    view.settings.community = "outside mutation";
    const diagnostics = await readStateProjection(state => runDiagnosticsView(state, "fixture"));
    diagnostics!.discoveryTrace[0].title = "outside mutation";
    assert.deepEqual(await readState(), cachedBefore);
    assert.deepEqual(database.readState(), before);
  } finally { (await getLocalDatabase()).close(); await rm(root, { recursive: true, force: true }); }
});
