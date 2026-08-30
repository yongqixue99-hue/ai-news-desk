import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, upgradeState } from "./defaults.js";
import { LocalDatabase } from "./local-database.js";
import type { WorkflowState } from "./types.js";

const workspaceRoot = process.cwd();
export const workflowRoot = path.join(workspaceRoot, ".workflow");
export const workflowMediaRoot = path.join(workflowRoot, "media");
export const workflowJobsRoot = path.join(workflowRoot, "jobs");
export const workflowMaterialsRoot = path.join(workflowRoot, "materials");
const statePath = path.join(workflowRoot, "state.json");

let queue: Promise<unknown> = Promise.resolve();
let databasePromise: Promise<LocalDatabase> | undefined;
let stateCache: WorkflowState | undefined;

const ensureDirectories = async () => {
  await mkdir(workflowRoot, { recursive: true });
  await mkdir(workflowMediaRoot, { recursive: true });
  await mkdir(workflowJobsRoot, { recursive: true });
  await mkdir(workflowMaterialsRoot, { recursive: true });
};

export const readState = async (): Promise<WorkflowState> => {
  await ensureDirectories();
  if (stateCache) return structuredClone(stateCache);
  const state = upgradeState((await localDatabase()).readState<WorkflowState>());
  state.draftRevisions ??= [];
  state.articleAgentThreads ??= [];
  if (state.settings.xiaoheiheEditorUrl.includes("/app/bbs/link/new_post")) {
    state.settings.xiaoheiheEditorUrl = "https://xiaoheihe.cn/community/user/post_list";
  }
  stateCache = structuredClone(state);
  return structuredClone(stateCache);
};

const localDatabase = async () => {
  databasePromise ??= LocalDatabase.open({
    workflowRoot,
    legacyStatePath: statePath,
    initialState: createDefaultState,
  });
  return databasePromise;
};

const persistState = async (state: WorkflowState) => {
  await ensureDirectories();
  (await localDatabase()).writeState(state);
  stateCache = structuredClone(state);
};

export const updateState = async <T>(
  mutate: (state: WorkflowState) => T | Promise<T>,
): Promise<T> => {
  const operation = queue.then(async () => {
    const state = await readState();
    const result = await mutate(state);
    await persistState(state);
    return result;
  });
  queue = operation.catch(() => undefined);
  return operation;
};

/**
 * Replaces state only after the caller has validated and upgraded a backup.
 * Restore callers create a SQLite checkpoint before this replacement. The
 * legacy JSON remains an immutable migration fallback and is never dual-written.
 */
export const replaceState = async (nextState: WorkflowState): Promise<WorkflowState> => {
  const operation = queue.then(async () => {
    const state = upgradeState(structuredClone(nextState));
    await persistState(state);
    return state;
  });
  queue = operation.catch(() => undefined);
  return operation;
};

export const getLocalDatabase = localDatabase;

export const workspacePath = (...parts: string[]) => path.join(workspaceRoot, ...parts);
