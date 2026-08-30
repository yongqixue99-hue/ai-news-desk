import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import {
  fingerprintSha256,
  normalizeGovernedMaterial,
  preparePublishedMaterialCandidate,
  type GovernedMaterial,
  type PublishedMaterialCandidate,
} from "./material-governance.js";
import { currentPublicationConfirmation, publicationRevisionHash } from "./publication-state.js";
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
  return isPathInsideManagedRoot(workflowMediaRoot, localPath);
};

/** Filesystem containment using the target platform's path semantics. Windows
 * paths are case-insensitive, while sibling prefixes, root itself, traversal,
 * and another drive remain outside. */
export const isPathInsideManagedRoot = (
  root: string,
  target: string,
  platform: NodeJS.Platform = process.platform,
) => {
  const windows = platform === "win32";
  const pathApi = windows ? path.win32 : path.posix;
  const caseFold = (value: string) => windows ? value.toLocaleLowerCase("en-US") : value;
  const resolvedRoot = caseFold(pathApi.resolve(root));
  const resolvedTarget = caseFold(pathApi.resolve(target));
  const relative = pathApi.relative(resolvedRoot, resolvedTarget);
  return Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${pathApi.sep}`)
    && !pathApi.isAbsolute(relative);
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
    if (!isPathInsideManagedRoot(resolvedRoot, resolvedFile)) {
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
  const versionedConfirmation = draft.publicationConfirmations
    ? currentPublicationConfirmation(draft, "xiaoheihe")
    : undefined;
  const publicationConfirmedAt = draft.publicationConfirmations
    ? versionedConfirmation?.confirmedAt
    : draft.publicationConfirmedAt;
  const publicationReceiptId = draft.publicationConfirmations
    ? versionedConfirmation?.receiptId
    : draft.publicationReceiptId;
  const checkedAt = input.checkedAt || new Date().toISOString();
  const blockers: string[] = [];

  if (!publicationConfirmedAt) {
    blockers.push("请先在小黑盒完成发布，并点击“我已发布”确认。");
  }
  if (!publicationReceiptId || publicationReceiptId !== receipt?.attemptId) {
    blockers.push("发布确认没有绑定到本次填入回执，不能证明这张图属于已发布版本。");
  }
  if (!receipt || receipt.outcome !== "filled") {
    blockers.push("缺少成功且完整的填入回执，无法证明本次发布内容。");
  }
  if (receipt && !receipt.revisionHash) {
    blockers.push("旧填入回执没有绑定已审核的图片版本，请重新填入小黑盒编辑器。");
  } else if (receipt && receipt.revisionHash !== publicationRevisionHash(draft, "xiaoheihe")) {
    blockers.push("填入回执与当前草稿图片版本不一致，请重新填入小黑盒编辑器。");
  }
  if (receipt && !Array.isArray(receipt.usedImageIds)) {
    blockers.push("旧回执没有逐图使用记录；为安全起见不能将这张图片存入素材库。");
  }
  if (!input.localFileAvailable || !placement.image.localPath?.trim()) {
    blockers.push("图片本地文件不存在，无法安全复制到素材库。");
  }

  const reviewedFingerprint = placement.image.fingerprint?.trim().toLowerCase() || "";
  const fingerprint = input.fingerprint?.trim().toLowerCase() || "";
  if (!/^[a-f0-9]{64}$/u.test(reviewedFingerprint)) {
    blockers.push("草稿图片缺少已审核的 SHA-256 指纹，请重新插入图片后再发布。");
  }
  if (!/^[a-f0-9]{64}$/u.test(fingerprint)) {
    blockers.push("无法核验当前本地图片的 SHA-256 指纹，不能作为已发布图片存入素材库。");
  } else if (reviewedFingerprint && fingerprint !== reviewedFingerprint) {
    blockers.push("本地图片文件已发生变化，与已发布版本的指纹不一致，不能存入素材库。");
  }
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
    licenseId: placement.image.licenseId,
    licenseUrl: placement.image.licenseUrl,
    modificationNote: placement.image.modificationNote,
    allowedPlatforms: placement.image.allowedPlatforms ?? [],
    expiresAt: placement.image.expiresAt,
    entityTags: placement.image.entityTags ?? [],
    fingerprint,
    createdAt: publicationConfirmedAt || checkedAt,
    localPath: input.localFileAvailable ? placement.image.localPath : undefined,
    publicPath: placement.image.publicPath,
  });
  const decision = preparePublishedMaterialCandidate({
    image: governed,
    publication: {
      status: publicationConfirmedAt && receipt?.outcome === "filled" ? "success" : "failed",
      platform: "xiaoheihe",
      receiptId: receipt?.attemptId || "missing-receipt",
      publishedAt: publicationConfirmedAt || checkedAt,
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
