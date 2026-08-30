import path from "node:path";

export const resolveWorkflowRoot = (projectRoot: string, configuredRoot?: string) => {
  const configured = configuredRoot?.trim();
  return configured
    ? path.resolve(projectRoot, configured)
    : path.resolve(projectRoot, ".workflow");
};

export const workspaceRoot = process.cwd();
export const workflowRoot = resolveWorkflowRoot(
  workspaceRoot,
  process.env.AI_NEWS_DESK_WORKFLOW_ROOT,
);
