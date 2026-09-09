import assert from "node:assert/strict";
import test from "node:test";
import type { ArticleDraft } from "./types.js";
import {
  draftRecoveryKey,
  editableDraftContent,
  mergeSavedDraftMetadata,
  persistDraftRecoverySnapshot,
  restoreDraftFromRecovery,
  switchDraftSafely,
  type DraftRecoveryStorage,
} from "./draft-stability.js";
import { buildDraftQualityView } from "./draft-quality-view.js";

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

test("a completed save refreshes coverage and evidence while retaining the current editable document", () => {
  const current = draft({
    bodyHtml: '<p data-editor-selection="kept">补写后的正文</p>', paragraphs: ["补写后的正文"],
    qualityWarnings: [{ id: "brief-underdeveloped", message: "还有事实可补写", blockId: "evidence", dimension: "content-completeness",
      factCoverage: { usedFactIds: ["fact-1"], unusedFactIds: ["fact-2"], supportedFactCount: 2, ratio: 0.5 } }],
    factClaims: [{ id: "paragraph-1", claim: "补写后的正文", status: "unverified", capturedAt: "2026-09-08T00:00:00Z" }],
  });
  const saved = draft({
    title: "服务端格式化标题不得替换编辑器", bodyHtml: "<p>服务端格式化正文不得替换编辑器</p>", paragraphs: ["服务端派生正文"],
    qualityWarnings: [{ id: "style-only", message: "修饰过长", blockId: "paragraph:0", dimension: "writing-quality" }],
    factClaims: [{ id: "paragraph-1", claim: "补写后的正文", status: "full-source", capturedAt: "2026-09-08T00:00:01Z", factIds: ["fact-1", "fact-2"] }],
    writingBrief: { suggestedAngles: ["当前冻结证据"], communityFocus: [] }, updatedAt: "2026-09-08T00:00:02Z",
  });
  const merged = mergeSavedDraftMetadata(current, saved, JSON.stringify(editableDraftContent(current)))!;
  const quality = buildDraftQualityView(merged.qualityWarnings);
  assert.equal(quality.actionKind, "navigate");
  assert.equal(quality.warnings.length, 1);
  assert.doesNotMatch(quality.detail, /补写/u);
  assert.deepEqual(merged.factClaims, saved.factClaims);
  assert.deepEqual(merged.writingBrief, saved.writingBrief);
  assert.equal(merged.bodyHtml, current.bodyHtml);
  assert.equal(merged.paragraphs, current.paragraphs);
  assert.equal(merged.title, current.title);
  assert.equal(merged.images, current.images);
  assert.equal(merged.updatedAt, saved.updatedAt);
});

test("an older save response cannot replace metadata for text, evidence or rights edited while saving", () => {
  const submitted = draft({ qualityWarnings: [{ id: "old", message: "原始提示", blockId: "evidence", dimension: "fact-safety" }] });
  const snapshot = JSON.stringify(editableDraftContent(submitted));
  const saved = draft({ qualityWarnings: [], factClaims: [], updatedAt: "2026-09-08T00:00:02Z" });
  const newerStates = [
    draft({ ...submitted, bodyHtml: "<p>保存期间的新正文</p>" }),
    draft({ ...submitted, title: "保存期间的新标题" }),
    draft({ ...submitted, factClaims: [{ id: "new", claim: "新增核验", status: "unverified", capturedAt: "2026-09-08T00:00:01Z" }] }),
    draft({ ...submitted, uncertainties: ["刚加入的权利限制"] }),
    draft({ ...submitted, id: "another-draft" }),
  ];
  for (const newer of newerStates) assert.equal(mergeSavedDraftMetadata(newer, saved, snapshot), newer);
  assert.equal(mergeSavedDraftMetadata(undefined, saved, snapshot), undefined);
});

test("a save that clears the final warning removes the old warning instead of retaining it", () => {
  const current = draft({ qualityWarnings: [{ id: "old", message: "旧提示", blockId: "evidence", dimension: "content-completeness" }] });
  const merged = mergeSavedDraftMetadata(current, draft({ qualityWarnings: [] }), JSON.stringify(editableDraftContent(current)))!;
  assert.equal(buildDraftQualityView(merged.qualityWarnings).warnings.length, 0);
});
