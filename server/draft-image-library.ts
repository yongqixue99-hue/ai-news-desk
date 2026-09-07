import { randomUUID } from "node:crypto";
import { uniqueEligibleEditorialImages } from "./editorial-image-policy.js";
import type { DraftImagePlacement, SourceImage } from "./types.js";

/** Fill missing body slots, then preserve alternates for the editor's image library. */
export const completeDraftImageLibrary = async (input: {
  sources: SourceImage[];
  placements: DraftImagePlacement[];
  imageLimit: number;
  plannedCount: number;
  paragraphCount: number;
  frozenPackage: boolean;
  copy: (image: SourceImage) => Promise<SourceImage>;
  onCopyError: (image: SourceImage, error: unknown) => Promise<void>;
}) => {
  const placements = [...input.placements];
  const libraryLimit = input.frozenPackage ? 48 : input.imageLimit;
  for (const sourceImage of uniqueEligibleEditorialImages(input.sources)) {
    if (placements.length >= libraryLimit) break;
    if (placements.some((entry) => entry.image.url === sourceImage.url && entry.image.sourceUrl === sourceImage.sourceUrl)) continue;
    try {
      const image = await input.copy(sourceImage);
      if (image.fingerprint && placements.some((entry) => entry.image.fingerprint === image.fingerprint)) continue;
      placements.push({ id: `placement_${randomUUID().slice(0, 8)}`, image,
        afterParagraph: placements.length < input.plannedCount ? Math.min(input.paragraphCount - 1, placements.length) : -1,
        caption: sourceImage.caption,
      });
    } catch (error) {
      if (input.frozenPackage) throw new Error(`素材包图片 ${sourceImage.id} 无法按冻结快照复制：${error instanceof Error ? error.message : String(error)}`);
      await input.onCopyError(sourceImage, error);
    }
  }
  return placements;
};
