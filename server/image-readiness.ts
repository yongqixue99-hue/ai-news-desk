import { statSync } from "node:fs";
import path from "node:path";
import {
  evaluateMaterialPublishEligibility,
  normalizeGovernedMaterial,
  type MaterialPublishEligibility,
} from "./material-governance.js";
import type { ImageMaterial, SourceImage } from "./types.js";

export const neutralPublicationPlatforms = ["wechat", "xiaoheihe"] as const;

export type ImageReadinessInput = SourceImage | ImageMaterial;

export interface LocalImageFileInspection {
  available: boolean;
  localPath?: string;
  publicPath?: string;
  size?: number;
  reason?: string;
}

const isNativeAbsolutePath = (value: string) => {
  if (process.platform === "win32") {
    return path.win32.isAbsolute(value) && (/^[a-z]:[\\/]/iu.test(value) || /^\\\\/u.test(value));
  }
  return path.posix.isAbsolute(value) && !/^[a-z]:[\\/]/iu.test(value) && !/^\\\\/u.test(value);
};

/**
 * Stored paths survive restores and operating-system migrations, so the
 * strings alone are never evidence that bytes still exist. This synchronous
 * stat is intentional: Story/Package views are synchronous and inspect only
 * their small, bounded image pools. Final publishers repeat their own async
 * checks immediately before reading bytes to close the remaining TOCTOU gap.
 */
export const inspectLocalImageFile = (
  image: Pick<ImageReadinessInput, "localPath" | "publicPath">,
): LocalImageFileInspection => {
  const localPath = image.localPath?.trim();
  const publicPath = image.publicPath?.trim();
  if (!localPath) return { available: false, publicPath, reason: "图片缺少本地文件路径。" };
  if (!publicPath || !publicPath.startsWith("/") || publicPath.startsWith("//")) {
    return { available: false, localPath, publicPath, reason: "图片缺少有效的工作台访问路径。" };
  }
  if (!isNativeAbsolutePath(localPath)) {
    return { available: false, localPath, publicPath, reason: "图片路径来自其他操作系统或不是绝对路径。" };
  }
  try {
    const file = statSync(localPath);
    if (!file.isFile()) return { available: false, localPath, publicPath, reason: "图片本地路径不是普通文件。" };
    if (!file.size) return { available: false, localPath, publicPath, reason: "图片本地文件为空。" };
    return { available: true, localPath, publicPath, size: file.size };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      localPath,
      publicPath,
      reason: code === "ENOENT" ? "图片本地文件已不存在。" : "无法读取图片本地文件。",
    };
  }
};

export const isLocalImageFileReady = (
  image: Pick<ImageReadinessInput, "localPath" | "publicPath">,
) => inspectLocalImageFile(image).available;

export interface ImagePublishReadiness {
  ready: boolean;
  localFile: LocalImageFileInspection;
  platforms: string[];
  decisions: MaterialPublishEligibility[];
  blockers: string[];
  warnings: string[];
}

const imageTitle = (image: ImageReadinessInput) => "title" in image ? image.title : image.caption;
const imageCreatedAt = (image: ImageReadinessInput, checkedAt: string) =>
  "createdAt" in image ? image.createdAt : checkedAt;
const imageFileName = (image: ImageReadinessInput) => "fileName" in image ? image.fileName : undefined;

export const evaluateImagePublishReadiness = (
  image: ImageReadinessInput,
  platforms: readonly string[] = neutralPublicationPlatforms,
  checkedAt = new Date().toISOString(),
): ImagePublishReadiness => {
  const localFile = inspectLocalImageFile(image);
  const requestedPlatforms = [...new Set(platforms.map((platform) => platform.trim().toLowerCase()).filter(Boolean))];
  const blockers = localFile.available ? [] : [localFile.reason || "图片本地文件不可用。"];
  const warnings: string[] = [];

  // Only owned or explicitly licensed files can be neutral automatic assets.
  // Official press photos and editorial screenshots remain reviewable but are
  // never silently promoted to publish-ready.
  if (!(["owned", "licensed"] as string[]).includes(image.rights)) {
    blockers.push("图片权利状态尚未达到自动发布要求。");
  }
  if (image.rights === "licensed") {
    if (!image.licenseId?.trim()) blockers.push("授权图片缺少机器可读的许可标识。");
    try {
      const licenseUrl = new URL(image.licenseUrl || "");
      if (!(["http:", "https:"] as string[]).includes(licenseUrl.protocol)) throw new Error("invalid protocol");
    } catch {
      blockers.push("授权图片缺少有效的许可条款 URL。");
    }
    if (!image.modificationNote?.trim()) blockers.push("授权图片缺少修改说明。");
  }

  const governed = normalizeGovernedMaterial({
    id: image.id,
    title: imageTitle(image),
    attribution: image.attribution,
    rights: image.rights,
    sourceUrl: image.sourceUrl,
    evidence: { note: image.evidenceNote, path: image.evidencePath },
    licenseId: image.licenseId,
    licenseUrl: image.licenseUrl,
    modificationNote: image.modificationNote,
    allowedPlatforms: image.allowedPlatforms ?? (image.rights === "owned" ? ["*"] : []),
    expiresAt: image.expiresAt,
    entityTags: image.entityTags,
    fingerprint: image.fingerprint ?? "",
    createdAt: imageCreatedAt(image, checkedAt),
    fileName: imageFileName(image),
    localPath: image.localPath,
    publicPath: image.publicPath,
  });
  const decisions = requestedPlatforms.map((platform) =>
    evaluateMaterialPublishEligibility(governed, platform, checkedAt));
  blockers.push(...decisions.flatMap((decision) => decision.blockers));
  warnings.push(...decisions.flatMap((decision) => decision.warnings));
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  return {
    ready: localFile.available
      && uniqueBlockers.length === 0
      && decisions.length > 0
      && decisions.every((decision) => decision.status === "allowed"),
    localFile,
    platforms: requestedPlatforms,
    decisions,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
  };
};

export const isNeutralImagePublishReady = (
  image: ImageReadinessInput,
  checkedAt = new Date().toISOString(),
) => evaluateImagePublishReadiness(image, neutralPublicationPlatforms, checkedAt).ready;
