import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  inspectMaterialLibraryFiles,
  loadMaterialLibraryCatalog,
  loadOptionalMaterialLibraryCatalog,
  MaterialLibraryCatalogError,
  materialInputFromSeedAsset,
  planMaterialLibrarySeed,
  seedMaterialLibrary,
  resolveSeedMaterialPath,
  stableSeedMaterialId,
  validateMaterialLibraryCatalog,
  type SeedMaterialAsset,
} from "./material-library-seed.js";
import type { ImageMaterial } from "./types.js";
import { createDefaultState, upgradeState } from "./defaults.js";

test("种子素材清单具备可追溯版权字段，且所有本地文件指纹一致", async () => {
  const catalog = await loadMaterialLibraryCatalog();
  const inspection = await inspectMaterialLibraryFiles(catalog);

  assert.equal(
    inspection.checkedLocalAssets,
    catalog.assets.filter((asset) => asset.availability === "local").length,
  );
  assert.deepEqual(inspection.errors, []);
  assert.equal(inspection.valid, true);

  const licensed = catalog.assets.filter((asset) => asset.rightsStatus === "licensed");
  assert.ok(licensed.length > 0);
  assert.ok(licensed.every((asset) => asset.sourceUrl?.startsWith("https://")));
  assert.ok(licensed.every((asset) => asset.license.url?.startsWith("https://")));
  assert.ok(licensed.every((asset) => asset.attribution.length > 10));
  assert.ok(licensed.every((asset) => asset.modificationNote?.trim()));
  assert.ok(licensed.every((asset) => {
    const input = materialInputFromSeedAsset(asset);
    return input.licenseId === asset.license.id
      && input.licenseUrl === asset.license.url
      && input.modificationNote === asset.modificationNote;
  }));

  const leaderIds = [
    "person-sundar-pichai-2014",
    "person-tim-cook-2017",
    "person-mark-zuckerberg-2025",
    "person-demis-hassabis-2025",
  ];
  const leaders = leaderIds.map((id) => catalog.assets.find((asset) => asset.id === id));
  assert.ok(leaders.every(Boolean));
  assert.ok(leaders.every((asset) => asset?.rightsStatus === "licensed" && asset.availability === "local"));
  assert.ok(leaders.every((asset) => asset?.allowedPlatforms.includes("wechat") && asset.allowedPlatforms.includes("xiaoheihe")));
  assert.ok(leaders.every((asset) => asset?.entityTags.length));
  assert.ok(leaders.every((asset) => {
    const traceable = asset as SeedMaterialAsset & { author?: string; modificationNote?: string };
    return Boolean(traceable.author?.trim() && traceable.modificationNote?.trim());
  }));

  const reviewRequired = catalog.assets.filter((asset) => asset.rightsStatus === "review_required");
  assert.ok(reviewRequired.length >= 8);
  assert.ok(reviewRequired.every((asset) => asset.sourceUrl?.startsWith("https://")));

  const standardGroups = new Set(["人物", "公司", "品牌标识", "通用", "示意图"]);
  assert.ok(catalog.assets.every((asset) => asset.tags.some((tag) => standardGroups.has(tag))));
  const generic = catalog.assets.filter((asset) => asset.category === "generic");
  assert.ok(generic.every((asset) => ["通用", "示意图", "AI"].every((tag) => asset.tags.includes(tag))));
});

test("默认 seed 计划只安装 owned 与 licensed 本地素材", async () => {
  const catalog = await loadMaterialLibraryCatalog();
  const plan = planMaterialLibrarySeed(catalog);

  assert.equal(
    plan.installable.length,
    catalog.assets.filter((asset) => asset.availability === "local" && asset.rightsStatus !== "review_required").length,
  );
  assert.ok(plan.installable.every((asset) => asset.rightsStatus !== "review_required"));
  assert.equal(
    plan.skipped.filter((item) => item.reason === "review-required").length,
    catalog.assets.filter((asset) => asset.availability === "local" && asset.rightsStatus === "review_required").length,
  );
  assert.equal(
    plan.skipped.filter((item) => item.reason === "remote-reference").length,
    catalog.assets.filter((asset) => asset.availability === "remote-reference").length,
  );
  assert.deepEqual(plan.missingAssetIds, []);
});

