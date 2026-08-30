import { randomUUID } from "node:crypto";
import { sanitizeDraftHtml } from "./article-html.js";
import type {
  ArticleDraft,
  DraftRevision,
  DraftRevisionSnapshot,
  DraftSaveMode,
  WorkflowState,
} from "./types.js";

const AUTO_CHECKPOINT_WINDOW_MS = 5 * 60_000;
const MAX_REVISIONS_PER_DRAFT = 30;

const clone = <T>(value: T): T => structuredClone(value);

export const snapshotDraft = (draft: ArticleDraft): DraftRevisionSnapshot => ({
  contentFormat: draft.contentFormat,
  title: draft.title,
  paragraphs: clone(draft.paragraphs),
  take: draft.take,
  bodyHtml: draft.bodyHtml ? sanitizeDraftHtml(draft.bodyHtml) : undefined,
  layoutTheme: draft.layoutTheme,
  sources: clone(draft.sources),
  factClaims: clone(draft.factClaims ?? []),
  uncertainties: clone(draft.uncertainties),
  images: clone(draft.images),
  community: draft.community,
  topics: clone(draft.topics),
  sourceMaterial: draft.sourceMaterial ? clone(draft.sourceMaterial) : undefined,
});

const snapshotKey = (snapshot: DraftRevisionSnapshot) => JSON.stringify(snapshot);

const revisionLabel = (kind: DraftRevision["kind"]) => {
  if (kind === "auto") return "自动保存";
  if (kind === "restore-backup") return "恢复前备份";
  return "手动保存";
};

const trimDraftRevisions = (state: WorkflowState, draftId: string) => {
  const matching = state.draftRevisions
    .filter((revision) => revision.draftId === draftId)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const excessIds = new Set(
    matching.slice(0, Math.max(0, matching.length - MAX_REVISIONS_PER_DRAFT)).map((revision) => revision.id),
  );
  if (excessIds.size) {
    state.draftRevisions = state.draftRevisions.filter((revision) => !excessIds.has(revision.id));
  }
};

export const appendDraftRevision = (
  state: WorkflowState,
  draft: ArticleDraft,
  kind: DraftSaveMode | "restore-backup",
  now = new Date(),
) => {
  state.draftRevisions ??= [];
  const timestamp = now.toISOString();
  const snapshot = snapshotDraft(draft);
  const revisions = state.draftRevisions
    .filter((revision) => revision.draftId === draft.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const latest = revisions.at(-1);

  // Keep one rolling automatic checkpoint during a five-minute writing
  // window. The draft itself is still persisted on every autosave.
  if (
    kind === "auto" &&
    latest?.kind === "auto" &&
    now.getTime() - new Date(latest.createdAt).getTime() < AUTO_CHECKPOINT_WINDOW_MS
  ) {
    latest.snapshot = snapshot;
    latest.updatedAt = timestamp;
    return latest;
  }

  if (kind === "auto" && latest && snapshotKey(latest.snapshot) === snapshotKey(snapshot)) {
    return latest;
  }

  const revision: DraftRevision = {
    id: `revision_${randomUUID().slice(0, 12)}`,
    draftId: draft.id,
    createdAt: timestamp,
    updatedAt: timestamp,
    kind,
    label: revisionLabel(kind),
    snapshot,
  };
  state.draftRevisions.push(revision);
  trimDraftRevisions(state, draft.id);
  return revision;
};

export const revisionsForDraft = (state: WorkflowState, draftId: string) =>
  (state.draftRevisions ?? [])
    .filter((revision) => revision.draftId === draftId)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

export const restoreDraftRevision = (
  state: WorkflowState,
  draft: ArticleDraft,
  revision: DraftRevision,
  now = new Date(),
) => {
  appendDraftRevision(state, draft, "restore-backup", now);
  const snapshot = clone(revision.snapshot);
  draft.contentFormat = snapshot.contentFormat === "image-post" ? "image-post" : "article";
  draft.title = snapshot.title;
  draft.paragraphs = snapshot.paragraphs;
  draft.take = snapshot.take;
  draft.bodyHtml = snapshot.bodyHtml ? sanitizeDraftHtml(snapshot.bodyHtml) : undefined;
  draft.layoutTheme = snapshot.layoutTheme;
  draft.sources = snapshot.sources;
  draft.factClaims = snapshot.factClaims ?? [];
  draft.uncertainties = snapshot.uncertainties;
  draft.images = snapshot.images;
  draft.community = snapshot.community;
  draft.topics = snapshot.topics;
  draft.sourceMaterial = snapshot.sourceMaterial;
  draft.updatedAt = now.toISOString();
  return draft;
};
