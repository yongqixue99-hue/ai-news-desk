import assert from "node:assert/strict";
import test from "node:test";
import type { ArticleDraft } from "./types.js";
import {
  draftRecoveryKey,
  persistDraftRecoverySnapshot,
  restoreDraftFromRecovery,
  switchDraftSafely,
  type DraftRecoveryStorage,
} from "./draft-stability.js";

const draft = (patch: Partial<ArticleDraft> = {}): ArticleDraft => ({
  id: "draft-1",
  runId: "run-1",
  candidateId: "candidate-1",
  createdAt: "2026-08-30T09:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
  status: "editing",
  title: "服务端标题",
  paragraphs: ["服务端正文"],
  take: "",
  bodyHtml: "<p>服务端正文</p>",
  sources: [],
  uncertainties: [],
  images: [],
  community: "",
  topics: [],
  provenance: { originalUrl: "https://example.com", generatedBy: "test" },
  ...patch,
});

const memoryStorage = (): DraftRecoveryStorage => {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
    removeItem: (key) => { values.delete(key); },
  };
};

test("dirty draft is flushed before switching to another draft", async () => {
  const events: string[] = [];

  await switchDraftSafely({
    targetDraftId: "draft-2",
    hasDirtyChanges: () => true,
    flush: async () => {
      events.push("saved");
    },
    select: (draftId) => {
      events.push(`selected:${draftId}`);
    },
  });

  assert.deepEqual(events, ["saved", "selected:draft-2"]);
});

test("failed flush keeps the current draft selected", async () => {
  let selectedDraftId = "draft-1";

  await assert.rejects(() => switchDraftSafely({
    targetDraftId: "draft-2",
    hasDirtyChanges: () => true,
    flush: async () => {
      throw new Error("offline");
    },
    select: (draftId) => {
      selectedDraftId = draftId;
    },
  }), /offline/u);

  assert.equal(selectedDraftId, "draft-1");
});

test("newer local recovery restores editable content without changing draft identity", () => {
  const storage = memoryStorage();
  const serverDraft = draft();
  persistDraftRecoverySnapshot(
    storage,
    draft({ title: "关闭前标题", bodyHtml: "<p>关闭前未保存正文</p>" }),
    "2026-08-30T10:01:00.000Z",
  );

  const recovered = restoreDraftFromRecovery(storage, serverDraft);

  assert.equal(recovered?.id, "draft-1");
  assert.equal(recovered?.runId, "run-1");
  assert.equal(recovered?.title, "关闭前标题");
  assert.equal(recovered?.bodyHtml, "<p>关闭前未保存正文</p>");
});

test("server-confirmed content discards an older local recovery snapshot", () => {
  const storage = memoryStorage();
  persistDraftRecoverySnapshot(
    storage,
    draft({ title: "旧的本地标题" }),
    "2026-08-30T09:59:00.000Z",
  );

  const recovered = restoreDraftFromRecovery(storage, draft());

  assert.equal(recovered, undefined);
  assert.equal(storage.getItem(draftRecoveryKey("draft-1")), null);
});
