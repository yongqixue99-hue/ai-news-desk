import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "../../server/defaults.js";
import { createBlankDraftInState } from "../../server/draft-library.js";
import { filterDraftLibrary, readLastDraft, rememberLastDraft, resolveDraftId } from "../draft-library-view.js";

test("library searches actual body text, respects history/status filters and never mutates input", () => {
  const state = createDefaultState();
  const a = createBlankDraftInState(state), b = createBlankDraftInState(state);
  a.title = "甲"; a.updatedAt = "2026-01-01T00:00:00Z";
  b.title = "乙"; b.updatedAt = "2026-02-01T00:00:00Z"; b.status = "shelved";
  const entries = [{ draft: a, bodyText: "正文包含 GPU 芯片" }, { draft: b, bodyText: "GPU 芯片旧稿" }];
  const options = { query: "ｇｐｕ 芯片", status: "all" as const, sort: "updated" as const, includeShelved: false };
  assert.deepEqual(filterDraftLibrary(entries, options).map(d => d.id), [a.id]);
  assert.deepEqual(filterDraftLibrary(entries, { ...options, includeShelved: true }).map(d => d.id), [b.id, a.id]);
  assert.deepEqual(filterDraftLibrary(entries, { ...options, status: "ready" }), []);
  assert.equal(entries[0].draft.id, a.id);
});

test("last draft restores a historical draft, falls back after deletion and tolerates restricted storage", () => {
  const state = createDefaultState();
  const old = createBlankDraftInState(state), current = createBlankDraftInState(state);
  old.status = "shelved";
  assert.equal(resolveDraftId(state.drafts, old.id), old.id);
  assert.equal(resolveDraftId(state.drafts, "deleted"), current.id);
  assert.equal(resolveDraftId([], old.id), undefined);
  const blocked = () => { throw new Error("Storage disabled"); };
  assert.equal(readLastDraft(blocked), undefined);
  assert.doesNotThrow(() => rememberLastDraft(blocked, current.id));
  const values = new Map<string, string>();
  const storage = () => ({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
  rememberLastDraft(storage, current.id);
  assert.equal(readLastDraft(storage), current.id);
  rememberLastDraft(storage);
  assert.equal(readLastDraft(storage), undefined);
});