test("待审核品牌素材进入现有治理模型时仍保持阻断状态", async () => {
  const catalog = await loadMaterialLibraryCatalog();
  const brand = catalog.assets.find((asset) => asset.id === "brand-anthropic-mark")!;
  const normalized = materialInputFromSeedAsset(brand);

  assert.equal(normalized.rights, "check-required");
  assert.deepEqual(normalized.allowedPlatforms, []);
});

test("远程参考和越界路径不能作为本地素材导入", async () => {
  const catalog = await loadMaterialLibraryCatalog();
  const remote = catalog.assets.find((asset) => asset.availability === "remote-reference")!;
  assert.throws(() => resolveSeedMaterialPath(remote), /没有可导入的本地文件/);

  const escaped: SeedMaterialAsset = {
    ...catalog.assets.find((asset) => asset.availability === "local")!,
    id: "escaped",
    localPath: "../outside.png",
  };
  assert.throws(() => resolveSeedMaterialPath(escaped), /越过图片素材库目录/);
});

test("授权素材缺少来源或许可链接时清单校验失败", () => {
  const errors = validateMaterialLibraryCatalog({
    schemaVersion: "ai-news-material-catalog/v1",
    createdAt: "2026-08-31T00:00:00.000Z",
    assets: [{
      id: "broken",
      title: "broken",
      category: "person",
      availability: "local",
      localPath: "assets/material-library/portraits/broken.jpg",
      mimeType: "image/jpeg",
      sha256: "a".repeat(64),
      attribution: "author",
      license: { id: "CC-BY-4.0", name: "CC BY 4.0" },
      rightsStatus: "licensed",
      evidenceNote: "evidence",
      allowedPlatforms: ["wechat"],
      tags: [],
      entityTags: [],
    }],
  });

  assert.ok(errors.some((error) => error.includes("sourceUrl")));
  assert.ok(errors.some((error) => error.includes("许可 URL")));
});

const fakeSeedImporter = async (
  asset: SeedMaterialAsset,
  _existing: readonly ImageMaterial[],
  _projectRoot: string,
  materialId: string,
): Promise<ImageMaterial> => ({
  id: materialId,
  title: "等待目录元数据回填",
  fileName: `${materialId}.png`,
  localPath: `C:\\managed\\${materialId}.png`,
  publicPath: `/materials/${materialId}.png`,
  attribution: "待补充",
  tags: [],
  rights: "check-required",
  allowedPlatforms: [],
  entityTags: [],
  fingerprint: asset.sha256!,
  createdAt: "2026-08-01T00:00:00.000Z",
});

test("seed 使用稳定 ID，并在不换记录 ID 的前提下回填目录元数据", async () => {
  const sourceCatalog = await loadMaterialLibraryCatalog();
  const asset = sourceCatalog.assets.find((entry) => entry.availability === "local" && entry.rightsStatus === "licensed")!;
  const catalog = { ...sourceCatalog, assets: [asset] };

  const first = await seedMaterialLibrary({ catalog, importAsset: fakeSeedImporter });
  assert.equal(first.created.length, 1);
  assert.equal(first.updated.length, 0);
  assert.equal(first.created[0]?.id, stableSeedMaterialId(asset.id));
  assert.equal(first.created[0]?.seedAssetId, asset.id);
  assert.equal(first.created[0]?.seedCatalogCreatedAt, catalog.createdAt);
  assert.equal(first.created[0]?.licenseUrl, asset.license.url);

  const legacy: ImageMaterial = {
    ...first.created[0]!,
    id: "material_legacy_record",
    fileName: "material_legacy_record.png",
    localPath: "C:\\old-mac-state\\material_legacy_record.png",
    publicPath: "/materials/material_legacy_record.png",
    title: "旧标题",
    attribution: "旧署名",
    licenseUrl: undefined,
    modificationNote: undefined,
    seedAssetId: undefined,
    seedCatalogCreatedAt: undefined,
  };
  const refreshedCatalog = {
    ...catalog,
    createdAt: "2026-09-01T00:00:00.000Z",
    assets: [{ ...asset, title: `${asset.title}（目录修订）` }],
  };
  const second = await seedMaterialLibrary({
    catalog: refreshedCatalog,
    existingMaterials: [legacy],
    importAsset: fakeSeedImporter,
  });

  assert.equal(second.created.length, 0);
  assert.equal(second.updated.length, 1);
  assert.equal(second.updated[0]?.id, legacy.id);
  assert.equal(second.updated[0]?.createdAt, legacy.createdAt);
  assert.equal(second.updated[0]?.seedAssetId, asset.id);
  assert.equal(second.updated[0]?.seedCatalogCreatedAt, refreshedCatalog.createdAt);
  assert.equal(second.updated[0]?.title, refreshedCatalog.assets[0]!.title);
  assert.equal(second.updated[0]?.attribution, asset.attribution);
  assert.equal(second.updated[0]?.licenseUrl, asset.license.url);
  assert.equal(second.updated[0]?.modificationNote, asset.modificationNote);
});

