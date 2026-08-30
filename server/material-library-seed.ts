import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DuplicateMaterialError,
  normalizeMaterialInput,
  saveMaterialBytes,
  type MaterialInput,
} from "./materials.js";
import type { ImageMaterial } from "./types.js";
import { workspaceRoot } from "./workspace-paths.js";

export type SeedMaterialRightsStatus = "owned" | "licensed" | "review_required";
export type SeedMaterialAvailability = "local" | "remote-reference";

export interface SeedMaterialLicense {
  id: string;
  name: string;
  url?: string;
}

export interface SeedMaterialAsset {
  id: string;
  title: string;
  category: string;
  availability: SeedMaterialAvailability;
  localPath?: string;
  mimeType?: string;
  sha256?: string;
  sourceUrl?: string;
  sourceAssetUrl?: string;
  attribution: string;
  license: SeedMaterialLicense;
  rightsStatus: SeedMaterialRightsStatus;
  evidenceNote: string;
  evidencePath?: string;
  modificationNote?: string;
  allowedPlatforms: string[];
  tags: string[];
  entityTags: string[];
}

export interface SeedMaterialCatalog {
  schemaVersion: "ai-news-material-catalog/v1";
  createdAt: string;
  usagePolicy: {
    defaultFallbackOrder: string[];
    neverAutoPublishStatuses: SeedMaterialRightsStatus[];
    notes: string[];
  };
  assets: SeedMaterialAsset[];
}

export const materialLibraryRoot = path.join(workspaceRoot, "assets", "material-library");
export const materialLibraryCatalogPath = path.join(materialLibraryRoot, "catalog.json");

const objectValue = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;

