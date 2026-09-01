export interface EditorialImageCandidate {
  id: string;
  url: string;
  caption: string;
  width?: number;
  height?: number;
  rights?: string;
  sourceUrl?: string;
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
  paragraphs: string[];
  imageLimit: number;
  imagePolicy?: "source" | "screenshot" | "none";
}

const imageNoise = /logo|icon|avatar|emoji|tracking|pixel|spinner|loading|sprite|favicon|author|profile|badge|button|shields\.io/i;
const badgeCaption = /^(?:license|python\s*\d+(?:\.\d+)*|node(?:\.js)?\s*\d+(?:\.\d+)*|next\.?js\s*\d+(?:\.\d+)*|build|coverage|version|npm|downloads?|stars?|forks?)\b/i;

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
  if (image.height && image.height < 180) return false;
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
  const seenSemantic = new Set<string>();
  for (const image of images) {
    if (!eligibleEditorialImage(image)) continue;
    const urlKey = normalizedVisualUrl(image.url);
    const existingIndex = urlIndex.get(urlKey);
    if (existingIndex !== undefined) {
      const existing = selected[existingIndex]!;
      if (imageResolutionScore(image) > imageResolutionScore(existing)) selected[existingIndex] = image;
      continue;
    }
    const semanticKey = semanticImageKey(image);
    if (semanticKey && seenSemantic.has(semanticKey)) continue;
    urlIndex.set(urlKey, selected.length);
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
    if (unavailable.has(index)) return;
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
  paragraphs,
  imageLimit,
  imagePolicy = "source",
}: EditorialImagePlanInput): EditorialImageSelection[] => {
  const limit = Math.max(0, Math.floor(imageLimit));
  if (imagePolicy === "none" || limit === 0 || paragraphs.length === 0) return [];

  const eligible = uniqueEligibleEditorialImages(availableImages);
  if (!eligible.length) return [];

  const nonGenerated = eligible.filter((image) => (image.editorialPriority ?? 1) < 5);
  const eligiblePool = nonGenerated.length ? nonGenerated : eligible;
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
  for (const image of selected) {
    const modelSelection = modelSelectionById.get(image.id);
    if (!modelSelection) continue;
    occupied.add(Math.max(0, Math.min(paragraphs.length - 1, modelSelection.afterParagraph)));
  }
  const fallbackSlots = evenlySpacedSlots(paragraphs.length, targetCount)
    .filter((index) => !occupied.has(index));
  const placements: EditorialImageSelection[] = [];
  selected.forEach((image) => {
    const modelSelection = modelSelectionById.get(image.id);
    if (modelSelection) {
      placements.push({
        imageId: image.id,
        afterParagraph: Math.max(0, Math.min(paragraphs.length - 1, modelSelection.afterParagraph)),
        caption: modelSelection.caption.trim() || image.caption,
      });
      return;
    }
    const semantic = semanticParagraph(image, paragraphs, occupied);
    const fallback = fallbackSlots.shift();
    const afterParagraph = semantic ?? fallback ?? Math.min(paragraphs.length - 1, placements.length);
    occupied.add(afterParagraph);
    placements.push({ imageId: image.id, afterParagraph, caption: image.caption });
  });

  return placements;
};
