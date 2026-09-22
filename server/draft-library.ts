import { randomUUID } from "node:crypto";
import { appendDraftRevision } from "./draft-revisions.js";
import type { ArticleDraft, WorkflowState } from "./types.js";

export interface DraftLibrarySelection { id: string; updatedAt: string; }
export interface TrashedDraftSummary extends DraftLibrarySelection { title: string; deletedAt: string; }

/** DraftDesk's manual entry point: no generated text or fabricated evidence package. */
export const createBlankDraftInState = (state: WorkflowState): ArticleDraft => {
  const id = `draft_manual_${randomUUID()}`;
  const now = new Date().toISOString();
  const draft: ArticleDraft = {
    id, runId: id, candidateId: id, createdAt: now, updatedAt: now,
    status: "editing", title: "", paragraphs: [], bodyHtml: "", take: "",
    contentFormat: "article", layoutTheme: "news-clean", sources: [], factClaims: [],
    uncertainties: [], images: [], community: state.settings.community, topics: [],
    provenance: { originalUrl: "", generatedBy: "human", authoringMode: "human-first" },
  };
  state.drafts.unshift(draft);
  appendDraftRevision(state, draft, "initial", new Date(now));
  return draft;
};

/** Validate the whole displayed selection before mutating anything. New arrivals are not included. */
export const trashDraftsInState = (state: WorkflowState, selection: DraftLibrarySelection[]) => {
  if (!Array.isArray(selection) || !selection.length
    || selection.some(item => !item || typeof item.id !== "string" || typeof item.updatedAt !== "string")
    || new Set(selection.map(item => item.id)).size !== selection.length) {
    throw new Error("请选择有效的草稿后重试");
  }
  const byId = new Map(state.drafts.map(draft => [draft.id, draft]));
  const targets = selection.map(item => {
    const draft = byId.get(item.id);
    if (!draft || draft.updatedAt !== item.updatedAt) throw new Error("草稿列表已发生变化，请刷新后重新选择；本次没有删除任何草稿");
    return draft;
  });
  const ids = new Set(targets.map(draft => draft.id));
  const deletedAt = new Date().toISOString();
  state.draftTrash = [...targets.map(draft => ({ draft, deletedAt })), ...(state.draftTrash ?? [])];
  state.drafts = state.drafts.filter(draft => !ids.has(draft.id));
  return { draftIds: [...ids] };
};

export const restoreDraftFromTrashInState = (state: WorkflowState, draftId: string): ArticleDraft => {
  const entry = state.draftTrash?.find(item => item.draft.id === draftId);
  if (!entry) throw new Error("回收站中没有这篇草稿，可能已在其他窗口恢复");
  if (state.drafts.some(draft => draft.id === draftId)) throw new Error("草稿已经存在，请刷新列表");
  // A window opened before deletion must not overwrite a restored draft with a stale save.
  const draft = { ...entry.draft, updatedAt: new Date(Math.max(Date.now(), Date.parse(entry.draft.updatedAt) + 1)).toISOString() };
  state.drafts.unshift(draft);
  state.draftTrash = state.draftTrash!.filter(item => item !== entry);
  return draft;
};

export const draftTrashSummaries = (state: WorkflowState): TrashedDraftSummary[] =>
  (state.draftTrash ?? []).map(({ draft, deletedAt }) => ({
    id: draft.id, title: draft.title, updatedAt: draft.updatedAt, deletedAt,
  }));
