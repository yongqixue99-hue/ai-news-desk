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

test("PackageDesk keeps a community discovery path out of a news fact ledger", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("linked-community-source", {
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    title: "CEO fired developers to make room for AI; developers create open-source AI CEO",
    url: "https://github.com/SenteLabsAI/OpenExecutive",
    canonicalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
    engagement: {
      points: 120,
      comments: 42,
      discussionUrl: "https://news.ycombinator.com/item?id=49458418",
    },
    briefing: {
      titleZh: "开发者把 AI CEO 做成开源项目 Open Executive",
      summaryZh: "一则 Hacker News 线索指向名为 Open Executive 的开源项目。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
      explanation: {
        voiceVersion: 2,
        whatHappenedZh: "Open Executive 是一个开源多代理项目。",
        keyPointsZh: [
          "Open Executive 的 GitHub 页面显示仓库采用 Apache 2.0 许可。",
          "项目由一个 Orchestrator 和八个专门 Agent 组成。",
        ],
        unknownsZh: ["标题中的裁员说法尚无独立来源支持。"],
      },
    },
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    intent: "news",
    mode: "brief",
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.status, "ready");
  assert.equal(contentPackage.discussionSamples.length, 0);
  assert.equal(contentPackage.facts.some((claim) => /Hacker News|线索/u.test(claim.text)), false);
  assert.deepEqual(contentPackage.facts.map((claim) => claim.text), [
    "Open Executive 的 GitHub 页面显示仓库采用 Apache 2.0 许可。",
    "项目由一个 Orchestrator 和八个专门 Agent 组成。",
  ]);
});

test("selected-article evidence replaces stale scan summaries and remains frozen with source quotations", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("official")])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const quote = "Cache reads cost one quarter of the previous rate; base input and output prices are unchanged.";
  const source = { signalId: "run-1:official", label: "Acme 官方", url: "https://acme.example/model-x", role: "official" as const,
    basis: "full-source" as const, publishedAt: "2026-08-30T01:00:00.000Z", isCommunity: false };
  const snapshot = { signalId: source.signalId, sourceKind: "article" as const, sourceLabel: source.label,
    url: source.url, originalTitle: "Acme releases Model X", originalText: quote, originalLanguage: "en" as const,
    basis: "full-source" as const, capturedAt: "2026-08-30T01:59:00.000Z", truncated: false, rightsNotice: "保留出处" };
  const fact = { id: "article-claim", text: "Acme 仅将缓存读取价格降至原来的四分之一，基础输入输出价格保持不变。",
    status: "supported" as const, sourceSignalIds: [source.signalId], sourceUrls: [source.url],
    quotations: [{ sourceUrl: source.url, text: quote }] };
  const contentPackage = buildContentPackage(state, { storyId: story.id, mode: "brief", now: "2026-08-30T02:00:00.000Z",
    articleEvidence: { facts: [fact], sources: [source], snapshots: [snapshot], uncertainties: [] } });
  assert.deepEqual(contentPackage.facts.map((entry) => entry.text), [fact.text]);
  assert.deepEqual(contentPackage.sourceEvidence?.[0]?.originalText, quote);
  assert.equal(contentPackage.facts[0]?.quotations?.[0]?.text, quote);
  assert.equal(contentPackage.sources[0]?.basis, "full-source");
  snapshot.originalText = "Changed later";
  fact.text = "Changed later";
  assert.equal(contentPackage.sourceEvidence?.[0]?.originalText, quote);
  assert.notEqual(contentPackage.facts[0]?.text, "Changed later");
});

test("PackageDesk keeps passive community redistribution wording out of a news fact ledger", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("redistributed-community-source", {
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    title: "Apple ships new Mac mini and Mac Studio",
    url: "https://www.macrumors.com/2026/08/30/new-mac-mini-and-mac-studio/",
    canonicalUrl: "https://www.macrumors.com/2026/08/30/new-mac-mini-and-mac-studio/",
    engagement: {
      points: 85,
      comments: 31,
      discussionUrl: "https://news.ycombinator.com/item?id=49460000",
    },
    briefing: {
      titleZh: "Apple 发布新款 Mac mini 和 Mac Studio",
      summaryZh: "MacRumors 报道了 Apple 的桌面 Mac 更新。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
      explanation: {
        voiceVersion: 2,
        whatHappenedZh: "Apple 更新了 Mac mini 和 Mac Studio。",
        keyPointsZh: [
          "MacRumors 报道 Apple 本周发布了新款 Mac mini 和 Mac Studio。",
          "被转到 Hacker News 的报道称，企业对 AI 硬件的需求超出预期。",
        ],
        unknownsZh: [],
      },
    },
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    intent: "news",
    mode: "brief",
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.status, "ready");
  assert.deepEqual(contentPackage.facts.map((claim) => claim.text), [
    "MacRumors 报道了 Apple 的桌面 Mac 更新。",
    "MacRumors 报道 Apple 本周发布了新款 Mac mini 和 Mac Studio。",
  ]);
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

test("PackageDesk excludes an entity image whose identity does not match the Story", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("apple", {
    title: "Apple ships new Mac mini and Mac Studio",
    briefing: {
      titleZh: "Apple 发布新款 Mac mini 和 Mac Studio",
      summaryZh: "Apple 更新了桌面 Mac 产品线。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
    },
    images: [{
      id: "editorial_identity_faerabella",
      url: "https://upload.wikimedia.org/faerabella.jpg",
      caption: "Færeabella at a public event",
      attribution: "Wikimedia Commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Faerabella.jpg",
      selected: true,
      rights: "licensed",
      entityTags: ["Færeabella"],
      editorialPriority: 3,
      editorialOrigin: "entity-library",
    }],
    imageCount: 1,
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.assets.some((asset) => asset.sourceImageId === "editorial_identity_faerabella"), false);
});

test("PackageDesk keeps a canonical company entity image when the Story uses its common name", () => {
  const state = createDefaultState();
  state.runs = [run([candidate("amazon", {
    title: "Amazon announces a new AI shopping assistant",
    briefing: {
      titleZh: "Amazon 发布新的 AI 购物助手",
      summaryZh: "Amazon 更新了面向消费者的 AI 产品。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "codex",
    },
    images: [{
      id: "editorial_identity_amazon",
      url: "https://upload.wikimedia.org/amazon.jpg",
      caption: "Amazon company identity",
      attribution: "Wikimedia Commons",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Amazon.jpg",
      selected: true,
      rights: "licensed",
      entityTags: ["Amazon.com"],
      editorialPriority: 3,
      editorialOrigin: "entity-library",
    }],
    imageCount: 1,
  })])];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;

  const contentPackage = buildContentPackage(state, {
    storyId: story.id,
    now: "2026-08-30T02:00:00.000Z",
  });

  assert.equal(contentPackage.assets.some((asset) => asset.sourceImageId === "editorial_identity_amazon"), true);
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

test("one local source image suppresses generated filler and stays visible in the private draft while rights need review", async () => {
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
  const frozen = await freezeContentPackageAssets(contentPackage, {
    assetRoot: path.join(packageFixtureRoot, "rights-review-packages"),
  });
  const privateDraftImages = await sourceImagesFromContentPackage(frozen);
  assert.deepEqual(privateDraftImages.map((image) => image.id), ["x-one"]);
  assert.equal(frozen.assets.find((asset) => asset.sourceImageId === "x-one")?.rightsDecision, "blocked");
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
