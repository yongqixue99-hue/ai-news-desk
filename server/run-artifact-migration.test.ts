import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { LocalDatabase } from "./local-database.js";
import { createDefaultState } from "./defaults.js";
import type { WorkflowState } from "./types.js";

import { artifactFixture, seedSchema6 } from "./run-artifact-fixture.js";

const temporary = async (fn: (root: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-artifact-migration-"));
  try { await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};

test("schema 6 migration removes only heavy fields, preserves full state, and is idempotent", async () => temporary(async root => {
  const state = artifactFixture(); await seedSchema6(root, state);
  let store = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
  try {
    assert.deepEqual(store.readState(), state);
    const lean = store.readStateLean<WorkflowState>();
    for (const kind of ["discoveryTrace", "evidenceCandidates", "aggregationItems"] as const) {
      assert.equal(Object.hasOwn(lean.runs[0]!, kind), false);
      assert.deepEqual(store.getRunArtifact(state.runs[0]!.id, kind), state.runs[0]![kind]);
    }
    const reader = new DatabaseSync(store.databasePath, { readOnly: true });
    const rows = reader.prepare("SELECT * FROM run_artifacts ORDER BY kind").all(); reader.close();
    assert.equal(rows.length, 3);
    const checkpoints = (await readdir(path.join(root, "backups"))).filter(name => name.startsWith("before-run-artifacts-"));
    assert.equal(checkpoints.length, 1);
    store.close();
    for (let i = 0; i < 2; i++) {
      store = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
      assert.deepEqual(store.readState(), state);
      const db = new DatabaseSync(store.databasePath, { readOnly: true });
      assert.deepEqual(db.prepare("SELECT * FROM run_artifacts ORDER BY kind").all(), rows); db.close();
      assert.deepEqual((await readdir(path.join(root, "backups"))).filter(name => name.startsWith("before-run-artifacts-")), checkpoints);
      if (i === 0) store.close();
    }
  } finally { store.close(); }
}));

test("legacy whole-row SQLite state also receives a checkpoint before conversion", async () => temporary(async root => {
  const state = artifactFixture(); await seedSchema6(root, state, true);
  const store = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
  try {
    assert.deepEqual(store.readState(), state);
    assert.equal(Object.hasOwn(store.readStateLean<WorkflowState>().runs[0]!, "discoveryTrace"), false);
    assert.equal((await readdir(path.join(root, "backups"))).filter(name => name.startsWith("before-run-artifacts-")).length, 1);
  } finally { store.close(); }
}));

test("an interrupted migration rolls back schema and state and leaves its pre-move checkpoint usable", async () => temporary(async root => {
  const state = artifactFixture(); await seedSchema6(root, state);
  await assert.rejects(LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState,
    beforeArtifactMigrationCommit: () => { throw new Error("injected migration failure"); } }), /injected migration failure/);
  const db = new DatabaseSync(path.join(root, "newsdesk.db"), { readOnly: true });
  assert.equal((db.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string }).value, "6");
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'run_artifacts'").get(), undefined);
  assert.deepEqual(JSON.parse((db.prepare("SELECT value_json FROM state_fragments WHERE key = 'runs'").get() as { value_json: string }).value_json), state.runs); db.close();
  const checkpoint = (await readdir(path.join(root, "backups"))).find(name => name.startsWith("before-run-artifacts-"))!;
  const saved = new DatabaseSync(path.join(root, "backups", checkpoint), { readOnly: true });
  assert.equal((saved.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value: string }).value, "6"); saved.close();
  const recovered = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
  try { assert.deepEqual(recovered.readState(), state); } finally { recovered.close(); }
}));

test("lean mutations preserve absent artifacts, empty edits are explicit, and failed writes preserve the cache", async () => temporary(async root => {
  const store = await LocalDatabase.open({ workflowRoot: root, initialState: artifactFixture });
  try {
    const lean = store.readStateLean<WorkflowState>();
    const original = store.getRunArtifact("synthetic-run", "discoveryTrace")!;
    original[0]!.title = "external mutation";
    assert.equal(store.getRunArtifact("synthetic-run", "discoveryTrace")![0]!.title, "隔离示例");
    lean.runs[0]!.stage = "edited"; store.writeState(lean);
    assert.deepEqual(store.readState<WorkflowState>().runs[0]!.discoveryTrace, artifactFixture().runs[0]!.discoveryTrace);
    const db = new DatabaseSync(store.databasePath);
    db.exec("CREATE TRIGGER fail_fragment BEFORE UPDATE ON state_fragments BEGIN SELECT RAISE(ABORT, 'injected write failure'); END");
    lean.runs[0]!.discoveryTrace = [];
    lean.runs[0]!.stage = "must rollback";
    assert.throws(() => store.writeState(lean), /injected write failure/);
    assert.equal(store.getRunArtifact("synthetic-run", "discoveryTrace")!.length, 1);
    assert.equal(store.readState<WorkflowState>().runs[0]!.stage, "edited");
    db.exec("DROP TRIGGER fail_fragment"); db.close();
    store.writeState(lean);
    assert.deepEqual(store.getRunArtifact("synthetic-run", "discoveryTrace"), []);
    lean.runs[0]!.discoveryTrace = undefined; store.writeState(lean);
    assert.equal(store.getRunArtifact("synthetic-run", "discoveryTrace"), undefined);
    store.writeState({ ...lean, runs: [] });
    assert.deepEqual(store.getRunArtifact("synthetic-run", "aggregationItems"), [], "ordinary writes retain historical rows");
    store.writeState({ ...lean, runs: [] }, { replaceArtifacts: true });
    assert.equal(store.getRunArtifact("synthetic-run", "aggregationItems"), undefined);
  } finally { store.close(); }
}));
