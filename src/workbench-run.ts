import type { WorkflowRun } from "./types";

export const chooseWorkbenchRun = (runs: WorkflowRun[], requestedId?: string) =>
  runs.find((run) => run.id === requestedId) ?? runs.find((run) => (!run.origin || run.origin === "collection"));
