export interface EditorialImageCandidate {
  id: string;
  url: string;
  caption: string;
  width?: number;
  height?: number;
  rights?: string;
  sourceUrl?: string;
  /** Frozen byte identity; identical files must never count as two visuals. */
  fingerprint?: string;
  /** 1 source image, 2 source screenshot, 3 entity, 4 related, 5 generated fallback. */
  editorialPriority?: 1 | 2 | 3 | 4 | 5;
}

export interface EditorialImageSelection {
  imageId: string;
  afterParagraph: number;
  caption: string;
}

interface EditorialImagePlanInput {
  availableImages: EditorialImageCandidate[];
  modelSelections: EditorialImageSelection[];
  imageAliases?: Record<string, string>;
  paragraphs: string[];
  imageLimit: number;
  imagePolicy?: "source" | "screenshot" | "none";
}

const imageNoise = /logo|icon|avatar|emoji|tracking|pixel|spinner|loading|sprite|favicon|author|profile|badge|button|shields\.io/i;
const badgeCaption = /^(?:license|python\s*\d+(?:\.\d+)*|node(?:\.js)?\s*\d+(?:\.\d+)*|next\.?js\s*\d+(?:\.\d+)*|build|coverage|version|npm|downloads?|stars?|forks?)\b/i;

/** Exact known placeholders only; even a short caption such as "batch=1" is evidence. */
export const isPlaceholderEditorialCaption = (caption: string) => !caption.trim()
  || /^(?:原文(?:图表|配图)\s*\d*|来源页面配图|来源图片|来源配图|配图|来源网页首屏截图|原文页面截图)$/u.test(caption.trim());

const modelVersions = (text: string) => {
  const versions = new Map<string, Set<string>>();
  const normalized = text.normalize("NFKC").toLocaleLowerCase().replace(/[‐‑‒–—−]/gu, "-");
  for (const match of normalized.matchAll(/\b(gpt|gemini|qwen|glm|llama|deepseek|claude)(?:[\s-]+(?:opus|sonnet|haiku|fable|mythos))?[\s-]*([rv]?\d+(?:\.\d+)*o?)(?![a-z0-9.])/gu)) {
    const family = match[1];
    const version = match[2].replace(/^v/u, "");
    const known = versions.get(family) ?? new Set<string>();
    known.add(version);
    versions.set(family, known);
  }
  return versions;
};

/** A mismatch is evidence of incompatibility; absent version labels are not proof of a match. */
export const hasEditorialImageVersionConflict = (caption: string, articleText: string) => {
  const imageVersions = modelVersions(caption);
  const articleVersions = modelVersions(articleText);
  return [...imageVersions].some(([family, versions]) => {
    const described = articleVersions.get(family);
    return described && ![...versions].some((version) => described.has(version));
  });
};

const normalizedVisualUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|spm|from)$/iu.test(key)) parsed.searchParams.delete(key);
    }
    if (/\/wp-content\/uploads\//iu.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(
        /-\d{2,5}x\d{2,5}(?=\.(?:avif|gif|jpe?g|png|webp)$)/iu,
        "",
      );
    }
    return parsed.toString().toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

