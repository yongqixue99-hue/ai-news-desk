import {
  applyXAccountObservations,
  applyXSourceCursors,
  collectXOfficialSources,
  createXApiClient,
  type XAccountObservation,
} from "./x-official.js";
import { getXBearerToken } from "./secrets.js";
import { findActiveCollectionRun } from "./run-policy.js";
import { retainWorkflowRuns } from "./run-retention.js";
import { rawItemTimeRejectionReason, rawItemToCandidate, sortCandidates } from "./scoring.js";
import { readState, updateState } from "./storage.js";
import { normalizeTopicIds } from "./topics.js";
import type { Candidate, RawHorizonItem, SourceConfig, WorkflowRun, WorkflowState } from "./types.js";

const DEFAULT_INTERVAL_MS = 5 * 60_000;
const MONITOR_WINDOW_HOURS = 48;

interface XMonitorCollectionResult {
  items: RawHorizonItem[];
  failures: Record<string, string>;
  cursors: Record<string, string>;
  accountObservations?: Record<string, XAccountObservation[]>;
}

interface XMonitorDependencies {
  readState: () => Promise<WorkflowState>;
  updateState: <T>(mutate: (state: WorkflowState) => T | Promise<T>) => Promise<T>;
  getBearerToken: () => Promise<string>;
  collect?: (sources: SourceConfig[], options: { signal?: AbortSignal }) => Promise<XMonitorCollectionResult>;
  now?: () => Date;
  minimumIntervalMs?: number;
}

export type XMonitorPollStatus =
  | "collected"
  | "not-due"
  | "source-disabled"
  | "token-missing"
  | "collection-busy";

export interface XMonitorPollResult {
  status: XMonitorPollStatus;
  itemCount: number;
  candidateCount: number;
}

const sourceItemCount = (items: RawHorizonItem[], sourceId: string) => items.filter(
  (item) => item.metadata?.source_id === sourceId,
).length;

const rankedCandidate = (
  candidate: Candidate,
  state: Pick<WorkflowState, "candidateFeedback" | "settings">,
) => sortCandidates(
  [candidate],
  state.candidateFeedback,
  state.settings.personalizationEnabled,
)[0] ?? candidate;

/**
 * A low-cost, local polling seam for high-value X accounts. It never invokes
 * the writing model: new posts enter the Story desk and remain subject to the
 * usual evidence/package gates before any draft can be created.
 */
export const createXMonitorDesk = (dependencies: XMonitorDependencies) => {
  const now = dependencies.now ?? (() => new Date());
  const intervalMs = Math.max(60_000, dependencies.minimumIntervalMs ?? DEFAULT_INTERVAL_MS);
  let lastAttemptAt = Number.NEGATIVE_INFINITY;
  let inFlight: Promise<XMonitorPollResult> | undefined;

  const execute = async (): Promise<XMonitorPollResult> => {
    const currentTime = now();
    const currentMs = currentTime.getTime();
    if (currentMs - lastAttemptAt < intervalMs) {
      return { status: "not-due", itemCount: 0, candidateCount: 0 };
    }
    const state = await dependencies.readState();
    if (findActiveCollectionRun(state.runs)) {
      return { status: "collection-busy", itemCount: 0, candidateCount: 0 };
    }
    const sources = state.sources.filter((source) => source.kind === "x" && source.enabled && source.selected);
    if (!sources.length) {
      return { status: "source-disabled", itemCount: 0, candidateCount: 0 };
    }
    lastAttemptAt = currentMs;
    const bearerToken = (await dependencies.getBearerToken()).trim();
    if (!bearerToken) {
      return { status: "token-missing", itemCount: 0, candidateCount: 0 };
    }
    const collect = dependencies.collect ?? ((selectedSources, options) => collectXOfficialSources(
      selectedSources,
      {
        client: createXApiClient({ getBearerToken: async () => bearerToken }),
        signal: options.signal,
        now,
      },
    ));
    const result = await collect(sources, {});
    const timestamp = currentTime.toISOString();
    const freshItems = result.items.filter((item) => !rawItemTimeRejectionReason(
      item,
      {},
      { windowHours: MONITOR_WINDOW_HOURS, now: currentMs },
    ));
    const topicIds = normalizeTopicIds(sources.flatMap((source) => source.topicIds ?? ["ai"]));
    const candidates = freshItems.map((item) => rankedCandidate(
      rawItemToCandidate(item, MONITOR_WINDOW_HOURS, topicIds),
      state,
    ));

    await dependencies.updateState((current) => {
      applyXSourceCursors(current.sources, result.cursors);
      applyXAccountObservations(current.sources, result.accountObservations ?? {});
      for (const source of current.sources.filter((entry) => sources.some((selected) => selected.id === entry.id))) {
        const failure = result.failures[source.id];
        const rawCount = sourceItemCount(result.items, source.id);
        const candidateCount = candidates.filter((candidate) => candidate.sourceName === source.name).length;
        source.lastCheckedAt = timestamp;
        source.lastRawCount = rawCount;
        source.lastCandidateCount = candidateCount;
        if (failure) {
          source.health = "error";
          source.consecutiveFailures = (source.consecutiveFailures ?? 0) + 1;
          source.lastHealthDetail = failure;
        } else {
          source.health = "healthy";
          source.lastSuccessfulAt = timestamp;
          source.consecutiveFailures = 0;
          source.lastHealthDetail = rawCount
            ? `X 5 分钟增量监控正常，本轮读取 ${rawCount} 条新原帖`
            : "X 5 分钟增量监控正常，本轮没有新原帖";
        }
      }
      if (!candidates.length) return;

      const dateKey = timestamp.slice(0, 10).replace(/-/gu, "");
      const runId = `x_monitor_${dateKey}`;
      let run = current.runs.find((entry) => entry.id === runId);
      if (!run) {
        run = {
          id: runId,
          createdAt: timestamp,
          updatedAt: timestamp,
          completedAt: timestamp,
          status: "ready",
          stage: "X 官号增量监控",
          windowHours: MONITOR_WINDOW_HOURS,
          topicIds,
          sourceIds: sources.map((source) => source.id),
          scheduled: true,
          rawCount: 0,
          candidates: [],
          logs: [],
        } satisfies WorkflowRun;
        current.runs.unshift(run);
      }
      const byId = new Map(run.candidates.map((candidate) => [candidate.id, candidate]));
      for (const candidate of candidates) byId.set(candidate.id, candidate);
      run.candidates = [...byId.values()].sort((left, right) =>
        right.recommendationScore - left.recommendationScore
        || Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
      run.rawCount += result.items.length;
      run.updatedAt = timestamp;
      run.completedAt = timestamp;
      run.sourceIds = [...new Set([...run.sourceIds, ...sources.map((source) => source.id)])];
      run.logs.push({
        at: timestamp,
        stage: "X 官号增量监控",
        message: `读取 ${result.items.length} 条新原帖，${candidates.length} 条进入编辑台；未自动出稿`,
        level: "success",
      });
      run.logs = run.logs.slice(-60);
      retainWorkflowRuns(current);
    });

    return { status: "collected", itemCount: result.items.length, candidateCount: candidates.length };
  };

  return {
    poll() {
      if (inFlight) return inFlight;
      inFlight = execute().finally(() => { inFlight = undefined; });
      return inFlight;
    },
  };
};

export const officialXMonitor = createXMonitorDesk({
  readState,
  updateState,
  getBearerToken: getXBearerToken,
});
