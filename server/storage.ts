import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createDefaultState, upgradeState } from "./defaults.js";
import { LocalDatabase } from "./local-database.js";
import { runArtifactKinds, artifactFromRun, type RunArtifactReader } from "./run-artifacts.js";
import type { WorkflowState } from "./types.js";
import { workflowRoot, workspaceRoot } from "./workspace-paths.js";

export { workflowRoot };
export const workflowMediaRoot = path.join(workflowRoot, "media");
export const workflowJobsRoot = path.join(workflowRoot, "jobs");
export const workflowMaterialsRoot = path.join(workflowRoot, "materials");
const statePath = path.join(workflowRoot, "state.json");

let queue: Promise<unknown> = Promise.resolve();
let databasePromise: Promise<LocalDatabase> | undefined;
let databaseInstance: LocalDatabase | undefined;
let stateCache: WorkflowState | undefined;
// Monotonic within this process; a new process also starts with an empty view cache.
let stateRevision = 0;
export const getStateRevision = () => stateRevision;

const ensureDirectories = async () => {
  await mkdir(workflowRoot, { recursive: true });
  await mkdir(workflowMediaRoot, { recursive: true });
  await mkdir(workflowJobsRoot, { recursive: true });
  await mkdir(workflowMaterialsRoot, { recursive: true });
};

const cachedState = async (): Promise<WorkflowState> => {
  await ensureDirectories();
  if (stateCache) return stateCache;
  const state = upgradeState((await localDatabase()).readStateLean<WorkflowState>());
  state.draftGenerationAttempts ??= [];
  state.draftRevisions ??= [];
  state.articleAgentThreads ??= [];
  if (state.settings.xiaoheiheEditorUrl.includes("/app/bbs/link/new_post")) {
    state.settings.xiaoheiheEditorUrl = "https://xiaoheihe.cn/community/user/post_list";
  }
  stateCache = structuredClone(state);
  return stateCache;
};

export const readRunArtifact: RunArtifactReader = (runId, kind) => {
  if (!databaseInstance) throw new Error("运行明细读取必须先初始化存储");
  return databaseInstance.getRunArtifact(runId, kind);
};
const leanState = (state: WorkflowState): WorkflowState => ({ ...state, runs: state.runs.map(({ discoveryTrace, evidenceCandidates, aggregationItems, ...run }) => run) });
export const readState = async (): Promise<WorkflowState> => {
  const state = structuredClone(await cachedState());
  for (const run of state.runs) for (const kind of runArtifactKinds) {
    const value = artifactFromRun(run, kind, readRunArtifact);
    if (value !== undefined) Object.assign(run, { [kind]: value });
  }
  return state;
};

/** Pure synchronous selectors clone only the result, never the whole archive.
 * Selectors must not mutate the cached state. Results cannot alias storage. */
export const readStateProjection = async <T>(select: (state: Readonly<WorkflowState>, readArtifact?: RunArtifactReader) => T): Promise<T> =>
  structuredClone(select(await cachedState(), readRunArtifact));

const localDatabase = async () => {
  databasePromise ??= LocalDatabase.open({
    workflowRoot,
    legacyStatePath: statePath,
    initialState: createDefaultState,
  }).then(database => { databaseInstance = database; return database; });
  return databasePromise;
};

const persistState = async (state: WorkflowState, replaceArtifacts = false) => {
  await ensureDirectories();
  (await localDatabase()).writeState(state, { replaceArtifacts });
  stateCache = structuredClone(leanState(state));
  stateRevision += 1;
};

export const updateState = async <T>(
  mutate: (state: WorkflowState) => T | Promise<T>,
): Promise<T> => {
  const operation = queue.then(async () => {
    const state = structuredClone(await cachedState());
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
    await persistState(state, true);
    return state;
  });
  queue = operation.catch(() => undefined);
  return operation;
};

/**
 * Serialize an exclusive whole-workspace operation behind ordinary state
 * mutations. The supplied replacement keeps the in-memory cache aligned with
 * each database apply or rollback performed by the operation.
 */
export const runStorageExclusive = async <T>(
  action: (context: {
    database: LocalDatabase;
    replaceDatabaseSnapshot: (snapshotPath: string) => void;
  }) => Promise<T>,
): Promise<T> => {
  const operation = queue.then(async () => {
    const database = await localDatabase();
    return action({
      database,
      replaceDatabaseSnapshot: (snapshotPath) => {
        database.replaceFromSnapshot(snapshotPath);
        stateCache = upgradeState(database.readStateLean<WorkflowState>());
        stateRevision += 1;
      },
    });
  });
  queue = operation.catch(() => undefined);
  return operation;
};

export const getLocalDatabase = localDatabase;

export const workspacePath = (...parts: string[]) => path.join(workspaceRoot, ...parts);
