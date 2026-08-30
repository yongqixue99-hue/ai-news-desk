import { isCollectionActive } from "./run-policy.js";
import type { WorkflowRun } from "./types.js";

/**
 * Async collectors and model calls may finish after a user cancels a run.
 * Centralizing this rule keeps late results from reviving terminal work.
 */
export const canApplyCollectionResult = (
  run: Pick<WorkflowRun, "status">,
  signal?: AbortSignal,
) => !signal?.aborted && run.status !== "cancelled" && run.status !== "failed";

export const markCollectionReady = (
  run: WorkflowRun,
  completedAt: string,
) => {
  if (!isCollectionActive(run)) return false;
  run.status = "ready";
  run.stage = "等待选择";
  run.completedAt = completedAt;
  run.updatedAt = completedAt;
  return true;
};