const imageResolutionScore = (image: EditorialImageCandidate) => {
  const declared = (image.width ?? 0) * (image.height ?? 0);
  const pathSize = image.url.match(/-(\d{2,5})x(\d{2,5})(?=\.(?:avif|gif|jpe?g|png|webp)(?:$|[?#]))/iu);
  const responsive = pathSize ? Number(pathSize[1]) * Number(pathSize[2]) : 0;
  return Math.max(declared, responsive);
};

export const eligibleEditorialImage = (image: EditorialImageCandidate) => {
  if (image.rights === "expired") return false;
  if (imageNoise.test(`${image.url} ${image.caption}`)) return false;
  if (badgeCaption.test(image.caption.trim())) return false;
  if (image.width && image.width < 320) return false;
  if (image.height && image.height < 180 && !((image.width ?? 0) >= 640 && image.height >= 120
    && /chart|benchmark|comparison|图表|评测|对比/iu.test(image.caption))) return false;
  return true;
};

const semanticImageKey = (image: EditorialImageCandidate) => {
  const caption = image.caption.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
  if (caption.length < 16 || /^原文(?:配图|图表)\s*\d*$/u.test(caption)) return "";
  let source = image.sourceUrl || "";
  try {
    source = new URL(source).hostname.replace(/^www\./u, "");
  } catch {
    // Keep the supplied source identity when it is not an HTTP URL.
  }
  return `${source}|${caption}`;
};

export const uniqueEligibleEditorialImages = <T extends EditorialImageCandidate>(images: T[]) => {
  const selected: T[] = [];
  const urlIndex = new Map<string, number>();
  const fingerprintIndex = new Map<string, number>();
  const seenSemantic = new Set<string>();
  for (const image of images) {
    if (!eligibleEditorialImage(image)) continue;
    const fingerprintKey = /^[a-f0-9]{64}$/iu.test(image.fingerprint?.trim() ?? "")
      ? image.fingerprint!.trim().toLocaleLowerCase()
      : "";
    if (fingerprintKey && fingerprintIndex.has(fingerprintKey)) continue;
    const urlKey = normalizedVisualUrl(image.url);
    const existingIndex = urlIndex.get(urlKey);
    if (existingIndex !== undefined) {
      const existing = selected[existingIndex]!;
      if (imageResolutionScore(image) > imageResolutionScore(existing)) {
        const existingFingerprint = existing.fingerprint?.trim().toLocaleLowerCase() ?? "";
        if (fingerprintIndex.get(existingFingerprint) === existingIndex) fingerprintIndex.delete(existingFingerprint);
        selected[existingIndex] = image;
        if (fingerprintKey) fingerprintIndex.set(fingerprintKey, existingIndex);
      }
      continue;
    }
    const semanticKey = semanticImageKey(image);
    if (semanticKey && seenSemantic.has(semanticKey)) continue;
    urlIndex.set(urlKey, selected.length);
    if (fingerprintKey) fingerprintIndex.set(fingerprintKey, selected.length);
    if (semanticKey) seenSemantic.add(semanticKey);
    selected.push(image);
  }
  return selected;
};

const comparisonTokens = (value: string) => {
  const normalized = value.toLocaleLowerCase();
  const tokens = normalized.match(/[a-z0-9][a-z0-9.+_-]{2,}|[\u3400-\u9fff]{2,}/g) ?? [];
  const expanded = tokens.flatMap((token) => {
    if (!/[\u3400-\u9fff]/u.test(token) || token.length <= 2) return [token];
    return [token, ...Array.from({ length: token.length - 1 }, (_unused, index) => token.slice(index, index + 2))];
  });
  return [...new Set(expanded.filter((token) => token.length >= 2))];
};

const semanticParagraph = (
  image: EditorialImageCandidate,
  paragraphs: string[],
  unavailable: Set<number>,
) => {
  const tokens = comparisonTokens(image.caption);
  if (!tokens.length || /^原文(?:配图|图表)\s*\d*$/u.test(image.caption.trim())) return undefined;
  let best: { index: number; score: number } | undefined;
  paragraphs.forEach((paragraph, index) => {
    if (unavailable.has(index) || hasEditorialImageVersionConflict(image.caption, paragraph)) return;
    const normalized = paragraph.toLocaleLowerCase();
    const score = tokens.reduce((total, token) => total + (normalized.includes(token) ? Math.min(6, token.length) : 0), 0);
    if (score > 0 && (!best || score > best.score)) best = { index, score };
  });
  return best?.index;
};

const evenlySpacedSlots = (paragraphCount: number, count: number) => {
  if (count <= 0 || paragraphCount <= 0) return [];
  if (count === 1) return [Math.min(paragraphCount - 1, Math.floor(paragraphCount / 2))];
  return Array.from({ length: count }, (_unused, index) =>
    Math.round((index * (paragraphCount - 1)) / (count - 1)));
};

/**
 * Treats model image selections as editorial ranking hints, not as permission
 * to erase every useful source visual. The deterministic fallback is the
 * final guardrail between a chart-rich source and a text-only draft.
 */
export const planEditorialImagePlacements = ({
  availableImages,
  modelSelections,
  imageAliases = {},
  paragraphs,
  imageLimit,
  imagePolicy = "source",
}: EditorialImagePlanInput): EditorialImageSelection[] => {
  const limit = Math.max(0, Math.floor(imageLimit));
  if (imagePolicy === "none" || limit === 0 || paragraphs.length === 0) return [];

  const articleText = paragraphs.join("\n");
  const eligible = uniqueEligibleEditorialImages(availableImages)
    .filter((image) => !hasEditorialImageVersionConflict(image.caption, articleText));
  if (!eligible.length) return [];

  // The frozen package exposes both an asset ID and its source-image ID.
  // Accept either explicit identity before deciding a model made no valid choice.
  modelSelections = modelSelections.map((selection) => ({ ...selection,
    imageId: eligible.some((image) => image.id === selection.imageId) ? selection.imageId
      : imageAliases[selection.imageId] ?? selection.imageId,
  }));

  const nonGenerated = eligible.filter((image) => (image.editorialPriority ?? 1) < 5);
  const safePool = nonGenerated.length ? nonGenerated : eligible;
  const explicitSourceSelections = modelSelections.length > 0 && modelSelections.every((selection) =>
    safePool.some((image) => image.id === selection.imageId && (image.editorialPriority ?? 1) <= 2));
  // Original images and faithful source-chart screenshots are both factual
  // visuals. Respect an explicit choice between them; an unrelated photo must
  // not be inserted merely to fill the image limit. Others stay in the library.
  const eligiblePool = explicitSourceSelections
    ? safePool.filter((image) => modelSelections.some((selection) => selection.imageId === image.id))
    : safePool;
  const modelRank = new Map(modelSelections.map((selection, index) => [selection.imageId, index]));
  const originalRank = new Map(eligiblePool.map((image, index) => [image.id, index]));
  const prioritized = [...eligiblePool].sort((left, right) =>
    (left.editorialPriority ?? 1) - (right.editorialPriority ?? 1)
    || (modelRank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (modelRank.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    || (originalRank.get(left.id) ?? 0) - (originalRank.get(right.id) ?? 0));
  const modelSelectionById = new Map(modelSelections.map((selection) => [selection.imageId, selection]));
  const modelRequestedCount = new Set(modelSelections
    .map((selection) => selection.imageId)
    .filter((imageId) => eligiblePool.some((image) => image.id === imageId))).size;

  // One visual per meaningful reading beat, capped by the user's image limit.
  // Four paragraphs therefore receive up to three source visuals; a one-line
  // brief stays at one.
  const automaticTarget = Math.min(
    limit,
    eligiblePool.length,
    Math.max(1, Math.ceil(paragraphs.length * 0.7)),
  );
  const targetCount = Math.min(limit, eligiblePool.length, Math.max(automaticTarget, modelRequestedCount));
  const selected = prioritized.slice(0, targetCount);
  const occupied = new Set<number>();
  const requestedPositions = new Map<string, number>();
  for (const image of selected) {
    const modelSelection = modelSelectionById.get(image.id);
    if (!modelSelection || !Number.isFinite(modelSelection.afterParagraph)) continue;
    const index = Math.max(0, Math.min(paragraphs.length - 1, Math.floor(modelSelection.afterParagraph)));
    if (hasEditorialImageVersionConflict(image.caption, paragraphs[index])) continue;
    requestedPositions.set(image.id, index);
    occupied.add(index);
  }
  const fallbackSlots = evenlySpacedSlots(paragraphs.length, targetCount)
    .filter((index) => !occupied.has(index));
  const placements: EditorialImageSelection[] = [];
  selected.forEach((image) => {
    // Placement hints do not authorize rewriting frozen source captions, test
    // conditions, or inventing conclusions from unread chart text. Caption
    // translation needs a separate evidence-checked operation.
    const caption = image.caption.trim() || "来源图片";
    const requestedPosition = requestedPositions.get(image.id);
    if (requestedPosition !== undefined) {
      placements.push({
        imageId: image.id,
        afterParagraph: requestedPosition,
        caption,
      });
      return;
    }
    const semantic = semanticParagraph(image, paragraphs, occupied);
    const fallbackIndex = fallbackSlots.findIndex((index) => !occupied.has(index)
      && !hasEditorialImageVersionConflict(image.caption, paragraphs[index]));
    const fallback = fallbackIndex >= 0 ? fallbackSlots.splice(fallbackIndex, 1)[0] : undefined;
    const available = paragraphs.findIndex((paragraph, index) => !occupied.has(index)
      && !hasEditorialImageVersionConflict(image.caption, paragraph));
    const compatible = paragraphs.findIndex((paragraph) => !hasEditorialImageVersionConflict(image.caption, paragraph));
    const afterParagraph = semantic ?? fallback ?? (available >= 0 ? available : compatible);
    if (afterParagraph < 0) return;
    occupied.add(afterParagraph);
    placements.push({ imageId: image.id, afterParagraph, caption });
  });

  return placements;
};
