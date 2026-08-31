import path from "node:path";
import { downloadSourceImage, extractPage } from "./extractor.js";
import {
  createGeneratedEditorialFallback,
  createGroundedEditorialCover,
} from "./editorial-visual-generator.js";
import { captureRenderedPageImages } from "./page-screenshot.js";
import { isLocalImageFileReady, isNeutralImagePublishReady } from "./image-readiness.js";
import { searchLicensedEditorialImages } from "./online-image-search.js";
import { readState, updateState, workflowMediaRoot } from "./storage.js";
import { storyById } from "./story-desk.js";
import type { StorySignalView } from "./product-types.js";
import type { ExtractedPage, SourceImage, SourceRole } from "./types.js";

export interface VisualAssetCounts {
  discoveredImageCount: number;
  localReadyImageCount: number;
  publishReadyImageCount: number;
  rightsReviewImageCount: number;
}

export interface VisualHydrationResult extends VisualAssetCounts {
  /**
   * Compatibility field used by existing job/result consumers. It now means
   * locally usable assets, not remote image URLs discovered on a page.
   */
  imageCount: number;
  extractedSources: number;
  screenshotCount: number;
  onlineSearchCount: number;
  generatedCount: number;
}

interface VisualStorySnapshot {
  id: string;
  title: string;
  originalTitle: string;
  summary: string;
  images: SourceImage[];
  signals: StorySignalView[];
}

export interface VisualHydrationDependencies {
  getStory: () => Promise<VisualStorySnapshot | undefined>;
  extract: (url: string, imageLimit: number) => Promise<ExtractedPage>;
  persistExtraction: (signal: StorySignalView, page: ExtractedPage) => Promise<void>;
  persistImages: (signal: StorySignalView, images: SourceImage[]) => Promise<void>;
  localize: (image: SourceImage, assetRoot: string) => Promise<SourceImage>;
  capture: (url: string, assetRoot: string, requestedLimit: number) => Promise<SourceImage[]>;
  searchOnline?: (story: VisualStorySnapshot, requestedLimit: number, priority: 3 | 4) => Promise<SourceImage[]>;
  stylizeIdentity?: (image: SourceImage, story: VisualStorySnapshot, assetRoot: string) => Promise<SourceImage>;
  generateFallback?: (story: VisualStorySnapshot, assetRoot: string) => Promise<SourceImage[]>;
}

const inFlight = new Map<string, {
  promise: Promise<VisualHydrationResult>;
  listeners: Set<NonNullable<NonNullable<Parameters<typeof runVisualHydration>[3]>["progress"]>>;
}>();

const roleRank = (role: SourceRole | undefined) => ({
  official: 5,
  research: 4,
  verification: 3,
  discovery: 2,
  community: 1,
})[role ?? "discovery"];

const normalizedUrlIdentity = (value: string | undefined) => {
  const raw = value?.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|spm|from)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString().toLocaleLowerCase();
  } catch {
    return raw.toLocaleLowerCase();
  }
};

const validFingerprint = (value: string | undefined) => {
  const normalized = value?.trim().toLocaleLowerCase() || "";
  return /^[a-f0-9]{64}$/u.test(normalized) ? normalized : "";
};

/**
 * A CDN URL or generated id is not globally unique. Images may be merged only
 * inside the same traceable source record, using a content fingerprint, image
 * URL or id as the second half of the identity.
 */
const sameImage = (left: SourceImage, right: SourceImage) => {
  const leftSource = normalizedUrlIdentity(left.sourceUrl);
  const rightSource = normalizedUrlIdentity(right.sourceUrl);
  if (!leftSource || leftSource !== rightSource) return false;
  const leftFingerprint = validFingerprint(left.fingerprint);
  const rightFingerprint = validFingerprint(right.fingerprint);
  if (leftFingerprint && leftFingerprint === rightFingerprint) return true;
  const leftUrl = normalizedUrlIdentity(left.url);
  const rightUrl = normalizedUrlIdentity(right.url);
  if (leftUrl && leftUrl === rightUrl) return true;
  const leftId = left.id.trim();
  return Boolean(leftId && leftId === right.id.trim());
};

const establishedText = (current: string | undefined, incoming: string | undefined) =>
  current?.trim() ? current : incoming;

