import type { WorkflowState } from "./types.js";

/** Pure storage selector; readStateProjection clones only this smaller view.
 * Revisions, trash and agent threads retain their existing lazy-load contract. */
export const bootstrapView = (state: Readonly<WorkflowState>): WorkflowState => ({
  ...state,
  runs: state.runs.map(({ discoveryTrace, evidenceCandidates, aggregationItems, ...run }) => run),
  draftRevisions: [],
  draftTrash: [],
  articleAgentThreads: [],
});

/** The original diagnostics remain intact on disk and are read only on demand. */
export const runDiagnosticsView = (state: Readonly<WorkflowState>, runId: string) => {
  const run = state.runs.find((entry) => entry.id === runId);
  return run ? {
    runId: run.id,
    discoveryTrace: run.discoveryTrace ?? [],
    evidenceCandidates: run.evidenceCandidates ?? [],
    aggregationItems: run.aggregationItems ?? [],
  } : undefined;
};
