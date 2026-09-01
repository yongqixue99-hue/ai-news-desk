import { randomUUID } from "node:crypto";
import type { EditorialDraftQualityReport } from "./editorial-quality-desk.js";
import type { ArticleDraft, DraftGenerationAttempt, WorkflowState } from "./types.js";

interface CreateDraftGenerationAttemptInput {
  contentPackageId: string;
  storyId: string;
  generatorRevision: string;
  draft: ArticleDraft;
  qualityReport: EditorialDraftQualityReport;
  now?: string;
}

export const createDraftGenerationAttempt = ({
  contentPackageId,
  storyId,
  generatorRevision,
  draft,
  qualityReport,
  now = new Date().toISOString(),
}: CreateDraftGenerationAttemptInput): DraftGenerationAttempt => ({
  id: `draft_attempt_${randomUUID()}`,
  contentPackageId,
  storyId,
  draftId: draft.id,
  createdAt: draft.createdAt,
  completedAt: now,
  generatorRevision,
  aiTraceId: draft.provenance.aiTraceId,
  status: qualityReport.blockers.length ? "blocked" : qualityReport.warnings.length ? "warning" : "accepted",
  draft: structuredClone(draft),
  qualityReport: structuredClone(qualityReport),
});

export const recordDraftGenerationAttempt = (
  state: WorkflowState,
  attempt: DraftGenerationAttempt,
) => {
  state.draftGenerationAttempts ??= [];
  state.draftGenerationAttempts.unshift(structuredClone(attempt));
  state.draftGenerationAttempts = state.draftGenerationAttempts.slice(0, 40);
  return attempt;
};
