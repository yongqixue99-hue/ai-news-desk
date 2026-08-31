import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createDefaultState } from "./defaults.js";
import { buildContentPackage, freezeContentPackageAssets } from "./package-desk.js";
import { sourceImagesFromContentPackage } from "./draft-desk.js";
import { buildStories } from "./story-desk.js";
import type { Candidate, WorkflowRun } from "./types.js";

const packageFixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-package-images-"));
after(() => rmSync(packageFixtureRoot, { recursive: true, force: true }));

let packageFixtureSequence = 0;
const packageFixture = (name: string) => {
  packageFixtureSequence += 1;
  const localPath = path.join(packageFixtureRoot, `${packageFixtureSequence}-${name}`);
  writeFileSync(localPath, Buffer.from("image-bytes"));
  return localPath;
};
const fileFingerprint = (localPath: string) => createHash("sha256").update(readFileSync(localPath)).digest("hex");

const candidate = (id: string, overrides: Partial<Candidate> = {}): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName: "Acme 官方",
  sourceRole: "official",
  title: "Acme releases Model X",
  url: "https://acme.example/model-x",
  excerpt: "Acme released Model X with an API and public weights.",
  publishedAt: "2026-08-30T01:00:00.000Z",
  fetchedAt: "2026-08-30T01:05:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Acme 官方"],
  evidence: "一手来源",
  briefing: {
    titleZh: "Acme 发布 Model X",
    summaryZh: "Acme 发布了 Model X，并同步开放 API 与权重。",
    basis: "full-source",
    generatedAt: "2026-08-30T01:10:00.000Z",
    providerId: "codex",
  },
  imageCount: 1,
  images: [{
    id: "image-1",
    url: "https://acme.example/model-x-chart.png",
    caption: "Model X 基准图表",
    attribution: "Acme",
    sourceUrl: "https://acme.example/model-x",
    selected: true,
    rights: "official",
    allowedPlatforms: ["wechat"],
  }],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (candidates: Candidate[]): WorkflowRun => ({
  id: "run-1",
  createdAt: "2026-08-30T01:05:00.000Z",
  updatedAt: "2026-08-30T01:05:00.000Z",
  status: "ready",
  stage: "完成",
  windowHours: 24,
  sourceIds: [],
  scheduled: false,
  rawCount: candidates.length,
  candidates,
  logs: [],
});

