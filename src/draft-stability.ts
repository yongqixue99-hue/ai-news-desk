import type { ArticleDraft } from "./types.js";

interface SwitchDraftSafelyOptions {
  targetDraftId: string;
  hasDirtyChanges: () => boolean;
  flush: () => Promise<void>;
  select: (draftId: string) => void;
}

/**
 * Keeps draft selection behind the durability boundary: callers never observe
 * a new selection until the current dirty draft has been persisted.
 */
export const switchDraftSafely = async ({
  targetDraftId,
  hasDirtyChanges,
  flush,
  select,
}: SwitchDraftSafelyOptions) => {
  if (hasDirtyChanges()) await flush();
  select(targetDraftId);
};

export interface DraftRecoveryStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

type DraftRecoveryContent = Pick<
  ArticleDraft,
  | "title"
  | "paragraphs"
  | "take"
  | "bodyHtml"
  | "layoutTheme"
  | "images"
  | "sources"
  | "factClaims"
  | "uncertainties"
  | "community"
  | "topics"
  | "status"
>;

interface DraftRecoverySnapshot {
  version: 1;
  draftId: string;
  capturedAt: string;
  content: DraftRecoveryContent;
}

const RECOVERY_KEY_PREFIX = "ai-news-desk:draft-recovery:v1:";

export const draftRecoveryKey = (draftId: string) => `${RECOVERY_KEY_PREFIX}${draftId}`;

export const editableDraftContent = (draft: ArticleDraft): DraftRecoveryContent => ({
  title: draft.title,
  paragraphs: draft.paragraphs,
  take: draft.take,
  bodyHtml: draft.bodyHtml,
  layoutTheme: draft.layoutTheme,
  images: draft.images,
  sources: draft.sources,
  factClaims: draft.factClaims,
  uncertainties: draft.uncertainties,
  community: draft.community,
  topics: draft.topics,
  status: draft.status,
});

export const persistDraftRecoverySnapshot = (
  storage: DraftRecoveryStorage,
  draft: ArticleDraft,
  capturedAt = new Date().toISOString(),
) => {
  const snapshot: DraftRecoverySnapshot = {
    version: 1,
    draftId: draft.id,
    capturedAt,
    content: editableDraftContent(draft),
  };
  try {
    storage.setItem(draftRecoveryKey(draft.id), JSON.stringify(snapshot));
    return true;
  } catch {
    return false;
  }
};

export const clearDraftRecoverySnapshot = (storage: DraftRecoveryStorage, draftId: string) => {
  try {
    storage.removeItem(draftRecoveryKey(draftId));
  } catch {
    // Recovery is best-effort and must never block a successful server save.
  }
};

export const restoreDraftFromRecovery = (
  storage: DraftRecoveryStorage,
  serverDraft: ArticleDraft,
): ArticleDraft | undefined => {
  let raw: string | null = null;
  try {
    raw = storage.getItem(draftRecoveryKey(serverDraft.id));
    if (!raw) return undefined;
    const snapshot = JSON.parse(raw) as Partial<DraftRecoverySnapshot>;
    if (
      snapshot.version !== 1
      || snapshot.draftId !== serverDraft.id
      || !snapshot.content
      || typeof snapshot.capturedAt !== "string"
      || Date.parse(snapshot.capturedAt) <= Date.parse(serverDraft.updatedAt)
    ) {
      clearDraftRecoverySnapshot(storage, serverDraft.id);
      return undefined;
    }
    return { ...serverDraft, ...snapshot.content, id: serverDraft.id, runId: serverDraft.runId };
  } catch {
    clearDraftRecoverySnapshot(storage, serverDraft.id);
    return undefined;
  }
};