const mergeEstablishedImage = (existing: SourceImage, incoming: SourceImage): SourceImage => ({
  ...existing,
  ...incoming,
  id: existing.id,
  url: existing.url,
  localPath: incoming.localPath?.trim() ? incoming.localPath : existing.localPath,
  publicPath: incoming.publicPath?.trim() ? incoming.publicPath : existing.publicPath,
  // Localization/extraction may enrich presentation fields, but governance and
  // provenance stay with the already established source record. Missing
  // fields can be filled; populated fields require an explicit editorial edit.
  rights: existing.rights,
  attribution: establishedText(existing.attribution, incoming.attribution) || "来源待补充",
  sourceUrl: establishedText(existing.sourceUrl, incoming.sourceUrl) || "",
  evidenceNote: establishedText(existing.evidenceNote, incoming.evidenceNote),
  evidencePath: establishedText(existing.evidencePath, incoming.evidencePath),
  licenseId: establishedText(existing.licenseId, incoming.licenseId),
  licenseUrl: establishedText(existing.licenseUrl, incoming.licenseUrl),
  modificationNote: establishedText(existing.modificationNote, incoming.modificationNote),
  allowedPlatforms: existing.allowedPlatforms === undefined
    ? incoming.allowedPlatforms
    : [...existing.allowedPlatforms],
  expiresAt: establishedText(existing.expiresAt, incoming.expiresAt),
  fingerprint: establishedText(existing.fingerprint, incoming.fingerprint),
  entityTags: [...new Set([...(existing.entityTags ?? []), ...(incoming.entityTags ?? [])])],
});

/**
 * A localized copy replaces its remote-only record instead of appearing as a
 * duplicate. Older state may already contain both, so this also repairs that
 * shape whenever the visual desk touches a Story.
 */
export const mergeVisualImages = (current: SourceImage[], incoming: SourceImage[]) => {
  const merged = [...current];
  for (const image of incoming) {
    const existingIndex = merged.findIndex((entry) => sameImage(entry, image));
    if (existingIndex < 0) {
      merged.push(image);
      continue;
    }
    merged[existingIndex] = mergeEstablishedImage(merged[existingIndex]!, image);
  }
  return merged.slice(0, 30);
};

export const isLocalVisualAsset = (image: SourceImage) => isLocalImageFileReady(image);

/**
 * `check-required` and editorial screenshots remain useful local review
 * assets, but are intentionally not described as publication-ready.
 */
export const countVisualAssets = (
  images: SourceImage[],
  checkedAt = new Date().toISOString(),
): VisualAssetCounts => {
  const unique = mergeVisualImages([], images);
  const local = unique.filter(isLocalVisualAsset);
  const publishReady = local.filter((image) => isNeutralImagePublishReady(image, checkedAt));
  return {
    discoveredImageCount: unique.length,
    localReadyImageCount: local.length,
    publishReadyImageCount: publishReady.length,
    rightsReviewImageCount: local.length - publishReady.length,
  };
};

const resultFor = (
  story: VisualStorySnapshot | undefined,
  extractedSources: number,
  screenshotCount: number,
  onlineSearchCount: number,
  generatedCount: number,
): VisualHydrationResult => {
  const counts = countVisualAssets(story?.images ?? []);
  return {
    imageCount: counts.localReadyImageCount,
    ...counts,
    extractedSources,
    screenshotCount,
    onlineSearchCount,
    generatedCount,
  };
};

const canDownload = (image: SourceImage) => /^https?:\/\//iu.test(image.url.trim());

/**
 * Dependency-injected core keeps the network/storage boundary testable. A
 * Story is complete only after enough files exist locally; remote discovery
 * records never satisfy the minimum on their own.
 */