const text = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const textArray = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string");
const httpUrl = (value: unknown) => {
  if (!text(value)) return false;
  try {
    const parsed = new URL(value as string);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
};

const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

export const validateMaterialLibraryCatalog = (value: unknown) => {
  const errors: string[] = [];
  const catalog = objectValue(value);
  if (!catalog) return ["素材清单必须是 JSON 对象。"];
  if (catalog.schemaVersion !== "ai-news-material-catalog/v1") {
    errors.push("素材清单 schemaVersion 必须是 ai-news-material-catalog/v1。");
  }
  if (!text(catalog.createdAt) || !Number.isFinite(Date.parse(catalog.createdAt as string))) {
    errors.push("素材清单 createdAt 必须是有效时间。 ");
  }
  if (!Array.isArray(catalog.assets)) {
    errors.push("素材清单 assets 必须是数组。");
    return errors;
  }

  const ids = new Set<string>();
  for (const [index, raw] of catalog.assets.entries()) {
    const asset = objectValue(raw);
    const prefix = `assets[${index}]`;
    if (!asset) {
      errors.push(`${prefix} 必须是对象。`);
      continue;
    }
    const id = text(asset.id) ? (asset.id as string).trim() : "";
    if (!id) errors.push(`${prefix}.id 不能为空。`);
    else if (ids.has(id)) errors.push(`${prefix}.id 与其他素材重复：${id}。`);
    else ids.add(id);

    if (!text(asset.title)) errors.push(`${prefix}.title 不能为空。`);
    if (!text(asset.category)) errors.push(`${prefix}.category 不能为空。`);
    if (!text(asset.attribution)) errors.push(`${prefix}.attribution 不能为空。`);
    if (!text(asset.evidenceNote)) errors.push(`${prefix}.evidenceNote 不能为空。`);
    if (!textArray(asset.allowedPlatforms)) errors.push(`${prefix}.allowedPlatforms 必须是字符串数组。`);
    if (!textArray(asset.tags)) errors.push(`${prefix}.tags 必须是字符串数组。`);
    if (!textArray(asset.entityTags)) errors.push(`${prefix}.entityTags 必须是字符串数组。`);

    if (!(["local", "remote-reference"] as unknown[]).includes(asset.availability)) {
      errors.push(`${prefix}.availability 无效。`);
    }
    if (!(["owned", "licensed", "review_required"] as unknown[]).includes(asset.rightsStatus)) {
      errors.push(`${prefix}.rightsStatus 无效。`);
    }
    const license = objectValue(asset.license);
    if (!license || !text(license.id) || !text(license.name)) {
      errors.push(`${prefix}.license 必须包含 id 和 name。`);
    }

    if (asset.availability === "local") {
      if (!text(asset.localPath)) errors.push(`${prefix}.localPath 不能为空。`);
      if (!text(asset.mimeType) || !String(asset.mimeType).startsWith("image/")) {
        errors.push(`${prefix}.mimeType 必须是图片 MIME 类型。`);
      }
      if (!text(asset.sha256) || !/^[a-f0-9]{64}$/i.test(asset.sha256 as string)) {
        errors.push(`${prefix}.sha256 必须是 64 位 SHA-256。`);
      }
    }

    if (asset.rightsStatus === "licensed") {
      if (!httpUrl(asset.sourceUrl)) errors.push(`${prefix} 是授权素材，但缺少可追溯 sourceUrl。`);
      if (!license || !httpUrl(license.url)) errors.push(`${prefix} 是授权素材，但缺少许可 URL。`);
      if (asset.availability !== "local") errors.push(`${prefix} 是授权素材，但没有本地文件。`);
      if (!text(asset.modificationNote)) errors.push(`${prefix} 是授权素材，但缺少 modificationNote。`);
    }
    if (asset.rightsStatus === "review_required" && !httpUrl(asset.sourceUrl)) {
      errors.push(`${prefix} 待审核，但缺少供人工核验的 sourceUrl。`);
    }
    if (asset.availability === "remote-reference" && asset.rightsStatus !== "review_required") {
      errors.push(`${prefix} 是远程参考，不得直接标成可发布状态。`);
    }
  }
  return errors;
};

export class MaterialLibraryCatalogError extends Error {
  constructor(readonly errors: string[]) {
    super(`图片素材清单无效：${errors.join(" ")}`);
    this.name = "MaterialLibraryCatalogError";
  }
}

export const loadMaterialLibraryCatalog = async (
  catalogPath = materialLibraryCatalogPath,
): Promise<SeedMaterialCatalog> => {
  let raw: string;
  try {
    raw = await readFile(catalogPath, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!code || !["ENOENT", "EACCES", "EPERM", "EISDIR"].includes(code)) throw error;
    throw new MaterialLibraryCatalogError([
      code === "ENOENT"
        ? `找不到内置清单 ${path.basename(catalogPath)}。`
        : `无法读取内置清单 ${path.basename(catalogPath)}${code ? `（${code}）` : ""}。`,
    ]);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new MaterialLibraryCatalogError([
      `内置清单 ${path.basename(catalogPath)} 不是有效 JSON。`,
    ]);
  }
  const errors = validateMaterialLibraryCatalog(parsed);
  if (errors.length) throw new MaterialLibraryCatalogError(errors);
  return parsed as SeedMaterialCatalog;
};

export interface OptionalMaterialLibraryCatalog {
  catalog?: SeedMaterialCatalog;
  warning?: string;
}

/** A broken bundled catalog disables only auto-seeding, never the news desk. */
export const loadOptionalMaterialLibraryCatalog = async (
  catalogPath = materialLibraryCatalogPath,
): Promise<OptionalMaterialLibraryCatalog> => {
  try {
    return { catalog: await loadMaterialLibraryCatalog(catalogPath) };
  } catch (error) {
    if (!(error instanceof MaterialLibraryCatalogError)) throw error;
    return {
      warning: `${error.message} 已跳过内置图片自动安装，新闻台其余功能会继续启动。`,
    };
  }
};

export const resolveSeedMaterialPath = (
  asset: SeedMaterialAsset,
  projectRoot = workspaceRoot,
) => {
  if (asset.availability !== "local" || !asset.localPath?.trim()) {
    throw new Error(`素材 ${asset.id} 只有来源参考，没有可导入的本地文件。`);
  }
  if (path.isAbsolute(asset.localPath)) {
    throw new Error(`素材 ${asset.id} 的 localPath 必须是项目相对路径。`);
  }
  const libraryRoot = path.resolve(projectRoot, "assets", "material-library");
  const target = path.resolve(projectRoot, asset.localPath);
  if (target === libraryRoot || !target.startsWith(`${libraryRoot}${path.sep}`)) {
    throw new Error(`素材 ${asset.id} 的 localPath 越过图片素材库目录。`);
  }
  return target;
};

export interface MaterialLibraryInspection {
  valid: boolean;
  checkedLocalAssets: number;
  errors: string[];
}

export const inspectMaterialLibraryFiles = async (
  catalog: SeedMaterialCatalog,
  projectRoot = workspaceRoot,
): Promise<MaterialLibraryInspection> => {
  const errors: string[] = [];
  let checkedLocalAssets = 0;
  for (const asset of catalog.assets) {
    if (asset.availability !== "local") continue;
    checkedLocalAssets += 1;
    try {
      const bytes = await readFile(resolveSeedMaterialPath(asset, projectRoot));
      const fingerprint = sha256(bytes);
      if (fingerprint !== asset.sha256?.toLowerCase()) {
        errors.push(`${asset.id} 的文件指纹与 catalog.json 不一致。`);
      }
      if (!bytes.length) errors.push(`${asset.id} 的本地文件为空。`);
    } catch (error) {
      errors.push(`${asset.id} 无法读取：${error instanceof Error ? error.message : "未知错误"}`);
    }
  }
  return { valid: errors.length === 0, checkedLocalAssets, errors };
};

export const materialInputFromSeedAsset = (asset: SeedMaterialAsset): MaterialInput => ({
  title: asset.title,
  attribution: asset.attribution,
  sourceUrl: asset.sourceUrl,
  tags: asset.tags,
  rights: asset.rightsStatus === "review_required" ? "check-required" : asset.rightsStatus,
  evidenceNote: `${asset.evidenceNote} 许可：${asset.license.name}${asset.license.url ? `（${asset.license.url}）` : ""}`,
  evidencePath: asset.evidencePath,
  licenseId: asset.license.id,
  licenseUrl: asset.license.url,
  modificationNote: asset.modificationNote,
  allowedPlatforms: asset.allowedPlatforms,
  entityTags: asset.entityTags,
});

/**
 * Fresh installs use the same record/file identity on every machine. The hash
 * prevents two catalog ids that normalize to the same slug from colliding.
 */
export const stableSeedMaterialId = (assetId: string) => {
  const normalizedId = assetId.trim().toLocaleLowerCase();
  const slug = normalizedId
    .normalize("NFKD")
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64) || "asset";
  const digest = createHash("sha256").update(normalizedId).digest("hex").slice(0, 12);
  return `material_seed_${slug}_${digest}`;
};

