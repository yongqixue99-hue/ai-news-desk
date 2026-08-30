import type { ArticleDraft } from "./types.js";

export type DraftLifecycleStatus = ArticleDraft["status"];

export const DRAFT_LIFECYCLE_TRANSITIONS: Record<DraftLifecycleStatus, DraftLifecycleStatus[]> = {
  editing: ["reviewing", "needs-images", "ready", "shelved"],
  reviewing: ["editing", "needs-images", "ready", "shelved"],
  "needs-images": ["editing", "reviewing", "ready", "shelved"],
  ready: ["editing", "reviewing", "needs-images", "filled", "shelved"],
  filled: ["editing", "ready", "published", "shelved"],
  published: ["editing", "shelved"],
  shelved: ["editing", "reviewing"],
};

export const canTransitionDraft = (from: DraftLifecycleStatus, to: DraftLifecycleStatus) =>
  from === to || DRAFT_LIFECYCLE_TRANSITIONS[from]?.includes(to) === true;

export const assertDraftTransition = (draft: ArticleDraft, next: DraftLifecycleStatus) => {
  if (draft.status === next) return;
  if (!canTransitionDraft(draft.status, next)) {
    throw new Error(`草稿不能从“${draft.status}”直接切换为“${next}”`);
  }
  if (next === "filled" && draft.publisherReceipt?.outcome !== "filled") throw new Error("只有成功的平台填入回执才能把草稿标记为已填入");
  if (next === "published" && !draft.publicationConfirmedAt) throw new Error("请先确认已经在平台完成发布");
};
