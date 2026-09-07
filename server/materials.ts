import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { findDuplicateMaterial, fingerprintSha256 } from "./material-governance.js";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";
import { workflowMaterialsRoot, workflowMediaRoot } from "./storage.js";
import type { DraftImagePlacement, ImageMaterial, SourceImage } from "./types.js";

const supportedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const safeText = (value: string | undefined, fallback: string, limit = 240) => {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) || fallback;
  } catch {
    return fallback;
  }
};

const extensionFor = (contentType: string, url = "") => {
  const direct = supportedTypes.get(contentType.split(";")[0]);
  if (direct) return direct;
  try {
    const extension = path.extname(new URL(url).pathname).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)) {
      return extension === ".jpeg" ? ".jpg" : extension;
    }
  } catch {
    // The caller gets the clearer content-type error below.
  }
  throw new Error("只支持 JPG、PNG、WebP 或 GIF 图片");
};

export interface MaterialInput {
  title?: string;
  attribution?: string;
  sourceUrl?: string;
  tags?: string[];
  rights?: ImageMaterial["rights"];
  evidenceNote?: string;
  evidencePath?: string;
  licenseId?: string;
  licenseUrl?: string;
  modificationNote?: string;
  allowedPlatforms?: string[];
  expiresAt?: string;
  entityTags?: string[];
}

const uniqueText = (items: string[] | undefined, normalizer = (value: string) => value.toLowerCase()) => {
  const seen = new Set<string>();
  return (items ?? []).flatMap((item) => {
    const value = item.trim();
    const key = normalizer(value);
    if (!value || !key || seen.has(key)) return [];
    seen.add(key);
    return [value];
  });
};

export const normalizeMaterialInput = (input: MaterialInput, fallbackTitle: string) => ({
  title: safeText(input.title, fallbackTitle, 120),
  attribution: safeText(input.attribution, "来源待补充", 160),
  sourceUrl: input.sourceUrl?.trim().slice(0, 1_000) || undefined,
  tags: uniqueText(input.tags).slice(0, 12),
  rights: (["owned", "licensed", "official", "editorial-screenshot", "check-required", "expired"] as const).includes(input.rights as never)
    ? input.rights!
    : "check-required" as const,
  evidenceNote: safeText(input.evidenceNote, "", 500) || undefined,
  evidencePath: input.evidencePath?.trim().slice(0, 1_000) || undefined,
  licenseId: safeText(input.licenseId, "", 80) || undefined,
  licenseUrl: input.licenseUrl?.trim().slice(0, 1_000) || undefined,
  modificationNote: safeText(input.modificationNote, "", 500) || undefined,
  allowedPlatforms: uniqueText(input.allowedPlatforms).map((item) => item.toLowerCase()).slice(0, 20),
  expiresAt: input.expiresAt?.trim() || undefined,
  entityTags: uniqueText(input.entityTags ?? input.tags).slice(0, 24),
});

export class DuplicateMaterialError extends Error {
  readonly code = "MATERIAL_DUPLICATE";
  readonly statusCode = 409;

  constructor(
    readonly duplicateId: string,
    readonly duplicateTitle: string,
  ) {
    super(`这张图片已存在于素材库：“${duplicateTitle}”。不会重复保存。`);
    this.name = "DuplicateMaterialError";
  }
}

export const assertUniqueMaterialFingerprint = (
  fingerprint: string,
  materials: readonly Pick<ImageMaterial, "id" | "title" | "fingerprint">[],
) => {
  const duplicate = findDuplicateMaterial(fingerprint, materials);
  if (!duplicate) return;
  const record = materials.find((material) => material.id === duplicate.id)!;
  throw new DuplicateMaterialError(record.id, record.title);
};

export const saveMaterialBytes = async (
  bytes: Buffer,
  contentType: string,
  input: MaterialInput,
  fallbackTitle: string,
  originalUrl = "",
  existingMaterials: readonly ImageMaterial[] = [],
  materialId?: string,
): Promise<ImageMaterial> => {
  if (!bytes.length) throw new Error("上传的图片为空");
  if (bytes.length > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB");
  const fingerprint = fingerprintSha256(bytes);
  assertUniqueMaterialFingerprint(fingerprint, existingMaterials);
  const extension = extensionFor(contentType, originalUrl);
  const id = materialId?.trim() || `material_${randomUUID().slice(0, 10)}`;
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/iu.test(id)) {
    throw new Error("素材存储 ID 只能包含字母、数字、下划线或连字符");
  }
  const fileName = `${id}${extension}`;
  const localPath = path.join(workflowMaterialsRoot, fileName);
  await mkdir(workflowMaterialsRoot, { recursive: true });
  await writeFile(localPath, bytes);
  const normalized = normalizeMaterialInput(input, fallbackTitle);
  return {
    id,
    fileName,
    localPath,
    publicPath: `/materials/${encodeURIComponent(fileName)}`,
    createdAt: new Date().toISOString(),
    fingerprint,
    ...normalized,
  };
};

