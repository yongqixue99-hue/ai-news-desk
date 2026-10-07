import { buildTodayView } from "./story-desk.js";
import { getStateRevision, readStateProjection } from "./storage.js";
import type { TodayView } from "./product-types.js";
import type { WorkflowState } from "./types.js";

/** One process-local view, invalidated by committed state and the wall minute.
 * Returning copies prevents UI consumers from mutating the cached projection. */
export const createTodayViewCache = (options: { now?: () => number; build?: typeof buildTodayView } = {}) => {
  let cached: { revision: number; minute: number; view: TodayView } | undefined;
  return (state: WorkflowState, revision: number): TodayView => {
    const timestamp = (options.now ?? Date.now)();
    const minute = Math.floor(timestamp / 60_000);
    if (!cached || cached.revision !== revision || cached.minute !== minute) {
      cached = { revision, minute, view: (options.build ?? buildTodayView)(state, new Date(timestamp).toISOString()) };
    }
    return structuredClone(cached.view);
  };
};

const todayView = createTodayViewCache();
export const readTodayView = () => readStateProjection(state => todayView(state, getStateRevision()));
