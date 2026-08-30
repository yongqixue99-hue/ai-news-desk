# AI News Desk 图片素材种子库

这个目录保存一批可追溯、可机器读取的图片素材种子。它不是“看到就能发”的图片仓库：每条记录都必须经过 `catalog.json` 的版权状态和平台范围检查。

## 目录

- `portraits/`：来自 Wikimedia Commons 的人物照片，保留原始文件页、作者、许可与署名要求。
- `brands/`：由 Simple Icons 矢量数据生成的品牌识别卡。品牌商标没有自动获得发布许可，因此全部标为 `review_required`。
- `generic/`：为本项目生成的无人物、无品牌通用配图，可作为找不到事件图片时的兜底素材。
- `watchlists/`：X 官方/高价值账号候选，只用于发现原帖；不会批量搬运 X 图片。
- `catalog.json`：机器读取的素材清单，包含文件指纹、来源、许可、署名、平台范围和权利状态。
- `generation-prompts.json`：通用生成图的原始提示词证据。

## 权利状态

- `owned`：为本项目生成或由项目持有，可按 `allowedPlatforms` 使用。
- `licensed`：已有明确公开许可，但必须保留署名、许可链接及适用的相同方式共享要求。
- `review_required`：商标、X 媒体或授权范围未完全确认；默认不能进入发布流程。

人物照片即使有 Creative Commons 许可，也可能受肖像权、人格权、误导性语境等限制。这里只建议用于与当事人直接相关的新闻报道，不应暗示代言或用于敏感、贬损性合成。

人物照片记录中的 `modificationNote` 会说明本地保存的是原尺寸还是 Commons 缩放版本，以及是否做过裁切、调色或叠字。当前种子人物照均未在本地做内容修改；带 `CC BY-SA` 的素材若后续发生改编，还必须按对应许可采用相同方式共享并继续保留署名。

品牌图片由 `node scripts/generate-material-brand-icons.mjs` 确定性生成。Simple Icons 自身的 CC0 声明不代表各品牌商标已获授权，详见其 `DISCLAIMER.md`，所以这些卡片不会被自动视为可发布素材。

## 接入现有素材库

`server/material-library-seed.ts` 已提供清单校验、文件指纹检查、单项导入、seed 计划和批量 seed。默认批量 seed 只安装本地的 `owned` 与 `licensed` 素材；品牌标识和远程参考不会自动放行。

```ts
const result = await updateState(async (state) => {
  const seeded = await seedMaterialLibrary({
    existingMaterials: state.materials,
    tombstonedAssetIds: state.materialSeedTombstones,
    // includeReviewRequired 默认为 false，不要在无人审核时开启。
  });
  for (const material of seeded.updated) {
    const index = state.materials.findIndex((item) => item.id === material.id);
    if (index >= 0) state.materials[index] = material;
  }
  state.materials.unshift(...seeded.created);
  return seeded;
});
```

新安装记录使用由 catalog asset id 派生的稳定 ID；旧版随机 ID 会按 SHA-256 认领并保留原 ID，同时回填最新版来源、署名、许可、修改说明、标签和平台范围。删除带 `seedAssetId` 的记录时，应把该值加入 `state.materialSeedTombstones`，否则下次启动会把内置素材重新安装。

接口层可返回 `created.length`、`updated.length`、`skipped`、`missingAssetIds` 与 `failed`。若要预览而不写入，先调用 `planMaterialLibrarySeed(catalog)`。启动时可先调用 `loadOptionalMaterialLibraryCatalog()`：内置清单缺失或损坏时它会返回明确 warning，新闻台仍可继续运行；数据库写入和其他初始化错误不会被它吞掉。
