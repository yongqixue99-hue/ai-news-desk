import { extractPage } from "./extractor.js";
import { captureRenderedPageImages } from "./page-screenshot.js";
import { readState, updateState } from "./storage.js";
import { storyById } from "./story-desk.js";
import type { SourceImage, SourceRole } from "./types.js";

const inFlight = new Map<string, Promise<{ imageCount: number; extractedSources: number; screenshotCount: number }>>();

const roleRank = (role: SourceRole | undefined) => ({
  official: 5,
  research: 4,
  verification: 3,
  discovery: 2,
  community: 1,
})[role ?? "discovery"];

const mergeImages = (current: SourceImage[], incoming: SourceImage[]) => {
  const keys = new Set(current.map((image) => image.publicPath || image.url));
  return [...current, ...incoming.filter((image) => {
    const key = image.publicPath || image.url;
    if (keys.has(key)) return false;
    keys.add(key);
    return true;
  })].slice(0, 30);
};

const hydrate = async (storyId: string, minimumImages: number) => {
  const initial = await readState();
  const story = storyById(initial, storyId);
  if (!story) throw new Error("Story 不存在");
  if (story.imageCount >= minimumImages) {
    return { imageCount: story.imageCount, extractedSources: 0, screenshotCount: 0 };
  }
  const signals = story.signals
    .filter((signal) => !signal.isCommunity)
    .sort((left, right) => roleRank(right.sourceRole) - roleRank(left.sourceRole))
    .slice(0, 3);
  let extractedSources = 0;
  for (const signal of signals) {
    try {
      const page = await extractPage(signal.url, 12);
      extractedSources += 1;
      await updateState((state) => {
        const candidate = state.runs.find((run) => run.id === signal.runId)
          ?.candidates.find((entry) => entry.id === signal.candidateId);
        if (!candidate) return;
        candidate.canonicalUrl = page.canonicalUrl;
        candidate.images = mergeImages(candidate.images, page.images);
        candidate.imageCount = candidate.images.length;
        if (!candidate.excerpt.trim() && page.text.trim()) candidate.excerpt = page.text.trim().slice(0, 600);
      });
    } catch {
      // Other sources and screenshot fallback still run. A single publisher's
      // client shell or bot protection must not empty the whole visual pack.
    }
    const refreshed = storyById(await readState(), storyId);
    if ((refreshed?.imageCount ?? 0) >= minimumImages) break;
  }

  let screenshotCount = 0;
  let refreshed = storyById(await readState(), storyId);
  if ((refreshed?.imageCount ?? 0) < minimumImages) {
    const screenshotRoot = `story_assets_${storyId.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 70)}`;
    for (const signal of signals.slice(0, 2)) {
      try {
        const requested = Math.min(3, minimumImages - (refreshed?.imageCount ?? 0));
        if (requested <= 0) break;
        const screenshots = await captureRenderedPageImages(signal.url, screenshotRoot, requested);
        screenshotCount += screenshots.length;
        await updateState((state) => {
          const candidate = state.runs.find((run) => run.id === signal.runId)
            ?.candidates.find((entry) => entry.id === signal.candidateId);
          if (!candidate) return;
          candidate.images = mergeImages(candidate.images, screenshots);
          candidate.imageCount = candidate.images.length;
        });
        refreshed = storyById(await readState(), storyId);
        if ((refreshed?.imageCount ?? 0) >= minimumImages) break;
      } catch {
        // No irrelevant generated image is substituted when rendering fails.
      }
    }
  }
  refreshed = storyById(await readState(), storyId);
  return { imageCount: refreshed?.imageCount ?? 0, extractedSources, screenshotCount };
};

/**
 * Visual hydration is deliberately lazy: only a user-selected Story pays the
 * cost of reading image-heavy pages and rendering screenshot fallbacks.
 */
export const hydrateStoryAssets = (storyId: string, minimumImages = 2) => {
  const existing = inFlight.get(storyId);
  if (existing) return existing;
  const operation = hydrate(storyId, Math.max(0, Math.min(8, minimumImages)))
    .finally(() => inFlight.delete(storyId));
  inFlight.set(storyId, operation);
  return operation;
};