export const runVisualHydration = async (
  storyId: string,
  minimumImages: number,
  dependencies: VisualHydrationDependencies,
  options: { progress?: (value: number, stage: string) => void } = {},
): Promise<VisualHydrationResult> => {
  const minimum = Math.max(0, Math.min(8, Math.floor(minimumImages)));
  let story = await dependencies.getStory();
  if (!story) throw new Error("Story 不存在");
  let counts = countVisualAssets(story.images);
  if (counts.localReadyImageCount >= minimum) return resultFor(story, 0, 0, 0, 0);

  const signals = story.signals
    .filter((signal) => !signal.isCommunity)
    .sort((left, right) => roleRank(right.sourceRole) - roleRank(left.sourceRole))
    .slice(0, 3);
  const assetRoot = `story_assets_${storyId.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 70)}`;
  const primarySignal = signals[0];
  if (primarySignal) options.progress?.(0.08, "1/5 提取原新闻图片");

  // Prefer already-discovered article images before fetching the source page
  // again. Persisting replaces the matching remote record in its candidate.
  if (primarySignal) {
    for (const image of story.images) {
      if (counts.localReadyImageCount >= minimum) break;
      if (isLocalVisualAsset(image) || !canDownload(image)) continue;
      try {
        const localized = await dependencies.localize(image, assetRoot);
        if (!isLocalVisualAsset(localized)) continue;
        await dependencies.persistImages(primarySignal, [localized]);
        story = await dependencies.getStory();
        counts = countVisualAssets(story?.images ?? []);
      } catch {
        // Try another discovered image, another source, then screenshots.
      }
    }
  }

  let extractedSources = 0;
  for (const signal of signals) {
    if (counts.localReadyImageCount >= minimum) break;
    try {
      const page = await dependencies.extract(signal.url, 12);
      extractedSources += 1;
      await dependencies.persistExtraction(signal, page);
      for (const image of page.images) {
        story = await dependencies.getStory();
        counts = countVisualAssets(story?.images ?? []);
        if (counts.localReadyImageCount >= minimum) break;
        try {
          const localized = isLocalVisualAsset(image)
            ? image
            : canDownload(image)
              ? await dependencies.localize(image, assetRoot)
              : undefined;
          if (!localized || !isLocalVisualAsset(localized)) continue;
          await dependencies.persistImages(signal, [localized]);
        } catch {
          // One broken CDN asset must not prevent the remaining candidates or
          // the rendered-page fallback from being attempted.
        }
      }
    } catch {
      // Other sources and screenshot fallback still run. A single publisher's
      // client shell or bot protection must not empty the whole visual pack.
    }
    story = await dependencies.getStory();
    counts = countVisualAssets(story?.images ?? []);
  }

  let screenshotCount = 0;
  story = await dependencies.getStory();
  counts = countVisualAssets(story?.images ?? []);
  if (counts.localReadyImageCount < minimum && signals.length) {
    options.progress?.(0.32, "2/5 截取新闻页面");
    for (const signal of signals.slice(0, 2)) {
      const requested = Math.min(3, minimum - counts.localReadyImageCount);
      if (requested <= 0) break;
      try {
        const screenshots = (await dependencies.capture(signal.url, assetRoot, requested))
          .filter(isLocalVisualAsset);
        screenshotCount += screenshots.length;
        if (screenshots.length) await dependencies.persistImages(signal, screenshots);
      } catch {
        // No irrelevant generated image is substituted when rendering fails.
      }
      story = await dependencies.getStory();
      counts = countVisualAssets(story?.images ?? []);
      if (counts.localReadyImageCount >= minimum) break;
    }
  }

  let onlineSearchCount = 0;
  story = await dependencies.getStory();
  counts = countVisualAssets(story?.images ?? []);
  const persistOnlineTier = async (priority: 3 | 4) => {
    if (!story || !primarySignal || counts.localReadyImageCount >= minimum || !dependencies.searchOnline) return;
    const searchStory = story;
    options.progress?.(priority === 3 ? 0.52 : 0.72, priority === 3
      ? "3/5 搜索人物、公司与 Logo"
      : "4/5 搜索事件相关素材并核对授权");
    try {
      const searched = await dependencies.searchOnline(
        searchStory,
        minimum - counts.localReadyImageCount,
        priority,
      );
      for (const image of searched.filter((entry) => (entry.editorialPriority ?? priority) === priority)) {
        const localized = isLocalVisualAsset(image)
          ? image
          : canDownload(image)
            ? await dependencies.localize(image, assetRoot)
            : undefined;
        if (!localized || !isLocalVisualAsset(localized)) continue;
        const prepared = priority === 3 && dependencies.stylizeIdentity
          ? await dependencies.stylizeIdentity(localized, searchStory, assetRoot).catch(() => localized)
          : localized;
        if (!isLocalVisualAsset(prepared)) continue;
        await dependencies.persistImages(primarySignal, [prepared]);
        onlineSearchCount += 1;
        story = await dependencies.getStory();
        counts = countVisualAssets(story?.images ?? []);
        if (counts.localReadyImageCount >= minimum) break;
      }
    } catch {
      // A rights-auditable web lookup is optional. The next real tier still runs.
    }
  };
  await persistOnlineTier(3);
  await persistOnlineTier(4);

  let generatedCount = 0;
  story = await dependencies.getStory();
  counts = countVisualAssets(story?.images ?? []);
  if (story && primarySignal && counts.localReadyImageCount === 0 && dependencies.generateFallback) {
    options.progress?.(0.84, "5/5 生成兜底封面（非新闻现场）");
    try {
      const generated = (await dependencies.generateFallback(story, assetRoot)).filter(isLocalVisualAsset);
      if (generated.length) {
        await dependencies.persistImages(primarySignal, generated.slice(0, 1));
        generatedCount = 1;
      }
    } catch {
      // Generation is the last resort; a failure leaves the package honestly
      // image-less instead of substituting an unrelated visual.
    }
  }

  return resultFor(
    await dependencies.getStory(),
    extractedSources,
    screenshotCount,
    onlineSearchCount,
    generatedCount,
  );
};

