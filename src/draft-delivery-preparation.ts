import { xiaoheiheSelection } from "../server/xiaoheihe-publishing.js";
import type { DeliveryPlatform } from "../server/delivery-batch-types.js";
import type { ArticleDraft } from "./types.js";

/** Normalize only selected-channel defaults before saving the batch's bound revision. */
export const deliveryPreparationPatch = (
  draft: Pick<ArticleDraft, "community" | "topics" | "xiaoheiheOptions">,
  platforms: readonly DeliveryPlatform[],
  nextCompanion?: "Steam" | "数码硬件",
): Partial<ArticleDraft> | undefined => {
  if (!platforms.includes("xiaoheihe")) return undefined;
  const selection = xiaoheiheSelection(draft, nextCompanion);
  const options = draft.xiaoheiheOptions;
  if (draft.community === selection.community
    && draft.topics.length === selection.topics.length && draft.topics.every((topic, i) => topic === selection.topics[i])
    && options?.creationPlan === selection.options.creationPlan
    && options?.companionCommunity === selection.options.companionCommunity
    && options?.coverPlacementId === selection.options.coverPlacementId) return undefined;
  return { community: selection.community, topics: selection.topics, xiaoheiheOptions: selection.options };
};
