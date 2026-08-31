import path from "node:path";

export const resolveWorkflowRoot = (projectRoot: string, configuredRoot?: string) => {
  const configured = configuredRoot?.trim();
  const pathApi = /^[a-z]:[\\/]/iu.test(projectRoot) || projectRoot.startsWith("\\\\")
    ? path.win32
    : path.posix;
  return configured
    ? pathApi.resolve(projectRoot, configured)
    : pathApi.resolve(projectRoot, ".workflow");
};

export const workspaceRoot = process.cwd();
export const workflowRoot = resolveWorkflowRoot(
  workspaceRoot,
  process.env.AI_NEWS_DESK_WORKFLOW_ROOT,
);