export const saveUploadedMaterial = async (
  bytes: Buffer,
  contentType: string,
  input: MaterialInput,
  fileNameHeader?: string,
  existingMaterials: readonly ImageMaterial[] = [],
) => saveMaterialBytes(
  bytes,
  contentType,
  input,
  safeText(fileNameHeader, "图片素材").replace(/\.[^.]+$/, ""),
  "",
  existingMaterials,
);

export const importMaterialFromUrl = async (
  rawUrl: string,
  input: MaterialInput,
  existingMaterials: readonly ImageMaterial[] = [],
) => {
  const response = await fetchRemote(rawUrl, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AI-News-Desk/0.1",
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
    },
  });
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error("这个地址没有返回图片文件");
  const bytes = await readResponseBuffer(response, 10 * 1024 * 1024);
  return saveMaterialBytes(
    bytes,
    contentType,
    { ...input, sourceUrl: input.sourceUrl || rawUrl },
    "网络图片",
    response.url || rawUrl,
    existingMaterials,
  );
};

export const sourceImageFromMaterial = (
  material: ImageMaterial,
  target: { id: string; localPath: string; publicPath: string },
): SourceImage => ({
  id: target.id,
  url: target.publicPath,
  localPath: target.localPath,
  publicPath: target.publicPath,
  caption: material.title,
  attribution: material.attribution,
  sourceUrl: material.sourceUrl || "material-library",
  selected: true,
  rights: material.rights,
  evidenceNote: material.evidenceNote,
  evidencePath: material.evidencePath,
  licenseId: material.licenseId,
  licenseUrl: material.licenseUrl,
  modificationNote: material.modificationNote,
  allowedPlatforms: [...material.allowedPlatforms],
  expiresAt: material.expiresAt,
  entityTags: [...material.entityTags],
  fingerprint: material.fingerprint,
});

export const copyMaterialToDraft = async (material: ImageMaterial, draftId: string): Promise<DraftImagePlacement> => {
  const directory = path.join(workflowMediaRoot, draftId);
  await mkdir(directory, { recursive: true });
  const fileName = `${material.id}_${randomUUID().slice(0, 6)}${path.extname(material.fileName)}`;
  const localPath = path.join(directory, fileName);
  await copyFile(material.localPath, localPath);
  const publicPath = `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`;
  const image = sourceImageFromMaterial(material, {
    id: `${material.id}_${randomUUID().slice(0, 6)}`,
    localPath,
    publicPath,
  });
  return {
    id: `placement_${randomUUID().slice(0, 8)}`,
    image,
    afterParagraph: -1,
    caption: material.title,
  };
};

/**
 * Freezes a reusable or hydrated local image into the draft's own media
 * directory. Deleting the library entry later must not break an existing
 * article or change the revision that was reviewed for publication.
 */
export const copyLocalSourceImageToDraft = async (
  image: SourceImage,
  draftId: string,
  options: { requireFingerprintMatch?: boolean; mediaRoot?: string } = {},
): Promise<SourceImage> => {
  if (!image.localPath?.trim()) throw new Error("图片没有可复制的本地文件");
  const bytes = await readFile(image.localPath);
  const actualFingerprint = createHash("sha256").update(bytes).digest("hex");
  if (options.requireFingerprintMatch) {
    const expectedFingerprint = image.fingerprint?.trim().toLowerCase() || "";
    if (!/^[a-f0-9]{64}$/u.test(expectedFingerprint)) throw new Error("图片缺少有效 SHA-256 指纹");
    if (actualFingerprint !== expectedFingerprint) throw new Error("图片指纹不一致，内容已变化");
  }
  const directory = path.join(options.mediaRoot ?? workflowMediaRoot, draftId);
  await mkdir(directory, { recursive: true });
  const extension = path.extname(image.localPath).toLowerCase();
  const safeExtension = [".jpg", ".jpeg", ".png", ".webp", ".gif"].includes(extension)
    ? (extension === ".jpeg" ? ".jpg" : extension)
    : ".jpg";
  const safeId = image.id.replace(/[^a-zA-Z0-9_-]/gu, "_").slice(0, 80) || "image";
  const fileName = `${safeId}_${randomUUID().slice(0, 6)}${safeExtension}`;
  const localPath = path.join(directory, fileName);
  await writeFile(localPath, bytes);
  const publicPath = `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`;
  return { ...image, originalImageUrl: image.originalImageUrl || (/^https?:\/\//iu.test(image.url) ? image.url : undefined),
    url: publicPath, localPath, publicPath, fingerprint: actualFingerprint };
};

export const removeMaterialFile = async (material: ImageMaterial) => {
  const resolved = path.resolve(material.localPath);
  const root = path.resolve(workflowMaterialsRoot);
  const relative = path.relative(root, resolved);
  const managed = Boolean(relative)
    && relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
  if (managed) await unlink(resolved).catch(() => undefined);
};