const candidateForSignal = (state: Awaited<ReturnType<typeof readState>>, signal: StorySignalView) =>
  state.runs.find((run) => run.id === signal.runId)
    ?.candidates.find((candidate) => candidate.id === signal.candidateId);

const persistImagesForStory = async (
  storyId: string,
  fallbackSignal: StorySignalView,
  images: SourceImage[],
) => updateState((state) => {
  const currentStory = storyById(state, storyId);
  if (!currentStory) return;
  for (const image of images) {
    let matched = false;
    for (const signal of currentStory.signals) {
      const candidate = candidateForSignal(state, signal);
      if (!candidate || !candidate.images.some((entry) => sameImage(entry, image))) continue;
      candidate.images = mergeVisualImages(candidate.images, [image]);
      candidate.imageCount = candidate.images.length;
      matched = true;
    }
    if (matched) continue;
    const fallback = candidateForSignal(state, fallbackSignal);
    if (!fallback) continue;
    fallback.images = mergeVisualImages(fallback.images, [image]);
    fallback.imageCount = fallback.images.length;
  }
});

const productionDependencies = (storyId: string): VisualHydrationDependencies => ({
  getStory: async () => storyById(await readState(), storyId),
  extract: extractPage,
  persistExtraction: async (signal, page) => {
    await updateState((state) => {
      const candidate = candidateForSignal(state, signal);
      if (!candidate) return;
      candidate.canonicalUrl = page.canonicalUrl;
      candidate.images = mergeVisualImages(candidate.images, page.images);
      candidate.imageCount = candidate.images.length;
      if (!candidate.excerpt.trim() && page.text.trim()) candidate.excerpt = page.text.trim().slice(0, 600);
    });
  },
  persistImages: (signal, images) => persistImagesForStory(storyId, signal, images),
  localize: downloadSourceImage,
  capture: captureRenderedPageImages,
  searchOnline: (story, requestedLimit, priority) => searchLicensedEditorialImages(story, requestedLimit, { priority }),
  stylizeIdentity: (image, story, assetRoot) => createGroundedEditorialCover({
    source: image,
    storyTitle: story.title,
    assetDirectory: path.join(workflowMediaRoot, assetRoot),
    publicDirectory: `/media/${encodeURIComponent(assetRoot)}`,
  }),
  generateFallback: async (story, assetRoot) => [await createGeneratedEditorialFallback({
    storyId: story.id,
    storyTitle: story.title,
    sourceUrl: story.signals.find((signal) => !signal.isCommunity)?.url || story.signals[0]?.url || "",
    assetDirectory: path.join(workflowMediaRoot, assetRoot),
    publicDirectory: `/media/${encodeURIComponent(assetRoot)}`,
  })],
});

/**
 * Visual hydration is deliberately lazy: only a user-selected Story pays the
 * cost of reading image-heavy pages, downloading source images and rendering
 * screenshot fallbacks.
 */
export const hydrateStoryAssets = (
  storyId: string,
  minimumImages = 2,
  options: { progress?: (value: number, stage: string) => void } = {},
) => {
  const minimum = Math.max(0, Math.min(8, Math.floor(minimumImages)));
  const key = `${storyId}:${minimum}`;
  const existing = inFlight.get(key);
  if (existing) {
    if (options.progress) existing.listeners.add(options.progress);
    return existing.promise;
  }
  const listeners = new Set<NonNullable<typeof options.progress>>();
  if (options.progress) listeners.add(options.progress);
  const report = (value: number, stage: string) => {
    for (const listener of listeners) listener(value, stage);
  };
  const operation = runVisualHydration(storyId, minimum, productionDependencies(storyId), { progress: report })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, { promise: operation, listeners });
  return operation;
};
