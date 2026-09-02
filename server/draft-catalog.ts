import type { ArticleDraft } from "./types.js";

const generatorRevisionNumber = (draft: ArticleDraft) => {
  const match = /^source-first-v(\d+)$/u.exec(draft.provenance.generatorRevision ?? "");
  return match ? Number(match[1]) : undefined;
};

const hasDeliveryHistory = (draft: ArticleDraft) => Boolean(
  draft.status === "filled"
  || draft.status === "published"
  || draft.publisherReceipt
  || draft.wechatDraft
  || draft.publicationConfirmations?.xiaoheihe
  || draft.publicationConfirmations?.wechat,
);

const newest = (drafts: ArticleDraft[]) => [...drafts].sort((left, right) =>
  Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  || Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];

const canonicalSourceUrl = (value: string) => {
  try {
    const url = new URL(value);
    url.hash = "";
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString();
  } catch {
    return value.trim();
  }
};

/**
 * Keeps every draft recoverable while moving obsolete generation attempts out
 * of the user's primary library. Two alternatives produced by the current
 * generator revision remain visible because they may represent intentional
 * editorial modes.
 */
export const normalizeDraftCatalog = (drafts: ArticleDraft[]): ArticleDraft[] => {
  const groups = new Map<string, ArticleDraft[]>();
  for (const draft of drafts) {
    const current = groups.get(draft.candidateId) ?? [];
    current.push(draft);
    groups.set(draft.candidateId, current);
  }

  const supersededBy = new Map<string, string>();
  for (const group of groups.values()) {
    const revisionNumbers = group
      .map(generatorRevisionNumber)
      .filter((value): value is number => value !== undefined);
    if (revisionNumbers.length) {
      const currentRevision = Math.max(...revisionNumbers);
      const currentDrafts = group.filter((draft) => generatorRevisionNumber(draft) === currentRevision);
      const replacement = newest(currentDrafts);
      if (!replacement) continue;
      for (const draft of group) {
        if (draft.provenance.authoringMode === "human-first") continue;
        const revision = generatorRevisionNumber(draft);
        if (draft.id === replacement.id || revision === currentRevision || hasDeliveryHistory(draft)) continue;
        supersededBy.set(draft.id, replacement.id);
      }
      continue;
    }

    // Legacy generators did not record a revision. Only collapse exact-source,
    // same-mode editing attempts; everything remains recoverable in history.
    const legacySourceGroups = new Map<string, ArticleDraft[]>();
    for (const draft of group) {
      const key = [
        canonicalSourceUrl(draft.provenance.originalUrl),
        draft.draftStrategy ?? "legacy",
        draft.contentFormat ?? "article",
        draft.provenance.authoringMode ?? "legacy",
      ].join("::");
      const current = legacySourceGroups.get(key) ?? [];
      current.push(draft);
      legacySourceGroups.set(key, current);
    }
    for (const sourceGroup of legacySourceGroups.values()) {
      if (sourceGroup.length < 2) continue;
      const replacement = newest(sourceGroup.filter((draft) => draft.status !== "shelved")) ?? newest(sourceGroup);
      if (!replacement) continue;
      for (const draft of sourceGroup) {
        if (draft.id === replacement.id || draft.status !== "editing" || hasDeliveryHistory(draft)) continue;
        supersededBy.set(draft.id, replacement.id);
      }
    }
  }

  return drafts.map((draft) => {
    const replacementId = supersededBy.get(draft.id);
    if (!replacementId) return draft;
    return {
      ...draft,
      status: "shelved",
      provenance: {
        ...draft.provenance,
        supersededByDraftId: replacementId,
      },
    };
  });
};
