import type { StoryView, TodayView } from "./product-types.js";
import type { LocalDatabase } from "./local-database.js";
import type { WorkflowRun } from "./types.js";

export const lacksChineseTitle = (title: string) => !/[㐀-鿿]/u.test(title);

export interface TitleBackfillTarget { storyId: string; runId: string; candidateId: string }

/**
 * Stories the editor sees first on Today whose headline is still only in the
 * source language. The original title is never replaced: the translation is the
 * ordinary candidate briefing, and the Story keeps `originalTitle` beside it.
 */
export const titleBackfillTargets = (view: TodayView, limit = 12): TitleBackfillTarget[] => {
  const stories: StoryView[] = [
    ...(view.radar ?? []).flatMap((row) => row.story ? [row.story] : []),
    ...(view.pending ?? []),
    ...view.mustReads,
    ...(view.interesting ?? []),
    ...view.secondary,
  ];
  const targets = new Map<string, TitleBackfillTarget>();
  for (const story of stories) {
    if (targets.has(story.id) || !lacksChineseTitle(story.title)) continue;
    const signal = story.signals.find((entry) => entry.title === story.originalTitle && !entry.isCommunity)
      ?? story.signals.find((entry) => entry.title === story.originalTitle)
      ?? story.signals[0];
    if (signal) targets.set(story.id, { storyId: story.id, runId: signal.runId, candidateId: signal.candidateId });
    if (targets.size >= limit) break;
  }
  return [...targets.values()];
};

export const groupTitleBackfillByRun = (targets: TitleBackfillTarget[]) => {
  const runs = new Map<string, string[]>();
  for (const target of targets) runs.set(target.runId, [...(runs.get(target.runId) ?? []), target.candidateId]);
  return runs;
};

export interface TitleBackfillResult { requested: number; completed: number; failed: number }
export const automaticTitlesEnabled = () => process.env.AI_NEWS_DESK_AUTO_TITLES !== "0";

/** One bounded operation shared by the page fallback and durable background job.
 * The injected enrichment retains the existing analysis provider and grounding. */
export const createTodayTitleBackfill = (dependencies: {
  readView: () => Promise<TodayView>;
  enrich: (runId: string, options: { candidateIds: string[]; signal?: AbortSignal }) => Promise<TitleBackfillResult>;
  enabled?: () => boolean;
}) => {
  let running: Promise<TitleBackfillResult> | undefined;
  return (signal?: AbortSignal): Promise<TitleBackfillResult> => {
    if (!(dependencies.enabled ?? automaticTitlesEnabled)()) return Promise.resolve({ requested: 0, completed: 0, failed: 0 });
    running ??= (async () => {
      signal?.throwIfAborted();
      const targets = titleBackfillTargets(await dependencies.readView(), 12);
      const total = { requested: 0, completed: 0, failed: 0 };
      for (const [runId, candidateIds] of groupTitleBackfillByRun(targets)) {
        signal?.throwIfAborted();
        try {
          const result = await dependencies.enrich(runId, { candidateIds, signal });
          total.requested += result.requested; total.completed += result.completed; total.failed += result.failed;
        } catch (error) {
          if (signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
          total.requested += candidateIds.length; total.failed += candidateIds.length;
        }
      }
      return total;
    })().finally(() => { running = undefined; });
    return running;
  };
};

/** At most one attempt per completed collection, even after failure or restart.
 * Queue errors cannot turn a successful collection into a failed collection. */
export const enqueueTodayTitleBackfill = (database: LocalDatabase, run: WorkflowRun | undefined, enabled = automaticTitlesEnabled) => {
  if (!enabled() || run?.status !== "ready" || run.collectionPurpose === "aggregation") return;
  try {
    const idempotencyKey = `backfill-today-titles:${run.id}`;
    if (database.getJobByIdempotencyKey(idempotencyKey)) return;
    return database.enqueueJob({ lane: "background", type: "backfill-today-titles", idempotencyKey,
      payload: { runId: run.id }, maxAttempts: 1 });
  } catch (error) {
    try { database.recordWorkflowEvent({ type: "today-titles.enqueue-failed", subjectType: "run", subjectId: run.id,
      payload: { message: error instanceof Error ? error.message : String(error) } }); }
    catch { console.error("后台中文标题任务入队失败；采集结果已保留"); }
    return;
  }
};