test("PackageDesk freezes claims, community quotations and governed images", () => {
  const state = createDefaultState();
  state.runs = [run([
    candidate("official"),
    candidate("community", {
      sourceType: "hackernews",
      sourceName: "Hacker News",
      sourceRole: "community",
      engagement: { points: 100, comments: 30, discussionUrl: "https://news.ycombinator.com/item?id=10" },
      excerpt: "[alice]: We tested the API in production and latency was stable. [bob]: The local weights solve a real deployment problem. [carol]: How does the license work for commercial use? [dan]: A workaround is to pin the runtime version. [erin]: However the published benchmark leaves out long context.",
    }),
  ])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    mode: "community",
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.status, "ready");
  assert.equal(contentPackage.facts[0]?.status, "supported");
  assert.equal(contentPackage.discussionSamples.length, 5);
  assert.match(contentPackage.communityEvidenceLabel, /不足以宣称多数或共识/u);
  assert.equal(contentPackage.assets[0]?.rightsDecision, "blocked");
  assert.equal(contentPackage.assets[0]?.localReady, false);
  assert.equal(contentPackage.assets[0]?.origin, "source");
  assert.equal(contentPackage.sources.every((source) => /^https?:\/\//u.test(source.url)), true);
});

test("PackageDesk orders original article images before article screenshots regardless of discovery order", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official", {
    images: [
      {
        id: "article-screenshot",
        url: "/media/article-screenshot.png",
        caption: "原文页面截图",
        attribution: "Acme",
        sourceUrl: "https://acme.example/model-x",
        selected: true,
        rights: "editorial-screenshot",
      },
      {
        id: "article-hero",
        url: "https://acme.example/model-x-hero.jpg",
        caption: "Model X 发布现场",
        attribution: "Acme",
        sourceUrl: "https://acme.example/model-x",
        selected: true,
        rights: "official",
      },
    ],
    imageCount: 2,
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.deepEqual(contentPackage.assets.map((asset) => ({
    id: asset.sourceImageId,
    priority: asset.editorialPriority,
    origin: asset.editorialOrigin,
  })), [
    { id: "article-hero", priority: 1, origin: "article-image" },
    { id: "article-screenshot", priority: 2, origin: "article-screenshot" },
  ]);
});

test("PackageDesk refuses to turn a Watch story into a package", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("community", {
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    briefing: { titleZh: "未经核验的社区消息", summaryZh: "只有社区标题。", basis: "title", generatedAt: "2026-08-30T01:10:00.000Z", providerId: "codex" },
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  assert.throws(() => buildContentPackage(state, { storyId: story.id, now: "2026-08-30T02:00:00.000Z" }), /证据不足/u);
});

test("PackageDesk adds a governed local library fallback and versions the package by its assets", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official", { images: [], imageCount: 0 })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const withoutLibrary = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });
  const genericPath = packageFixture("generic-ai.png");
  state.materials = [{
    id: "material-generic-ai",
    title: "通用 AI 信息流",
    fileName: "generic-ai.png",
    localPath: genericPath,
    publicPath: "/materials/generic-ai.png",
    attribution: "AI News Desk",
    tags: ["通用", "示意图", "AI"],
    rights: "owned",
    allowedPlatforms: ["*"],
    entityTags: [],
    fingerprint: fileFingerprint(genericPath),
    createdAt: "2026-08-30T01:00:00.000Z",
  }];

  const withLibrary = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.notEqual(withLibrary.id, withoutLibrary.id);
  assert.equal(withLibrary.assets[0]?.origin, "library");
  assert.equal(withLibrary.assets[0]?.localReady, true);
  assert.equal(withLibrary.assets[0]?.rightsDecision, "allowed");
  assert.match(withLibrary.assets[0]?.caption || "", /非事件现场/u);
  assert.equal(withLibrary.assets[0]?.sourceImage.localPath, state.materials[0]?.localPath);
  assert.equal(withLibrary.assets[0]?.sourceImage.publicPath, state.materials[0]?.publicPath);
  assert.equal(withLibrary.assets[0]?.sourceImage.attribution, "AI News Desk");
  assert.deepEqual(withLibrary.assets[0]?.sourceImage.allowedPlatforms, ["*"]);
  assert.match(withLibrary.assets[0]?.sourceImage.fingerprint || "", /^[a-f0-9]{64}$/u);
});

test("governance metadata changes create a different package identity", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official", { images: [], imageCount: 0 })])];
  const materialPath = packageFixture("governed.png");
  state.materials = [{
    id: "material-governed",
    title: "Acme 授权资料图",
    fileName: "governed.png",
    localPath: materialPath,
    publicPath: "/materials/governed.png",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Acme.png",
    attribution: "Photographer A / CC BY 4.0",
    tags: ["Acme"],
    rights: "licensed",
    evidenceNote: "Commons 文件页确认 CC BY 4.0。",
    licenseId: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modificationNote: "未修改。",
    allowedPlatforms: ["wechat", "xiaoheihe"],
    entityTags: ["Acme"],
    fingerprint: fileFingerprint(materialPath),
    createdAt: "2026-08-30T01:00:00.000Z",
  }];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const first = buildContentPackage(state, { storyId: story.id, now: "2026-08-30T02:00:00.000Z" });

  state.materials[0]!.attribution = "Photographer B / CC BY 4.0";
  state.materials[0]!.modificationNote = "仅缩放。";
  const changed = buildContentPackage(state, { storyId: story.id, now: "2026-08-30T02:00:00.000Z" });

  assert.notEqual(changed.id, first.id);
  assert.equal(first.assets[0]?.sourceImage.attribution, "Photographer A / CC BY 4.0");
  assert.equal(changed.assets[0]?.sourceImage.attribution, "Photographer B / CC BY 4.0");
});

test("PackageDesk rejects a local file that no longer matches its recorded fingerprint", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official", { images: [], imageCount: 0 })])];
  const localPath = packageFixture("tampered.png");
  const recordedFingerprint = fileFingerprint(localPath);
  writeFileSync(localPath, Buffer.from("tampered-after-catalog"));
  state.materials = [{
    id: "material-tampered",
    title: "通用 AI 资料图",
    fileName: "tampered.png",
    localPath,
    publicPath: "/materials/tampered.png",
    attribution: "AI News Desk",
    tags: ["通用", "AI"],
    rights: "owned",
    allowedPlatforms: ["*"],
    entityTags: [],
    fingerprint: recordedFingerprint,
    createdAt: "2026-08-30T01:00:00.000Z",
  }];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  assert.throws(
    () => buildContentPackage(state, { storyId: story.id, now: "2026-08-30T02:00:00.000Z" }),
    /指纹不一致|文件可能已被替换/u,
  );
});

