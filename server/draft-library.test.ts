import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState, upgradeState } from "./defaults.js";
import { createBlankDraftInState, trashDraftsInState, restoreDraftFromTrashInState, restoreTrashedDraftsInState, draftTrashSummaries } from "./draft-library.js";
import { normalizeDraftCatalog } from "./draft-catalog.js";
import { LocalDatabase } from "./local-database.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createWorkflowBackup, verifyWorkflowBackup } from "./data-management.js";

test("blank drafts remain independent, human authored and recoverable after upgrading", () => {
  const state = createDefaultState();
  const first = createBlankDraftInState(state);
  const second = createBlankDraftInState(state);
  assert.notEqual(first.candidateId, second.candidateId);
  assert.equal(first.provenance.generatedBy, "human");
  assert.equal(first.provenance.contentPackageId, undefined);
  assert.equal(first.bodyHtml, "");
  assert.deepEqual(first.sources, []);
  assert.equal(state.draftRevisions.filter(r => r.draftId === first.id).length, 1);
  assert.deepEqual(normalizeDraftCatalog(state.drafts).map(d => d.status), ["editing", "editing"]);
  trashDraftsInState(state, [{ id: first.id, updatedAt: first.updatedAt }]);
  const backup = verifyWorkflowBackup(createWorkflowBackup(state));
  const reloaded = upgradeState(backup.state);
  assert.deepEqual(reloaded.draftTrash?.[0]?.draft, first);
  assert.deepEqual(reloaded.drafts.map(d => d.id), [second.id]);
});

test("delete and restore retain exact content, evidence and versions, and invalidate stale saves", () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state);
  draft.title = "已经修改的草稿";
  draft.bodyHtml = "<p>必须保留的正文</p>";
  draft.sources = [{ kind: "primary", label: "原文", url: "https://example.com/source", verified: true }];
  const original = structuredClone(draft);
  const revisions = structuredClone(state.draftRevisions);
  trashDraftsInState(state, [{ id: draft.id, updatedAt: draft.updatedAt }]);
  assert.equal(state.drafts.length, 0);
  assert.deepEqual(state.draftTrash?.[0]?.draft, original);
  assert.deepEqual(state.draftRevisions, revisions);
  const restored = restoreDraftFromTrashInState(state, draft.id);
  assert.deepEqual({ ...restored, updatedAt: original.updatedAt }, original);
  assert.ok(restored.updatedAt > original.updatedAt);
  assert.equal(state.draftTrash?.length, 0);
  assert.throws(() => restoreDraftFromTrashInState(state, draft.id), /回收站/);
  assert.equal(state.drafts.length, 1);
});

test("clear uses an explicit snapshot, rejects changed drafts atomically and leaves later drafts alone", () => {
  const state = createDefaultState();
  const first = createBlankDraftInState(state);
  const second = createBlankDraftInState(state);
  second.status = "shelved";
  const snapshot = state.drafts.map(({ id, updatedAt }) => ({ id, updatedAt }));
  const later = createBlankDraftInState(state);
  first.updatedAt = "2099-01-01T00:00:00.000Z";
  assert.throws(() => trashDraftsInState(state, snapshot), /变化/);
  assert.equal(state.drafts.length, 3);
  assert.equal(state.draftTrash?.length ?? 0, 0);
  snapshot.find(d => d.id === first.id)!.updatedAt = first.updatedAt;
  trashDraftsInState(state, snapshot);
  assert.deepEqual(state.drafts.map(d => d.id), [later.id]);
  assert.equal(state.draftTrash?.length, 2);
  assert.throws(() => trashDraftsInState(state, []), /选择/);
});


test("trash is persisted in SQLite and survives reopening the workspace", async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "draft-library-storage-"));
  try {
    const database = await LocalDatabase.open({ workflowRoot, initialState: createDefaultState });
    const state = createDefaultState();
    const draft = createBlankDraftInState(state);
    trashDraftsInState(state, [{ id: draft.id, updatedAt: draft.updatedAt }]);
    database.writeState(state);
    database.close();
    const reopened = await LocalDatabase.open({ workflowRoot, initialState: createDefaultState });
    const reloaded = reopened.readState<import("./types.js").WorkflowState>();
    reopened.close();
    assert.equal(reloaded.drafts.length, 0);
    assert.deepEqual(reloaded.draftTrash?.[0]?.draft, JSON.parse(JSON.stringify(draft)));
    assert.equal(restoreDraftFromTrashInState(reloaded, draft.id).id, draft.id);
  } finally { await rm(workflowRoot, { recursive: true, force: true }); }
});

test("bulk restore validates the displayed trash snapshot atomically and preserves later deletions", () => {
  const state = createDefaultState();
  const first = createBlankDraftInState(state), second = createBlankDraftInState(state);
  trashDraftsInState(state, state.drafts.map(({ id, updatedAt }) => ({ id, updatedAt })));
  const selection = draftTrashSummaries(state);
  const later = createBlankDraftInState(state);
  trashDraftsInState(state, [{ id: later.id, updatedAt: later.updatedAt }]);
  assert.throws(() => restoreTrashedDraftsInState(state, [selection[0], { ...selection[1], deletedAt: "stale" }]), /变化/);
  assert.equal(state.drafts.length, 0);
  const restored = restoreTrashedDraftsInState(state, selection);
  assert.deepEqual(new Set(restored.map(d => d.id)), new Set([first.id, second.id]));
  assert.deepEqual(state.draftTrash?.map(item => item.draft.id), [later.id]);
  assert.throws(() => restoreTrashedDraftsInState(state, selection), /变化/);
});
