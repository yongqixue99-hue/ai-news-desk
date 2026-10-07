import type { StoryView, TodayView } from "./product-types.js";

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