test("a frozen package survives source deletion and rejects replaced package bytes", async () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official", { images: [], imageCount: 0 })])];
  const originalPath = packageFixture("durable.png");
  state.materials = [{
    id: "material-durable",
    title: "通用 AI 资料图",
    fileName: "durable.png",
    localPath: originalPath,
    publicPath: "/materials/durable.png",
    attribution: "AI News Desk",
    tags: ["通用", "AI"],
    rights: "owned",
    allowedPlatforms: ["*"],
    entityTags: [],
    fingerprint: fileFingerprint(originalPath),
    createdAt: "2026-08-30T01:00:00.000Z",
  }];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const built = buildContentPackage(state, { storyId: story.id, now: "2026-08-30T02:00:00.000Z" });
  const frozen = await freezeContentPackageAssets(built, {
    assetRoot: path.join(packageFixtureRoot, "frozen-packages"),
  });
  const frozenPath = frozen.assets[0]!.sourceImage.localPath!;

  rmSync(originalPath);
  state.materials = [];
  state.runs[0]!.candidates[0]!.images = [];
  assert.equal(existsSync(frozenPath), true);
  assert.notEqual(frozenPath, originalPath);
  assert.equal((await sourceImagesFromContentPackage(frozen))[0]?.id, "library:material-durable");

  writeFileSync(frozenPath, Buffer.from("replacement-bytes"));
  await assert.rejects(
    sourceImagesFromContentPackage(frozen),
    /指纹|内容已变化/u,
  );
});

test("one local source image suppresses generated filler even while its rights need review", () => {
  const state = createDefaultState();
  const migratedPath = process.platform === "win32"
    ? "/Users/old-mac/ai-news-desk/media/x-two.jpg"
    : "C:\\Users\\old-windows\\ai-news-desk\\media\\x-two.jpg";
  const reviewImages = ["x-one", "x-two"].map((id, index) => ({
    id,
    url: `https://pbs.twimg.com/media/${id}.jpg`,
    localPath: index === 0 ? packageFixture(`${id}.jpg`) : migratedPath,
    publicPath: `/media/${id}.jpg`,
    caption: `X image ${id}`,
    attribution: "@Acme",
    sourceUrl: `https://x.com/Acme/status/${id}`,
    selected: false,
    rights: "check-required" as const,
    allowedPlatforms: [],
  }));
  state.runs = [run([candidate("official", { images: reviewImages, imageCount: 2 })])];
  const safePath = packageFixture("safe.png");
  state.materials = [{
    id: "material-safe-generic",
    title: "通用 AI 信息流",
    fileName: "safe.png",
    localPath: safePath,
    publicPath: "/materials/safe.png",
    attribution: "AI News Desk；使用 Codex 内置 image_gen 为本项目生成",
    tags: ["通用", "示意图", "AI", "Acme", "Model X"],
    rights: "owned",
    licenseId: "PROJECT-OWNED",
    allowedPlatforms: ["*"],
    entityTags: [],
    fingerprint: fileFingerprint(safePath),
    createdAt: "2026-08-30T01:00:00.000Z",
  }];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.assets.filter((asset) => asset.origin === "source").length, 2);
  assert.equal(contentPackage.assets.filter((asset) => asset.rightsDecision === "blocked").length, 2);
  assert.equal(contentPackage.assets.filter((asset) => asset.origin === "source" && asset.localReady).length, 1);
  assert.equal(contentPackage.assets.some((asset) => asset.origin === "library"), false);
});

test("a complete Creative Commons portrait remains allowed through PackageDesk", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official", {
    title: "Sam Altman introduces Model X",
    images: [],
    imageCount: 0,
    briefing: {
      titleZh: "Sam Altman 介绍 OpenAI Model X",
      summaryZh: "Sam Altman 介绍了 OpenAI 的新模型。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
    },
  })])];
  const portraitPath = path.resolve("assets/material-library/portraits/sam-altman-techcrunch-2019-cc-by-2.jpg");
  state.materials = [{
    id: "material-sam-altman",
    title: "Sam Altman，TechCrunch Disrupt 2019",
    fileName: "sam.jpg",
    localPath: portraitPath,
    publicPath: "/materials/sam.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Sam_Altman_TechCrunch_SF_2019_Day_2_Oct_3_(cropped).jpg",
    attribution: "TechCrunch / Wikimedia Commons，CC BY 2.0",
    tags: ["人物", "AI人物", "OpenAI"],
    rights: "licensed",
    evidenceNote: "Commons 文件页确认 CC BY 2.0。",
    licenseId: "CC-BY-2.0",
    licenseUrl: "https://creativecommons.org/licenses/by/2.0/",
    modificationNote: "仅缩放，未进一步裁切或调色。",
    allowedPlatforms: ["wechat", "xiaoheihe"],
    entityTags: ["Sam Altman", "OpenAI"],
    fingerprint: fileFingerprint(portraitPath),
    createdAt: "2026-08-30T01:00:00.000Z",
  }];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });
  const portrait = contentPackage.assets.find((asset) => asset.origin === "library");

  assert.equal(portrait?.rightsDecision, "allowed");
  assert.equal(portrait?.rights, "licensed");
});
