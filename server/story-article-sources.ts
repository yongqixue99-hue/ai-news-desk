import type { StorySignalView } from "./product-types.js";
import { sourceSnapshotKey } from "./source-snapshot.js";

/** Source pages for a selected article, with cached discovery wrappers folded away. */
export const selectStoryArticleSources = (
  story: { originalTitle: string; signals: StorySignalView[] },
  limit = 2,
) => {
  const rank = { official: 5, research: 4, verification: 3, discovery: 2, community: 1 };
  const wrapper = (url: string) => { try { return new URL(url).hostname === "news.google.com"; } catch { return true; } };
  const candidates = story.signals.filter((signal) => (signal.factBearing ?? !signal.isCommunity)
    && signal.sourceType !== "model-research")
    .sort((a, b) => Number(b.title === story.originalTitle) - Number(a.title === story.originalTitle)
      || Number(wrapper(a.url)) - Number(wrapper(b.url))
      || rank[b.sourceRole ?? "discovery"] - rank[a.sourceRole ?? "discovery"]
      || Number(b.briefingBasis === "full-source") - Number(a.briefingBasis === "full-source"));
  const seenUrls = new Set<string>();
  const seenCandidates = new Set<string>();
  const seenTitles = new Set<string>();
  return candidates.filter((signal) => {
    const url = sourceSnapshotKey(signal.url);
    const title = signal.title.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
    if (seenUrls.has(url) || seenCandidates.has(signal.candidateId) || seenTitles.has(title)) return false;
    seenUrls.add(url); seenCandidates.add(signal.candidateId); seenTitles.add(title);
    return true;
  }).slice(0, limit);
};
