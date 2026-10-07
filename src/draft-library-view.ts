import type { ArticleDraft } from "./types";

export type DraftSort = "updated" | "created" | "title";
export type DraftFilter = "all" | "working" | "ready" | "delivered";
export interface DraftSearchEntry { draft: ArticleDraft; bodyText: string; }
const normalized = (value: string) => value.normalize("NFKC").toLocaleLowerCase("zh-CN");

export function filterDraftLibrary(entries: DraftSearchEntry[], options: { query: string; status: DraftFilter; sort: DraftSort; includeShelved: boolean }) {
  const terms = normalized(options.query).trim().split(/\s+/u).filter(Boolean);
  return entries.filter(({ draft, bodyText }) => {
    if (!options.includeShelved && draft.status === "shelved") return false;
    const matchesStatus = options.status === "all"
      || (options.status === "working" && ["editing", "reviewing", "needs-images"].includes(draft.status))
      || (options.status === "ready" && draft.status === "ready")
      || (options.status === "delivered" && ["filled", "published"].includes(draft.status));
    const text = normalized([draft.title, bodyText, ...draft.sources.flatMap(source => [source.label, source.url])].join(" "));
    return matchesStatus && terms.every(term => text.includes(term));
  }).map(entry => entry.draft).sort((a, b) => {
    const order = options.sort === "title" ? (a.title || "未命名草稿").localeCompare(b.title || "未命名草稿", "zh-CN")
      : Date.parse(options.sort === "created" ? b.createdAt : b.updatedAt) - Date.parse(options.sort === "created" ? a.createdAt : a.updatedAt);
    return order || a.id.localeCompare(b.id);
  });
}

const LAST_DRAFT_KEY = "newsdesk.last-draft.v1";
type PreferenceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const readLastDraft = (storage: () => PreferenceStorage): string | undefined => {
  try { return storage().getItem(LAST_DRAFT_KEY) || undefined; } catch { return undefined; }
};
export const rememberLastDraft = (storage: () => PreferenceStorage, id?: string) => {
  try { if (id) storage().setItem(LAST_DRAFT_KEY, id); else storage().removeItem(LAST_DRAFT_KEY); } catch { /* Preferences must never block editing. */ }
};
export const resolveDraftId = (drafts: ArticleDraft[], id?: string) =>
  drafts.find(draft => draft.id === id)?.id ?? drafts.find(draft => draft.status !== "shelved")?.id ?? drafts[0]?.id;
