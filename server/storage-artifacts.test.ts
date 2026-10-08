import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { artifactFixture, seedSchema6 } from "./run-artifact-fixture.js";
import { materializeRunArtifactForMutation } from "./run-artifacts.js";
import { runDiagnosticsView } from "./bootstrap-view.js";
import { createWorkflowBackup } from "./data-management.js";

test("storage mutations clone the lean cache while full reads and backups retain editable diagnostics", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-storage-artifacts-"));
  await seedSchema6(root); process.env.AI_NEWS_DESK_WORKFLOW_ROOT = root;
  const { readState, readStateProjection, updateState, getStateRevision, getLocalDatabase, readRunArtifact } = await import("./storage.js");
  try {
    const initial = await readState(), start = getStateRevision();
    assert.deepEqual(initial.runs, artifactFixture().runs);
    assert.equal(await readStateProjection(state => Object.hasOwn(state.runs[0]!, "discoveryTrace")), false);
    await updateState(state => {
      assert.equal(Object.hasOwn(state.runs[0]!, "discoveryTrace"), false);
      materializeRunArtifactForMutation(state.runs[0]!, "discoveryTrace", readRunArtifact)![0]!.title = "编辑后的明细";
    });
    assert.equal(getStateRevision(), start + 1);
    assert.equal((await readStateProjection((state, read) => runDiagnosticsView(state, state.runs[0]!.id, read)))!.discoveryTrace[0]!.title, "编辑后的明细");
    assert.equal(await readStateProjection(state => Object.hasOwn(state.runs[0]!, "discoveryTrace")), false);
    await assert.rejects(updateState(state => { materializeRunArtifactForMutation(state.runs[0]!, "discoveryTrace", readRunArtifact)![0]!.title = "不能保存"; throw new Error("injected mutation failure"); }), /injected mutation failure/);
    assert.equal(getStateRevision(), start + 1);
    assert.equal(createWorkflowBackup(await readState()).state.runs[0]!.discoveryTrace![0]!.title, "编辑后的明细");
    await updateState(state => { state.runs[0]!.stage = "ordinary edit"; });
    assert.equal(readRunArtifact(initial.runs[0]!.id, "discoveryTrace")![0]!.title, "编辑后的明细");
  } finally { (await getLocalDatabase()).close(); await rm(root, { recursive: true, force: true }); }
});
