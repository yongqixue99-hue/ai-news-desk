import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { recommendMaterialCandidates, recommendMaterialFallbacks } from "./material-recommendation.js";
import type { StoryView } from "./product-types.js";
import type { ImageMaterial } from "./types.js";

const materialFixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-material-recommendation-"));
after(() => rmSync(materialFixtureRoot, { recursive: true, force: true }));

let materialFixtureSequence = 0;
const materialFixture = (id: string) => {
  materialFixtureSequence += 1;
  const localPath = path.join(materialFixtureRoot, `${materialFixtureSequence}-${id}.png`);
  writeFileSync(localPath, Buffer.from("image-bytes"));
  return localPath;
};

const material = (id: string, overrides: Partial<ImageMaterial> = {}): ImageMaterial => ({
  id,
  title: id,
  fileName: `${id}.png`,
  localPath: materialFixture(id),
  publicPath: `/materials/${id}.png`,
  attribution: "AI News Desk",
  tags: ["通用", "AI"],
  rights: "owned",
  allowedPlatforms: ["*"],
  entityTags: [],
  fingerprint: id.padEnd(64, "a").slice(0, 64),
  createdAt: "2026-08-31T00:00:00.000Z",
  ...overrides,
});

const story = (): StoryView => ({
  id: "story-openai",
  title: "OpenAI 发布新的推理模型",
  originalTitle: "OpenAI releases a new reasoning model",
  summary: "OpenAI announced a model update.",
  whyImportant: "开发者将获得新的模型能力。",
  communityFocus: [],
  explanation: {
    status: "partial",
    basis: "excerpt",
    voiceVersion: 2,
    readerBrief: "OpenAI 发布模型更新。",
    whatHappened: "OpenAI 发布模型更新。",
    keyPoints: [],
    whyItMatters: "开发者可使用新能力。",
    unknowns: [],
    qualityFlags: [],
    sources: [],
  },
  topicIds: ["ai"],
  firstSeenAt: "2026-08-31T00:00:00.000Z",
  lastSeenAt: "2026-08-31T00:00:00.000Z",
  publishedAt: "2026-08-31T00:00:00.000Z",
  ageHours: 1,
  recommendationScore: 90,
  evidenceStrength: "moderate",
  sourceCount: 1,
  factSourceCount: 1,
  communitySourceCount: 0,
  communitySampleCount: 0,
  images: [],
  imageCount: 0,
  selected: false,
  drafted: false,
  published: false,
  ignored: false,
  assignment: {
    mode: "brief",
    reason: "一手消息",
    audienceValue: "了解更新",
    evidenceStrength: "moderate",
    canDraft: true,
    blockers: [],
    warnings: [],
    decidedAt: "2026-08-31T00:00:00.000Z",
    basis: "policy-v1",
  },
  trend: { direction: "unknown", summary: "暂无趋势", platformCount: 1 },
  signals: [{
    runId: "run-1",
    candidateId: "candidate-1",
    sourceName: "OpenAI",
    sourceRole: "official",
    sourceType: "rss",
    title: "OpenAI releases a new reasoning model",
    url: "https://openai.com/news/example",
    publishedAt: "2026-08-31T00:00:00.000Z",
    fetchedAt: "2026-08-31T00:01:00.000Z",
    isCommunity: false,
    drafted: false,
  }],
});

test("an entity-specific material suppresses generated filler instead of merely ranking before it", () => {
  const results = recommendMaterialFallbacks([
    material("generated", {
      attribution: "AI News Desk；使用 Codex 内置 image_gen 为本项目生成",
      licenseId: "PROJECT-OWNED",
    }),
    material("openai", { title: "OpenAI 资料图", tags: ["OpenAI"], entityTags: ["OpenAI"] }),
  ], story(), 2, "2026-08-31T01:00:00.000Z");

  assert.deepEqual(results.map((image) => image.id), ["library:openai"]);
  assert.equal(results[0]?.editorialPriority, 3);
  assert.equal(results[0]?.editorialOrigin, "entity-library");
  assert.equal(results.every((image) => Boolean(image.localPath && image.publicPath)), true);
});

test("a Sony Music AI lawsuit does not receive a generated image matched only by generic AI tags", () => {
  const lawsuit = story();
  lawsuit.id = "story-sony-music-lawsuit";
  lawsuit.title = "Sony Music 起诉 AI 公司未经许可使用录音训练模型";
  lawsuit.originalTitle = "Sony Music sues AI company over unlicensed recordings";
  lawsuit.summary = "Sony Music 指控一家 AI 公司未经授权复制音乐作品。";
  lawsuit.whyImportant = "案件关系音乐版权与生成式 AI 训练边界。";
  lawsuit.signals[0] = {
    ...lawsuit.signals[0]!,
    sourceName: "Original publisher",
    title: lawsuit.originalTitle,
    url: "https://example.com/sony-music-lawsuit",
  };
  const generated = material("generated-generic", {
    attribution: "AI News Desk；使用 Codex 内置 image_gen 为本项目生成",
    licenseId: "PROJECT-OWNED",
    tags: ["通用", "示意图", "AI", "生成式AI"],
  });

  assert.deepEqual(recommendMaterialFallbacks(
    [generated],
    lawsuit,
    2,
    "2026-08-31T01:00:00.000Z",
  ), []);
});

