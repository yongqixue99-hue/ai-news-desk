import type { WorkflowRun, WorkflowState } from "./types.js";

export const retainRecentAndReferencedRuns = (
  runs: WorkflowRun[],
  referencedRunIds: ReadonlySet<string>,
  recentLimit = 30,
) => {
  const recentIds = new Set(runs.slice(0, Math.max(0, Math.floor(recentLimit))).map((run) => run.id));
  return runs.filter((run) => recentIds.has(run.id) || referencedRunIds.has(run.id));
};

export const retainWorkflowRuns = (state: Pick<WorkflowState, "runs" | "drafts" | "intakeReviews">, recentLimit = 30) => {
  const referencedRunIds = new Set([
    ...state.drafts.map((draft) => draft.runId),
    ...state.intakeReviews.flatMap((review) => review.runId ? [review.runId] : []),
  ]);
  state.runs = retainRecentAndReferencedRuns(state.runs, referencedRunIds, recentLimit);
  return state.runs;
};