export const reconcileSeedMaterialMetadata = (
  material: ImageMaterial,
  asset: SeedMaterialAsset,
  catalogCreatedAt: string,
): ImageMaterial => ({
  ...material,
  ...normalizeMaterialInput(materialInputFromSeedAsset(asset), asset.title),
  seedAssetId: asset.id,
  seedCatalogCreatedAt: catalogCreatedAt,
});

export const importSeedMaterialAsset = async (
  asset: SeedMaterialAsset,
  existingMaterials: readonly ImageMaterial[] = [],
  projectRoot = workspaceRoot,
  materialId = stableSeedMaterialId(asset.id),
) => {
  const localPath = resolveSeedMaterialPath(asset, projectRoot);
  const bytes = await readFile(localPath);
  const fingerprint = sha256(bytes);
  if (fingerprint !== asset.sha256?.toLowerCase()) {
    throw new Error(`素材 ${asset.id} 的文件指纹与 catalog.json 不一致，拒绝导入。`);
  }
  return saveMaterialBytes(
    bytes,
    asset.mimeType!,
    materialInputFromSeedAsset(asset),
    asset.title,
    asset.sourceAssetUrl || asset.sourceUrl || "",
    existingMaterials,
    materialId,
  );
};

export type MaterialLibrarySeedSkipReason =
  | "remote-reference"
  | "review-required"
  | "user-deleted"
  | "duplicate";

export interface MaterialLibrarySeedSkip {
  assetId: string;
  title: string;
  reason: MaterialLibrarySeedSkipReason;
  detail?: string;
}

export interface MaterialLibrarySeedPlanOptions {
  assetIds?: readonly string[];
  includeReviewRequired?: boolean;
  tombstonedAssetIds?: readonly string[];
}

export interface MaterialLibrarySeedPlan {
  installable: SeedMaterialAsset[];
  skipped: MaterialLibrarySeedSkip[];
  missingAssetIds: string[];
}

/**
 * Creates a deterministic, rights-aware plan. By default only local `owned`
 * and explicitly `licensed` files are installable. Brand/X references remain
 * visible in the catalog but never become publishable material automatically.
 */