test("owned generic AI artwork is not relevant evidence merely because reuse is allowed", () => {
  const generic = material("owned-generic", { title: "抽象科技背景", tags: ["通用", "AI", "科技"] });
  assert.deepEqual(recommendMaterialFallbacks([generic], story()), []);
  assert.deepEqual(recommendMaterialCandidates([generic], story()), []);
  generic.entityTags = ["AI", "科技"];
  assert.deepEqual(recommendMaterialFallbacks([generic], story()), []);
  assert.deepEqual(recommendMaterialCandidates([generic], story()), []);
});

test("a publisher name in source metadata does not make its stock image relevant to the event", () => {
  const externalEvent = story();
  externalEvent.title = "一家芯片厂商公布新芯片";
  externalEvent.originalTitle = "Chip maker introduces a processor";
  externalEvent.summary = "A chip maker has announced a processor.";
  externalEvent.signals[0]!.title = externalEvent.originalTitle;
  const publisherLogo = material("publisher-openai", { tags: ["OpenAI"], entityTags: ["OpenAI"] });
  assert.deepEqual(recommendMaterialFallbacks([publisherLogo], externalEvent), []);
});

test("official, unverified and partially licensed files are never automatic fallbacks", () => {
  const results = recommendMaterialFallbacks([
    material("official", { rights: "official", sourceUrl: "https://example.com/press", allowedPlatforms: ["*"] }),
    material("unknown", { rights: "check-required" }),
    material("licensed", {
      rights: "licensed",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      attribution: "Example / CC BY-SA 4.0",
      evidenceNote: undefined,
    }),
    material("owned", { tags: ["OpenAI"], entityTags: ["OpenAI"] }),
  ], story(), 4, "2026-08-31T01:00:00.000Z");

  assert.deepEqual(results.map((image) => image.id), ["library:owned"]);
});

test("a matching company identity asset remains reviewable without becoming auto-publishable", () => {
  const sonyStory = story();
  sonyStory.title = "Sony Music 起诉 AI 公司侵犯音乐版权";
  sonyStory.originalTitle = "Sony Music files AI copyright lawsuit";
  const sonyIdentity = material("sony-music-identity", {
    title: "Sony Music 公司识别图",
    sourceUrl: "https://www.sonymusic.com/",
    attribution: "Sony Music；商标权利待核对",
    tags: ["公司", "公司图标", "Sony Music"],
    rights: "check-required",
    allowedPlatforms: [],
    entityTags: ["Sony Music"],
  });

  assert.deepEqual(recommendMaterialFallbacks(
    [sonyIdentity],
    sonyStory,
    1,
    "2026-08-31T01:00:00.000Z",
  ), []);
  const candidates = recommendMaterialCandidates(
    [sonyIdentity],
    sonyStory,
    1,
    "2026-08-31T01:00:00.000Z",
  );
  assert.equal(candidates[0]?.id, "library:sony-music-identity");
  assert.equal(candidates[0]?.editorialPriority, 3);
  assert.equal(candidates[0]?.rights, "check-required");
});

test("licensed material can be automatic only with evidence and both platform permissions", () => {
  const results = recommendMaterialFallbacks([
    material("licensed", {
      rights: "licensed",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      attribution: "Example / CC BY-SA 4.0",
      evidenceNote: "CC BY-SA 4.0; attribution and share-alike required.",
      licenseId: "CC-BY-SA-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
      modificationNote: "Only resized; no crop or color edits.",
      allowedPlatforms: ["wechat", "xiaoheihe"],
      tags: ["OpenAI"],
      entityTags: ["OpenAI"],
    }),
  ], story(), 1, "2026-08-31T01:00:00.000Z");

  assert.equal(results[0]?.id, "library:licensed");
  assert.equal(results[0]?.rights, "licensed");
});

test("a company-only story never receives an executive portrait", () => {
  const portrait = material("sam", {
    title: "Sam Altman，TechCrunch Disrupt 2019",
    tags: ["人物", "AI人物", "OpenAI", "负责人"],
    entityTags: ["Sam Altman", "OpenAI"],
  });

  assert.deepEqual(recommendMaterialFallbacks(
    [portrait],
    story(),
    1,
    "2026-08-31T01:00:00.000Z",
  ), []);

  const personStory = story();
  personStory.title = "Sam Altman 介绍 OpenAI 新模型";
  assert.equal(recommendMaterialFallbacks(
    [portrait],
    personStory,
    1,
    "2026-08-31T01:00:00.000Z",
  )[0]?.id, "library:sam");
});

test("a user-created company material is useful without its company tag impersonating a person name", () => {
  const companyAsset = material("custom-openai-company", {
    title: "OpenAI 公司资料图",
    tags: ["公司", "OpenAI", "资料图"],
    entityTags: ["OpenAI"],
  });
  const bogusPortrait = material("custom-openai-leader", {
    title: "OpenAI 公司负责人资料图",
    tags: ["人物", "公司", "OpenAI"],
    entityTags: ["OpenAI"],
  });

  assert.deepEqual(recommendMaterialFallbacks(
    [bogusPortrait, companyAsset],
    story(),
    2,
    "2026-08-31T01:00:00.000Z",
  ).map((item) => item.id), ["library:custom-openai-company"]);
});

test("automatic material insertion rejects deleted and foreign operating-system paths", () => {
  const deleted = material("deleted");
  rmSync(deleted.localPath);
  const foreignPath = process.platform === "win32"
    ? "/Users/old-mac/ai-news-desk/materials/openai.png"
    : "C:\\Users\\old-windows\\ai-news-desk\\materials\\openai.png";
  const migrated = material("migrated", { localPath: foreignPath });

  assert.deepEqual(recommendMaterialFallbacks(
    [deleted, migrated],
    story(),
    2,
    "2026-08-31T01:00:00.000Z",
  ), []);
});
