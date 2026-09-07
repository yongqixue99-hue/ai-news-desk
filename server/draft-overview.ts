import { normalizeDraftCatalog } from "./draft-catalog.js";
import type { ArticleDraft } from "./types.js";

export interface DraftOverview {
  total: number;
  recent: Array<Pick<ArticleDraft, "id" | "title" | "status" | "updatedAt">>;
}

/** DraftDesk's bounded, read-only projection for resuming unfinished work. */
export const buildDraftOverview = (drafts: ArticleDraft[]): DraftOverview => {
  const current = normalizeDraftCatalog(drafts)
    .filter((draft) => draft.status !== "shelved" && draft.status !== "published" && !draft.provenance.supersededByDraftId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt) || left.id.localeCompare(right.id));
  return {
    total: current.length,
    recent: current.slice(0, 3).map(({ id, title, status, updatedAt }) => ({ id, title, status, updatedAt })),
  };
};
