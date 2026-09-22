import type { SourceImage } from "./types.js";

/** A deliberate upload is the user's delivery choice, not a claim of ownership. */
export const userProvidedImage = (image: SourceImage): SourceImage => ({
  ...image,
  rights: "user-provided",
  allowedPlatforms: ["*"],
  evidenceNote: image.evidenceNote || "用户主动提供并选用此图片，用于草稿交付。",
});

/** Repair only the old upload default. Explicit restrictions remain authoritative. */
export const normalizeLegacyUserUpload = (image: SourceImage): SourceImage => {
  if (image.sourceUrl !== "local-upload" || !image.id.startsWith("upload_")
    || image.rights !== "check-required" || image.allowedPlatforms !== undefined
    || image.evidenceNote || image.evidencePath || image.expiresAt
    || image.licenseId || image.licenseUrl) return image;
  return userProvidedImage(image);
};
