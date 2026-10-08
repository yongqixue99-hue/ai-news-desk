import type { RunArtifactReader } from "./run-artifacts.js";
import { composeCommunityFeed, type CommunityFeedComposition } from "./community-feed.js";
import type { SourceConfig, WorkflowState } from "./types.js";

export interface CommunityView {
  feed: Pick<CommunityFeedComposition, "items" | "expiredCount" | "duplicateCount" | "lastUpdatedAt">;
  sources: SourceConfig[];
  settings: Pick<WorkflowState["settings"], "personalizationEnabled">;
}

/** Reading projection: no drafts, run logs, raw source items or credentials. */
export const buildCommunityView = (state: Readonly<WorkflowState>, now = new Date().toISOString(), readArtifact?: RunArtifactReader): CommunityView => {
  const { items, expiredCount, duplicateCount, lastUpdatedAt } = composeCommunityFeed(state.runs, {
    now, readArtifact, expiryHours: 7 * 24, limit: 120, personalizationEnabled: state.settings.personalizationEnabled,
  });
  return {
    feed: { items, expiredCount, duplicateCount, lastUpdatedAt },
    sources: state.sources.filter(source => source.role === "community"),
    settings: { personalizationEnabled: state.settings.personalizationEnabled },
  };
};
