import { createHash, randomUUID } from "node:crypto";
import { appendDraftRevision, snapshotDraft } from "./draft-revisions.js";
import type { ArticleDraft, WorkflowState } from "./types.js";

export const draftContentHash = (draft: ArticleDraft) => createHash("sha256").update(JSON.stringify(snapshotDraft(draft))).digest("hex");

/** Confirmation records editorial intent, never publication or delivery eligibility. */
export const confirmDraftInState = (state: WorkflowState, draft: ArticleDraft, expectedUpdatedAt: string, now = new Date()) => {
  if (draft.updatedAt !== expectedUpdatedAt) throw new Error("正文版本已变化，请保存并重新确认");
  if (!draft.title.trim() || !(draft.bodyHtml?.replace(/<[^>]*>/gu, "").trim() || draft.paragraphs.join("").trim())) throw new Error("正文为空，不能确认定稿");
  const contentHash = draftContentHash(draft);
  if (draft.editorialBaseline?.confirmed?.contentHash === contentHash) return { draft, reused: true };
  if (!draft.editorialBaseline) appendDraftRevision(state, draft, "manual", now);
  const baseline = draft.editorialBaseline!;
  const before = structuredClone(baseline.confirmed?.snapshot ?? baseline.initial.snapshot);
  const learningEligible = !draft.aiAssistedSinceConfirmation && (Boolean(baseline.confirmed) || baseline.initial.origin === "initial");
  const revision = appendDraftRevision(state, draft, "confirmed", now);
  baseline.confirmed = {
    id: `confirmation_${randomUUID()}`, revisionId: revision.id, contentHash, confirmedAt: now.toISOString(),
    snapshot: snapshotDraft(draft), learningEligible,
    reason: learningEligible ? undefined : draft.aiAssistedSinceConfirmation ? "本次包含 AI 修改或版本恢复，仅保留差异，不自动学习表达偏好。" : "旧稿初始基线不完整，本次建立确认基线，不推断历史偏好。",
  };
  draft.aiAssistedSinceConfirmation = false;
  draft.updatedAt = now.toISOString();
  return { draft, reused: false, before, after: baseline.confirmed.snapshot, learningEligible };
};
