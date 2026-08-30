import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  fingerprintSha256,
  normalizeGovernedMaterial,
  preparePublishedMaterialCandidate,
  type GovernedMaterial,
  type PublishedMaterialCandidate,
} from "./material-governance.js";
import { workflowMediaRoot } from "./storage.js";
import type { ArticleDraft, DraftImagePlacement, ImageMaterial } from "./types.js";

const maxPromotedImageBytes = 10 * 1024 * 1024;
const supportedImageTypes: Record<string, string> = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

/**
 * Draft state is user-editable, so a stored localPath must never be trusted as
 * an arbitrary filesystem read target. This lexical check is followed by a
 * realpath containment check in inspectDraftImageFile to reject symlinks too.
 */
export const isManagedDraftImagePath = (localPath: string | undefined) => {
  if (!localPath?.trim()) return false;
  const root = path.resolve(workflowMediaRoot);
  const target = path.resolve(localPath);
  return target !== root && target.startsWith(`${root}${path.sep}`);
};

export interface InspectedDraftImageFile {
  available: boolean;
  fingerprint?: string;
  contentType?: string;
  bytes?: Buffer;
  reason?: string;
}

export const inspectDraftImageFile = async (
  placement: DraftImagePlacement,
  includeBytes = false,
): Promise<InspectedDraftImageFile> => {
  const localPath = placement.image.localPath;
  if (!isManagedDraftImagePath(localPath)) {
    return { available: false, reason: "图片不在工作台受管目录中，拒绝读取。" };
  }
  try {
    const [resolvedRoot, resolvedFile] = await Promise.all([
      realpath(workflowMediaRoot),
      realpath(localPath!),
    ]);
    if (resolvedFile === resolvedRoot || !resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
      return { available: false, reason: "图片路径越过工作台受管目录，拒绝读取。" };
    }
    const contentType = supportedImageTypes[path.extname(resolvedFile).toLowerCase()];
    if (!contentType) {
      return { available: false, reason: "只支持 JPG、PNG、WebP 或 GIF 图片。" };
    }
    const file = await stat(resolvedFile);
    if (!file.isFile()) return { available: false, reason: "图片本地路径不是文件。" };
    if (!file.size) return { available: false, reason: "图片本地文件为空。" };
    if (file.size > maxPromotedImageBytes) {
      return { available: false, reason: "图片超过 10 MB，不能存入素材库。" };
    }
    const bytes = await readFile(resolvedFile);
    return {
      available: true,
      contentType,
      fingerprint: fingerprintSha256(bytes),
      bytes: includeBytes ? bytes : undefined,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      available: false,
      reason: code === "ENOENT" ? "图片本地文件已不存在。" : "无法读取图片本地文件。",
    };
  }
};

export interface PublishedImagePromotionStatus {
  placementId: string;
  imageId: string;
  title: string;
  thumbnailUrl: string;
  status: "ready" | "blocked" | "duplicate" | "saved";
  canSave: boolean;
  blockers: string[];
  warnings: string[];
  duplicateOf?: string;
  candidate?: PublishedMaterialCandidate;
  materialId?: string;
}

export type PublishedImagePromotionPublicStatus = Omit<PublishedImagePromotionStatus, "candidate">;

export const publicPublishedImagePromotionStatus = (
  status: PublishedImagePromotionStatus,
): PublishedImagePromotionPublicStatus => {
  const { candidate: _privateCandidate, ...publicStatus } = status;
  return publicStatus;
};

export interface PublishedImagePromotionInput {
  draft: ArticleDraft;
  placement: DraftImagePlacement;
  existingMaterials: readonly ImageMaterial[];
  fingerprint?: string;
  localFileAvailable: boolean;
  checkedAt?: string;
}

const governedExistingMaterial = (material: ImageMaterial): GovernedMaterial =>
  normalizeGovernedMaterial({
    ...material,
    evidence: { note: material.evidenceNote, path: material.evidencePath },
  });

export const evaluatePublishedImagePromotion = (
  input: PublishedImagePromotionInput,
): PublishedImagePromotionStatus => {
  const { draft, placement } = input;
  const receipt = draft.publisherReceipt;
  const checkedAt = input.checkedAt || new Date().toISOString();
  const blockers: string[] = [];

  if (!draft.publicationConfirmedAt) {
    blockers.push("请先在小黑盒完成发布，并点击“我已发布”确认。");
  }
  if (!draft.publicationReceiptId || draft.publicationReceiptId !== receipt?.attemptId) {
    blockers.push("发布确认没有绑定到本次填入回执，不能证明这张图属于已发布版本。");
  }
  if (!receipt || receipt.outcome !== "filled") {
    blockers.push("缺少成功且完整的填入回执，无法证明本次发布内容。");
  }
  if (receipt && !Array.isArray(receipt.usedImageIds)) {
    blockers.push("旧回执没有逐图使用记录；为安全起见不能将这张图片存入素材库。");
  }
  if (!input.localFileAvailable || !placement.image.localPath?.trim()) {
    blockers.push("图片本地文件不存在，无法安全复制到素材库。");
  }

  const fingerprint = input.fingerprint?.trim() || placement.image.fingerprint?.trim() || "";
  const governed = normalizeGovernedMaterial({
    id: placement.id,
    title: placement.caption || placement.image.caption,
    attribution: placement.image.attribution,
    rights: placement.image.rights,
    sourceUrl: placement.image.sourceUrl,
    evidence: {
      note: placement.image.evidenceNote,
      path: placement.image.evidencePath,
    },
    allowedPlatforms: placement.image.allowedPlatforms ?? [],
    expiresAt: placement.image.expiresAt,
    entityTags: placement.image.entityTags ?? [],
    fingerprint,
    createdAt: draft.publicationConfirmedAt || checkedAt,
    localPath: input.localFileAvailable ? placement.image.localPath : undefined,
    publicPath: placement.image.publicPath,
  });
  const decision = preparePublishedMaterialCandidate({
    image: governed,
    publication: {
      status: draft.publicationConfirmedAt && receipt?.outcome === "filled" ? "success" : "failed",
      platform: "xiaoheihe",
      receiptId: receipt?.attemptId || "missing-receipt",
      publishedAt: draft.publicationConfirmedAt || checkedAt,
      usedImageIds: receipt?.usedImageIds ?? [],
      publishedUrl: receipt?.pageUrl,
    },
    existingMaterials: input.existingMaterials.map(governedExistingMaterial),
    targetMaterialId: `material_${placement.image.id}`,
  });
  blockers.push(...decision.blockers);
  const uniqueBlockers = [...new Set(blockers)];
  const base = {
    placementId: placement.id,
    imageId: placement.image.id,
    title: placement.caption || placement.image.caption,
    thumbnailUrl: placement.image.publicPath || placement.image.url,
    blockers: uniqueBlockers,
    warnings: decision.warnings,
  };
  if (uniqueBlockers.length) {
    return { ...base, status: "blocked", canSave: false };
  }
  if (decision.status === "duplicate") {
    return {
      ...base,
      status: "duplicate",
      canSave: false,
      duplicateOf: decision.duplicateOf,
    };
  }
  if (!decision.candidate) {
    return {
      ...base,
      status: "blocked",
      canSave: false,
      blockers: ["素材治理检查没有生成可入库记录。"],
    };
  }
  return {
    ...base,
    status: "ready",
    canSave: true,
    candidate: decision.candidate,
  };
};
