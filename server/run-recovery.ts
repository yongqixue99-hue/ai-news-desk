import type { WorkflowState } from "./types.js";

export const interruptedRunMessage = "服务在任务完成前退出；可以从运行记录重新执行";

const isResolvedCollectionRun = (state: WorkflowState, runId: string) => {
  const run = state.runs.find((entry) => entry.id === runId);
  return Boolean(run && (run.status === "ready" || run.status === "complete"));
};

export const clearResolvedCollectionFailures = (state: WorkflowState, runId: string) => {
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run || (run.status !== "ready" && run.status !== "complete")) return 0;
  run.error = undefined;
  const before = state.notifications.length;
  state.notifications = state.notifications.filter((notification) => !(
    notification.type === "collection-failed"
    && notification.target?.runId === runId
  ));
  return before - state.notifications.length;
};

/**
 * A retry continues the original collection request. Once it succeeds, keep the
 * failed run in history for diagnosis but remove its obsolete red notification.
 */
export const clearRetriedCollectionFailures = (state: WorkflowState, runId: string) => {
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run || (run.status !== "ready" && run.status !== "complete")) return 0;
  const resolvedRunIds = new Set<string>();
  let retryOfRunId = run.retryOfRunId;
  while (retryOfRunId && !resolvedRunIds.has(retryOfRunId)) {
    resolvedRunIds.add(retryOfRunId);
    retryOfRunId = state.runs.find((entry) => entry.id === retryOfRunId)?.retryOfRunId;
  }
  if (!resolvedRunIds.size) return 0;
  const before = state.notifications.length;
  state.notifications = state.notifications.filter((notification) => !(
    notification.type === "collection-failed"
    && notification.target?.runId
    && resolvedRunIds.has(notification.target.runId)
  ));
  return before - state.notifications.length;
};

/** Cleans legacy contradictions produced by the old startup ordering. */
export const reconcileResolvedCollectionFailures = (state: WorkflowState) => {
  const resolvedIds = new Set(
    state.runs
      .filter((run) => (run.status === "ready" || run.status === "complete") && run.error === interruptedRunMessage)
      .map((run) => run.id),
  );
  for (const runId of resolvedIds) clearResolvedCollectionFailures(state, runId);
  for (const run of state.runs) clearRetriedCollectionFailures(state, run.id);
  // A success may already have cleared run.error while the stale notification
  // survived in an older state file.
  state.notifications = state.notifications.filter((notification) => !(
    notification.type === "collection-failed"
    && notification.target?.runId
    && isResolvedCollectionRun(state, notification.target.runId)
  ));
  return resolvedIds.size;
};
