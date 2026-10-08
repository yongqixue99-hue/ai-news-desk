import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { artifactFixture, seedSchema6 } from "./run-artifact-fixture.js";
import { LocalDatabase } from "./local-database.js";
import { createWorkflowBackup, createPortableWorkflowArchive, verifyWorkflowBackup } from "./data-management.js";
import { inspectPortableArchive } from "./portable-archive-inspector.js";
import { importPortableArchive } from "./portable-archive-importer.js";
import type { WorkflowState } from "./types.js";

const fixture = () => { const state = artifactFixture(); state.runs[0]!.logs = [{ at: "2026-10-07T12:00:00.000Z", level: "info", stage: "fixture", message: "隔离压缩往返".repeat(10_000) }]; return state; };

test("light backup and full portable export/import hydrate every artifact even from a lean input", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-artifact-backup-"));
  const state = fixture(), sourceRoot = path.join(root, "source"), targetRoot = path.join(root, "target");
  const source = await LocalDatabase.open({ workflowRoot: sourceRoot, initialState: () => state });
  const target = await LocalDatabase.open({ workflowRoot: targetRoot, initialState: artifactFixture });
  try {
    const lean = source.readStateLean<WorkflowState>(), read = source.getRunArtifact.bind(source);
    const backup = createWorkflowBackup(lean, "2026-10-07T12:00:00.000Z", read);
    assert.deepEqual(verifyWorkflowBackup(backup).state, state);
    assert.equal(Object.hasOwn(lean.runs[0]!, "discoveryTrace"), false);
    const archive = await createPortableWorkflowArchive({ workflowRoot: sourceRoot, database: source, state: lean });
    assert.equal((await inspectPortableArchive(archive.archivePath)).valid, true);
    const result = await importPortableArchive({ archivePath: archive.archivePath, workflowRoot: targetRoot, database: target });
    assert.equal(result.imported, true);
    assert.deepEqual(target.readState<WorkflowState>().runs, state.runs);
    assert.deepEqual(target.getRunArtifact("synthetic-run", "discoveryTrace"), state.runs[0]!.discoveryTrace);
    assert.equal((await importPortableArchive({ archivePath: archive.archivePath, workflowRoot: targetRoot, database: target })).reused, true);
  } finally { source.close(); target.close(); await rm(root, { recursive: true, force: true }); }
});

test("snapshot restore handles old embedded data and new artifacts and validates before committing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-artifact-restore-"));
  const state = fixture(); await seedSchema6(path.join(root, "old"), state);
  const oldSnapshot = path.join(root, "old", "newsdesk.db");
  const current = await LocalDatabase.open({ workflowRoot: path.join(root, "current"), initialState: artifactFixture });
  try {
    current.getRunArtifact("synthetic-run", "discoveryTrace");
    current.replaceFromSnapshot(oldSnapshot);
    assert.deepEqual(current.readState(), state);
    const snapshot = path.join(root, "new.db"); current.createSnapshot(snapshot);
    const altered = structuredClone(state); altered.runs[0]!.discoveryTrace = [];
    current.writeState(altered); assert.deepEqual(current.getRunArtifact("synthetic-run", "discoveryTrace"), []);
    current.replaceFromSnapshot(snapshot); assert.deepEqual(current.readState(), state);
    const corrupt = new DatabaseSync(snapshot);
    corrupt.exec("UPDATE run_artifacts SET json = '[]' WHERE kind = 'discoveryTrace'"); corrupt.close();
    assert.throws(() => current.replaceFromSnapshot(snapshot), /运行明细校验失败/);
    assert.deepEqual(current.readState(), state);
    assert.deepEqual(current.getRunArtifact("synthetic-run", "discoveryTrace"), state.runs[0]!.discoveryTrace);
  } finally { current.close(); await rm(root, { recursive: true, force: true }); }
});

test("a migration checkpoint restores durable job lanes together with all other job fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-artifact-job-checkpoint-"));
  const store = await LocalDatabase.open({ workflowRoot: root, initialState: artifactFixture });
  try {
    const job = store.enqueueJob({ lane: "background", type: "synthetic-work", idempotencyKey: "synthetic-checkpoint-job", payload: { synthetic: true } }).job;
    const original = store.getJob(job.id)!;
    const checkpoint = path.join(root, "checkpoint.db"); store.createSnapshot(checkpoint);
    store.enqueueJob({ lane: "foreground", type: job.type, idempotencyKey: job.idempotencyKey, payload: {} });
    assert.equal(store.getJob(job.id)!.lane, "foreground");
    store.replaceFromSnapshot(checkpoint);
    assert.deepEqual(store.getJob(job.id), original);
  } finally { store.close(); await rm(root, { recursive: true, force: true }); }
});