export const planMaterialLibrarySeed = (
  catalog: SeedMaterialCatalog,
  options: MaterialLibrarySeedPlanOptions = {},
): MaterialLibrarySeedPlan => {
  const requested = options.assetIds?.length ? new Set(options.assetIds) : undefined;
  const tombstoned = new Set(options.tombstonedAssetIds ?? []);
  const availableIds = new Set(catalog.assets.map((asset) => asset.id));
  const missingAssetIds = requested
    ? [...requested].filter((assetId) => !availableIds.has(assetId))
    : [];
  const installable: SeedMaterialAsset[] = [];
  const skipped: MaterialLibrarySeedSkip[] = [];

  for (const asset of catalog.assets) {
    if (requested && !requested.has(asset.id)) continue;
    if (tombstoned.has(asset.id)) {
      skipped.push({ assetId: asset.id, title: asset.title, reason: "user-deleted" });
      continue;
    }
    if (asset.availability !== "local") {
      skipped.push({ assetId: asset.id, title: asset.title, reason: "remote-reference" });
      continue;
    }
    if (asset.rightsStatus === "review_required" && !options.includeReviewRequired) {
      skipped.push({ assetId: asset.id, title: asset.title, reason: "review-required" });
      continue;
    }
    installable.push(asset);
  }

  return { installable, skipped, missingAssetIds };
};

export interface SeedMaterialLibraryOptions extends MaterialLibrarySeedPlanOptions {
  catalog?: SeedMaterialCatalog;
  existingMaterials?: readonly ImageMaterial[];
  projectRoot?: string;
  importAsset?: (
    asset: SeedMaterialAsset,
    existingMaterials: readonly ImageMaterial[],
    projectRoot: string,
    materialId: string,
  ) => Promise<ImageMaterial>;
}

export interface SeedMaterialLibraryResult extends MaterialLibrarySeedPlan {
  created: ImageMaterial[];
  updated: ImageMaterial[];
  failed: Array<{ assetId: string; title: string; error: string }>;
}

/**
 * Copies planned seed files into the managed `.workflow/materials` directory.
 * The caller owns state persistence: append `created` and replace matching ids
 * from `updated` inside one updateState transaction. Existing catalog records
 * are rewritten at their current id so metadata and missing files are repaired
 * without creating duplicates. Per-asset failures do not abort the whole seed.
 */
export const seedMaterialLibrary = async (
  options: SeedMaterialLibraryOptions = {},
): Promise<SeedMaterialLibraryResult> => {
  const catalog = options.catalog ?? await loadMaterialLibraryCatalog();
  const plan = planMaterialLibrarySeed(catalog, options);
  const existing = [...(options.existingMaterials ?? [])];
  const created: ImageMaterial[] = [];
  const updated: ImageMaterial[] = [];
  const skipped = [...plan.skipped];
  const failed: SeedMaterialLibraryResult["failed"] = [];
  const importer = options.importAsset ?? importSeedMaterialAsset;

  for (const asset of plan.installable) {
    try {
      const matchingSeed = existing.find((material) => material.seedAssetId === asset.id);
      const matchingFingerprint = existing.find((material) => material.fingerprint === asset.sha256?.toLowerCase());
      if (matchingSeed && matchingFingerprint && matchingSeed.id !== matchingFingerprint.id) {
        skipped.push({
          assetId: asset.id,
          title: asset.title,
          reason: "duplicate",
          detail: `目录身份属于 ${matchingSeed.title}，但同一文件指纹已由 ${matchingFingerprint.title} 占用。`,
        });
        continue;
      }
      const previous = matchingSeed ?? matchingFingerprint;
      if (previous?.seedAssetId && previous.seedAssetId !== asset.id) {
        skipped.push({
          assetId: asset.id,
          title: asset.title,
          reason: "duplicate",
          detail: `文件指纹已由目录素材 ${previous.seedAssetId} 占用。`,
        });
        continue;
      }
      const materialId = previous?.id ?? stableSeedMaterialId(asset.id);
      const idOwner = existing.find((material) => material.id === materialId && material !== previous);
      if (idOwner) throw new Error(`稳定素材 ID 与“${idOwner.title}”冲突。`);
      const stored = await importer(
        asset,
        previous ? existing.filter((material) => material.id !== previous.id) : existing,
        options.projectRoot ?? workspaceRoot,
        materialId,
      );
      const material = reconcileSeedMaterialMetadata({
        ...stored,
        createdAt: previous?.createdAt ?? stored.createdAt,
      }, asset, catalog.createdAt);
      if (previous) {
        const index = existing.findIndex((entry) => entry.id === previous.id);
        existing[index] = material;
        updated.push(material);
      } else {
        existing.push(material);
        created.push(material);
      }
    } catch (error) {
      if (error instanceof DuplicateMaterialError) {
        skipped.push({
          assetId: asset.id,
          title: asset.title,
          reason: "duplicate",
          detail: error.message,
        });
        continue;
      }
      failed.push({
        assetId: asset.id,
        title: asset.title,
        error: error instanceof Error ? error.message : "未知错误",
      });
    }
  }

  return {
    ...plan,
    skipped,
    created,
    updated,
    failed,
  };
};