test("用户删除的 seed 素材由 tombstone 阻止重启复活", async () => {
  const sourceCatalog = await loadMaterialLibraryCatalog();
  const asset = sourceCatalog.assets.find((entry) => entry.availability === "local")!;
  let importCalls = 0;
  const result = await seedMaterialLibrary({
    catalog: { ...sourceCatalog, assets: [asset] },
    tombstonedAssetIds: [asset.id],
    importAsset: async (...args) => {
      importCalls += 1;
      return fakeSeedImporter(...args);
    },
  });

  assert.equal(importCalls, 0);
  assert.deepEqual(result.created, []);
  assert.deepEqual(result.updated, []);
  assert.ok(result.skipped.some((entry) => entry.assetId === asset.id && entry.reason === "user-deleted"));
});

test("slug 相同的目录 ID 仍由摘要区分", () => {
  assert.equal(stableSeedMaterialId("Person-Sam-Altman"), stableSeedMaterialId("Person-Sam-Altman"));
  assert.notEqual(stableSeedMaterialId("a/b"), stableSeedMaterialId("a b"));
  assert.match(stableSeedMaterialId("Person-Sam-Altman"), /^[a-z0-9][a-z0-9_-]{0,119}$/u);
});

test("旧状态升级会初始化并清洗 seed 删除墓碑", () => {
  const legacy = structuredClone(createDefaultState()) as unknown as {
    materialSeedTombstones?: unknown;
  };
  delete legacy.materialSeedTombstones;
  const upgradedLegacy = upgradeState(legacy as ReturnType<typeof createDefaultState>);
  assert.deepEqual(upgradedLegacy.materialSeedTombstones, []);

  const dirty = createDefaultState() as unknown as { materialSeedTombstones: unknown };
  dirty.materialSeedTombstones = [" person-sam ", "person-sam", "", 42];
  const upgradedDirty = upgradeState(dirty as ReturnType<typeof createDefaultState>);
  assert.deepEqual(upgradedDirty.materialSeedTombstones, ["person-sam"]);
});

test("内置 catalog 缺失或 JSON 损坏时只停用自动 seed", async () => {
  const fixtureRoot = await mkdtemp(path.join(tmpdir(), "ai-news-seed-catalog-"));
  try {
    const missingPath = path.join(fixtureRoot, "missing.json");
    await assert.rejects(
      () => loadMaterialLibraryCatalog(missingPath),
      (error: unknown) => error instanceof MaterialLibraryCatalogError
        && /找不到内置清单/u.test(error.message),
    );
    const missing = await loadOptionalMaterialLibraryCatalog(missingPath);
    assert.equal(missing.catalog, undefined);
    assert.match(missing.warning || "", /跳过内置图片自动安装.*继续启动/u);

    const malformedPath = path.join(fixtureRoot, "malformed.json");
    await writeFile(malformedPath, "{ not-json", "utf8");
    await assert.rejects(
      () => loadMaterialLibraryCatalog(malformedPath),
      (error: unknown) => error instanceof MaterialLibraryCatalogError
        && /不是有效 JSON/u.test(error.message),
    );
    const malformed = await loadOptionalMaterialLibraryCatalog(malformedPath);
    assert.equal(malformed.catalog, undefined);
    assert.match(malformed.warning || "", /继续启动/u);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
