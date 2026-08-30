import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { recommendMaterialFallbacks } from "./material-recommendation.js";
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

test("specific governed materials rank before generic owned fallbacks", () => {
  const results = recommendMaterialFallbacks([
    material("generic"),
    material("openai", { title: "OpenAI 资料图", tags: ["OpenAI"], entityTags: ["OpenAI"] }),
  ], story(), 2, "2026-08-31T01:00:00.000Z");

  assert.deepEqual(results.map((image) => image.id), ["library:openai", "library:generic"]);
  assert.match(results[1]?.caption || "", /非事件现场/u);
  assert.equal(results.every((image) => Boolean(image.localPath && image.publicPath)), true);
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
    material("owned"),
  ], story(), 4, "2026-08-31T01:00:00.000Z");

  assert.deepEqual(results.map((image) => image.id), ["library:owned"]);
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
