export interface EditorialImageCandidate {
  id: string;
  url: string;
  caption: string;
  width?: number;
  height?: number;
  rights?: string;
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

const imageNoise = /logo|icon|avatar|emoji|tracking|pixel|spinner|loading|sprite|favicon|author|profile|badge|button/i;
const badgeCaption = /^(?:license|python\s*\d|node(?:\.js)?\s*\d|next\.?js\s*\d|build|coverage|version|npm|downloads?|stars?|forks?)\b/i;

export const eligibleEditorialImage = (image: EditorialImageCandidate) => {
  if (image.rights === "expired") return false;
  if (imageNoise.test(`${image.url} ${image.caption}`)) return false;
  if (badgeCaption.test(image.caption.trim())) return false;
  if (image.width && image.width < 320) return false;
  if (image.height && image.height < 180) return false;
  return true;
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

  const seenUrls = new Set<string>();
  const eligible = availableImages.filter((image) => {
    if (!eligibleEditorialImage(image) || seenUrls.has(image.url)) return false;
    seenUrls.add(image.url);
    return true;
  });
  if (!eligible.length) return [];

  const eligibleById = new Map(eligible.map((image) => [image.id, image]));
  const selectedIds = new Set<string>();
  const placements: EditorialImageSelection[] = [];
  for (const selection of modelSelections) {
    const image = eligibleById.get(selection.imageId);
    if (!image || selectedIds.has(image.id) || placements.length >= limit) continue;
    selectedIds.add(image.id);
    placements.push({
      imageId: image.id,
      afterParagraph: Math.max(0, Math.min(paragraphs.length - 1, selection.afterParagraph)),
      caption: selection.caption.trim() || image.caption,
    });
  }

  // One visual per meaningful reading beat, capped by the user's image limit.
  // Four paragraphs therefore receive up to three source visuals; a one-line
  // brief stays at one.
  const automaticTarget = Math.min(
    limit,
    eligible.length,
    Math.max(1, Math.ceil(paragraphs.length * 0.7)),
  );
  const targetCount = Math.min(limit, eligible.length, Math.max(automaticTarget, placements.length));
  const remaining = eligible.filter((image) => !selectedIds.has(image.id)).slice(0, targetCount - placements.length);
  const occupied = new Set(placements.map((placement) => placement.afterParagraph));
  const fallbackSlots = evenlySpacedSlots(paragraphs.length, targetCount)
    .filter((index) => !occupied.has(index));

  remaining.forEach((image) => {
    const semantic = semanticParagraph(image, paragraphs, occupied);
    const fallback = fallbackSlots.shift();
    const afterParagraph = semantic ?? fallback ?? Math.min(paragraphs.length - 1, placements.length);
    occupied.add(afterParagraph);
    placements.push({ imageId: image.id, afterParagraph, caption: image.caption });
  });

  return placements;
};
