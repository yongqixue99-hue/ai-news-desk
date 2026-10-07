import { deliveryContent } from "./delivery-content.js";
import { reworkReasons } from "./edit-observation.js";
import { snapshotDraft } from "./draft-revisions.js";
import { load } from "cheerio";
import { parseEditedCaption } from "./article-html.js";
import type { LocalDatabase, WorkflowEventRecord } from "./local-database.js";
import type { ArticleDraft, DraftRevisionSnapshot } from "./types.js";

export const draftDocumentBlocks = (snapshot: DraftRevisionSnapshot) => snapshot.bodyHtml
  ? deliveryContent(snapshot.bodyHtml).blocks : [...snapshot.paragraphs, snapshot.take].map(value => value.replace(/\s+/gu, " ").trim()).filter(Boolean);

/** Exact ordered matches; never a judgement of semantics, quality or factual correctness. */
export const retainedDraftBlocks = (before: string[], after: string[]) => {
  if (before.length > 1_000 || after.length > 1_000) return undefined;
  let previous = new Uint16Array(after.length + 1);
  for (const block of before) {
    const next = new Uint16Array(after.length + 1);
    for (let index = 0; index < after.length; index++) next[index + 1] = block === after[index] ? previous[index]! + 1 : Math.max(previous[index + 1]!, next[index]!);
    previous = next;
  }
  return previous[after.length]!;
};
const visibleImages = (snapshot: DraftRevisionSnapshot) => {
  const $ = load(snapshot.bodyHtml ?? "", null, false);
  const ids = snapshot.contentFormat === "image-post" ? snapshot.imagePostImageIds ?? [] : snapshot.bodyHtml === undefined
    ? snapshot.images.map(image => image.id) : $("img[data-media-id]").map((_i, node) => $(node).attr("data-media-id") || "").get();
  return new Map(snapshot.images.filter(image => ids.includes(image.id)).map(image => {
    const node = $("img[data-media-id]").filter((_i, node) => $(node).attr("data-media-id") === image.id).first();
    const caption = snapshot.contentFormat === "image-post" ? image.caption : parseEditedCaption($, node) || node.attr("data-caption")?.trim() || image.caption;
    return [image.id, { ...image, caption }];
  }));
};
export const draftReworkChanges = (draft: ArticleDraft) => {
  const initial = draft.editorialBaseline?.initial;
  if (!initial) return null;
  const current = snapshotDraft(draft), before = draftDocumentBlocks(initial.snapshot), after = draftDocumentBlocks(current);
  const retained = retainedDraftBlocks(before, after), beforeImages = visibleImages(initial.snapshot), afterImages = visibleImages(current);
  return { baseline: initial.origin, capturedAt: initial.capturedAt, titleChanged: initial.snapshot.title !== current.title,
    initialBlocks: before.length, currentBlocks: after.length, retainedBlocks: retained ?? null,
    changedOrRemovedBlocks: retained === undefined ? null : before.length - retained,
    addedOrChangedBlocks: retained === undefined ? null : after.length - retained,
    removedImages: [...beforeImages.keys()].filter(id => !afterImages.has(id)).length,
    addedImages: [...afterImages.keys()].filter(id => !beforeImages.has(id)).length,
    changedCaptions: [...afterImages].filter(([id, image]) => beforeImages.has(id) && beforeImages.get(id)!.caption !== image.caption).length,
    recentAiAssistance: draft.aiAssistedSinceConfirmation === true,
    scope: "saved-document-compared-with-captured-baseline; edits-are-not-quality-or-factual-error-scores" };
};
export const reworkWindow = (days = 30, now = new Date().toISOString()) => ({ since: new Date(Date.parse(now) - days * 86_400_000).toISOString(), through: now });
export const readReworkObservations = (database: Pick<LocalDatabase, "queryWorkflowEvents">, options: { days?: number; now?: string; draftId?: string } = {}) => {
  const window = reworkWindow(options.days, options.now);
  return { ...database.queryWorkflowEvents("draft.edit-observation", { ...window, draftId: options.draftId }), window };
};
type RecordedObservations = { events: WorkflowEventRecord[]; total: number; truncated: boolean };
export const summarizeReworkObservations = (input?: RecordedObservations) => {
  const seen = new Set<string>(), drafts = new Set<string>(), times: number[] = [];
  const reasons = new Map<string, { records: number; drafts: Set<string> }>();
  let records = 0, unmeasuredRecords = 0, excludedRecords = 0;
  for (const event of input?.events ?? []) {
    if (event.type !== "draft.edit-observation" || event.subjectType !== "draft" || seen.has(event.subjectId)) continue;
    seen.add(event.subjectId);
    const payload = event.payload as { draftId?: unknown; reasons?: unknown; timingBasis?: unknown; userEditMinutes?: unknown } | undefined;
    if (typeof payload?.draftId !== "string" || !payload.draftId || !Array.isArray(payload.reasons) || !payload.reasons.length
      || payload.reasons.some(reason => typeof reason !== "string" || !Object.hasOwn(reworkReasons, reason))) { excludedRecords++; continue; }
    records++; drafts.add(payload.draftId);
    if (payload.timingBasis === "user-reported" && typeof payload.userEditMinutes === "number" && Number.isFinite(payload.userEditMinutes) && payload.userEditMinutes >= 0 && payload.userEditMinutes <= 1440) times.push(payload.userEditMinutes);
    else unmeasuredRecords++;
    for (const reason of new Set(payload.reasons as Array<keyof typeof reworkReasons>)) {
      if (!reasons.has(reason)) reasons.set(reason, { records: 0, drafts: new Set() });
      const row = reasons.get(reason)!; row.records++; row.drafts.add(payload.draftId);
    }
  }
  return { collected: Boolean(input), records, drafts: drafts.size, excludedRecords, unmeasuredRecords,
    measuredRecords: times.length, userReportedMinutes: times.length ? times.reduce((a, b) => a + b, 0) : null,
    reasons: [...reasons].map(([reason, row]) => ({ reason, label: reworkReasons[reason as keyof typeof reworkReasons], records: row.records, drafts: row.drafts.size })).sort((a, b) => b.drafts - a.drafts || b.records - a.records || a.reason.localeCompare(b.reason)),
    coverage: { retainedEvents: input?.total ?? null, scannedEvents: input?.events.length ?? 0, truncated: input?.truncated ?? false },
    scope: "explicit-user-reported-rework; missing-time-is-unmeasured; does-not-change-factual-scores-or-writing-memory" };
};
