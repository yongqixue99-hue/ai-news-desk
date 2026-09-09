import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { StorySignalView } from "./product-types.js";
import type { ExtractedPage, SourceImage } from "./types.js";
import {
  countVisualAssets,
  mergeVisualImages,
  runVisualHydration,
  type VisualHydrationDependencies,
} from "./visual-desk.js";

const imageFixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-visual-images-"));
after(() => rmSync(imageFixtureRoot, { recursive: true, force: true }));

let fixtureSequence = 0;
const imageFixture = (name: string) => {
  fixtureSequence += 1;
  const localPath = path.join(imageFixtureRoot, `${fixtureSequence}-${name}`);
  writeFileSync(localPath, Buffer.from("image-bytes"));
  return localPath;
};

const signal: StorySignalView = {
  runId: "run-1",
  candidateId: "candidate-1",
  sourceName: "Official source",
  sourceRole: "official",
  sourceType: "rss",
  title: "Example story",
  url: "https://example.com/story",
  publishedAt: "2026-08-31T00:00:00.000Z",
  fetchedAt: "2026-08-31T00:01:00.000Z",
  isCommunity: false,
  drafted: false,
};

const image = (
  id: string,
  overrides: Partial<SourceImage> = {},
): SourceImage => ({
  id,
  url: `https://cdn.example.com/${id}.jpg`,
  caption: id,
  attribution: "example.com",
  sourceUrl: signal.url,
  selected: true,
  rights: "check-required",
  ...overrides,
});

test("article material collection continues beyond two cached covers and includes rendered charts", async () => {
  const cached = ["cover-one", "cover-two"].map((id) => image(id, { localPath: imageFixture(`${id}.jpg`), publicPath: `/media/${id}.jpg` }));
  const chart = image("rendered-chart", { localPath: imageFixture("chart.png"), publicPath: "/media/chart.png", rights: "editorial-screenshot" });
  const fixture = memoryDependencies({ images: cached, extracted: [image("benchmark"), image("capability")], screenshots: [chart] });
  const result = await runVisualHydration("story-test", 2, fixture.dependencies, { scope: "article" });
  assert.equal(fixture.calls.extract, 1);
  assert.equal(fixture.calls.capture, 1);
  assert.equal(result.localReadyImageCount, 5);
  assert.equal(fixture.calls.generate, 0);
});

const page = (images: SourceImage[]): ExtractedPage => ({
  url: signal.url,
  canonicalUrl: signal.url,
  title: signal.title,
  text: "Example source text",
  images,
});

const memoryDependencies = (input: {
  signal?: StorySignalView;
  images?: SourceImage[];
  extracted?: SourceImage[];
  screenshots?: SourceImage[];
  searched?: SourceImage[];
  searchedRelated?: SourceImage[];
  generated?: SourceImage[];
  stylized?: SourceImage;
}) => {
  const sourceSignal = input.signal ?? signal;
  let images = input.images ?? [];
  const calls = { extract: 0, localize: 0, capture: 0, search: 0, stylize: 0, generate: 0, requested: [] as number[] };
  const dependencies: VisualHydrationDependencies = {
    getStory: async () => ({
      id: "story-test",
      title: signal.title,
      originalTitle: signal.title,
      summary: "Example story summary",
      images,
      signals: [sourceSignal],
    }),
    extract: async () => {
      calls.extract += 1;
      return page(input.extracted ?? []);
    },
    persistExtraction: async (_signal, extractedPage) => {
      images = mergeVisualImages(images, extractedPage.images);
    },
    persistImages: async (_signal, incoming) => {
      images = mergeVisualImages(images, incoming);
    },
    localize: async (source) => {
      calls.localize += 1;
      return {
        ...source,
        localPath: imageFixture(`${source.id}.jpg`),
        publicPath: `/media/story/${source.id}.jpg`,
      };
    },
    capture: async (_url, _assetRoot, requested) => {
      calls.capture += 1;
      calls.requested.push(requested);
      return input.screenshots ?? [];
    },
    searchOnline: async (_story, _requested, priority) => {
      calls.search += 1;
      return priority === 3 ? input.searched ?? [] : input.searchedRelated ?? [];
    },
    stylizeIdentity: async (source) => {
      calls.stylize += 1;
      return input.stylized ?? source;
    },
    generateFallback: async () => {
      calls.generate += 1;
      return input.generated ?? [];
    },
  };
  return { dependencies, calls, images: () => images };
};

test("two remote URLs do not satisfy local readiness and are downloaded", async () => {
  const memory = memoryDependencies({
    images: [image("remote-1"), image("remote-2")],
  });

  const result = await runVisualHydration("story-remote", 2, memory.dependencies);

  assert.equal(memory.calls.localize, 2);
  assert.equal(memory.calls.extract, 0);
  assert.equal(memory.calls.capture, 0);
  assert.equal(result.discoveredImageCount, 2);
  assert.equal(result.localReadyImageCount, 2);
  assert.equal(result.imageCount, 2);
  assert.equal(result.publishReadyImageCount, 0);
  assert.equal(result.rightsReviewImageCount, 2);
  assert.equal(memory.images().length, 2, "localized copies replace, rather than duplicate, remote records");
});

test("a community link with a verified external page participates in visual hydration", async () => {
  const linkedSignal: StorySignalView = {
    ...signal,
    sourceName: "Hacker News",
    sourceRole: "community",
    sourceType: "hackernews",
    isCommunity: true,
    factBearing: true,
    linkedSource: true,
    discussionUrl: "https://news.ycombinator.com/item?id=42",
  };
  const memory = memoryDependencies({
    signal: linkedSignal,
    images: [image("open-executive-demo", { sourceUrl: linkedSignal.url })],
  });

  const result = await runVisualHydration("story-linked-community", 1, memory.dependencies);

  assert.equal(memory.calls.localize, 1);
  assert.equal(result.localReadyImageCount, 1);
});

test("badge images never satisfy visual readiness or consume a download slot", async () => {
  const memory = memoryDependencies({
    images: [
      image("license-badge", { caption: "License: Apache 2.0" }),
      image("product-demo", { caption: "Open Executive 产品演示" }),
    ],
  });

  const result = await runVisualHydration("story-no-badges", 1, memory.dependencies);

  assert.equal(memory.calls.localize, 1);
  assert.equal(memory.images().some((entry) => entry.id === "product-demo" && Boolean(entry.localPath)), true);
  assert.equal(result.discoveredImageCount, 1);
});

test("online identity art keeps its real-source tier after editorial styling", async () => {
  const remotePortrait = image("commons-portrait", {
    editorialPriority: 3,
    editorialOrigin: "entity-library",
  });
  const styledPortrait = image("grounded-cover", {
    url: "/media/story/grounded-cover.png",
    localPath: imageFixture("grounded-cover.png"),
    publicPath: "/media/story/grounded-cover.png",
    caption: "资料封面：真实人物肖像（人物保持来源原貌）",
    editorialPriority: 3,
    editorialOrigin: "entity-library",
  });
  const memory = memoryDependencies({ searched: [remotePortrait], stylized: styledPortrait });

  await runVisualHydration("story-styled", 1, memory.dependencies);

  assert.equal(memory.calls.stylize, 1);
  assert.equal(memory.images()[0]?.id, "grounded-cover");
  assert.equal(memory.images()[0]?.editorialPriority, 3);
});

test("licensed online identity search runs after screenshots and before generated fallback", async () => {
  const commonsPortrait = image("commons-person", {
    url: "https://upload.wikimedia.org/person.jpg",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Person.jpg",
    attribution: "Example Photographer / Wikimedia Commons",
    rights: "licensed",
    licenseId: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modificationNote: "未修改。",
    allowedPlatforms: ["wechat", "xiaoheihe"],
    editorialPriority: 3,
    editorialOrigin: "entity-library",
  });
  const generated = image("generated", {
    localPath: imageFixture("generated.png"),
    publicPath: "/media/story/generated.png",
    rights: "owned",
    allowedPlatforms: ["*"],
    editorialPriority: 5,
    editorialOrigin: "generated-fallback",
  });
  const memory = memoryDependencies({ searched: [commonsPortrait], generated: [generated] });

  const result = await runVisualHydration("story-online", 2, memory.dependencies);

  assert.equal(memory.calls.capture, 1, "the source screenshot tier is exhausted first");
  assert.equal(memory.calls.search, 2, "identity and related search are separate real stages");
  assert.equal(memory.calls.generate, 0, "a real identity image suppresses synthetic filler");
  assert.equal(result.onlineSearchCount, 1);
  assert.equal(result.generatedCount, 0);
  assert.equal(memory.images()[0]?.editorialPriority, 3);
});

test("live generation runs only when source, screenshot and online search all return nothing", async () => {
  const generated = image("generated-last-resort", {
    url: "/media/story/generated-last-resort.png",
    localPath: imageFixture("generated-last-resort.png"),
    publicPath: "/media/story/generated-last-resort.png",
    caption: "系统生成议题封面（非事件现场）",
    rights: "owned",
    allowedPlatforms: ["*"],
    editorialPriority: 5,
    editorialOrigin: "generated-fallback",
  });
  const memory = memoryDependencies({ generated: [generated] });

  const result = await runVisualHydration("story-generate-last", 2, memory.dependencies);

  assert.equal(memory.calls.capture, 1);
  assert.equal(memory.calls.search, 2, "both grounded web tiers are exhausted before generation");
  assert.equal(memory.calls.generate, 1);
  assert.equal(result.generatedCount, 1);
  assert.equal(memory.images()[0]?.editorialPriority, 5);
});

test("visual hydration reports the editorial 1-to-5 search stages in order", async () => {
  const { dependencies } = memoryDependencies({
    extracted: [],
    screenshots: [],
    searched: [],
    generated: [image("generated", {
      localPath: imageFixture("generated-progress.png"),
      publicPath: "/media/story/generated-progress.png",
      editorialPriority: 5,
      editorialOrigin: "generated-fallback",
    })],
  });
  const stages: string[] = [];

  await runVisualHydration("story-test", 2, dependencies, {
    progress: (_value, stage) => stages.push(stage),
  });

  assert.deepEqual(stages, [
    "1/5 提取原新闻图片",
    "2/5 截取新闻页面",
    "3/5 搜索人物、公司与 Logo",
    "4/5 搜索事件相关素材并核对授权",
    "5/5 生成兜底封面（非新闻现场）",
  ]);
});

test("one locally extracted image satisfies a one-image target without screenshots", async () => {
  const extracted = image("extracted-local", {
    localPath: imageFixture("extracted-local.jpg"),
    publicPath: "/media/story/extracted-local.jpg",
    rights: "official",
  });
  const memory = memoryDependencies({ extracted: [extracted] });

  const result = await runVisualHydration("story-extracted", 1, memory.dependencies);

  assert.equal(memory.calls.extract, 1);
  assert.equal(memory.calls.localize, 0);
  assert.equal(memory.calls.capture, 0);
  assert.equal(result.localReadyImageCount, 1);
  assert.equal(result.publishReadyImageCount, 0);
  assert.equal(result.rightsReviewImageCount, 1, "official-source images still need a reuse-rights review");
});

test("rendered screenshot fallback fills only the missing local slot", async () => {
  const extracted = image("official-local", {
    localPath: imageFixture("official-local.jpg"),
    publicPath: "/media/story/official-local.jpg",
    rights: "official",
  });
  const screenshot = image("screenshot-local", {
    url: "/media/story/screenshot-local.png",
    localPath: imageFixture("screenshot-local.png"),
    publicPath: "/media/story/screenshot-local.png",
    rights: "editorial-screenshot",
    evidenceNote: "Rendered article excerpt",
  });
  const memory = memoryDependencies({ extracted: [extracted], screenshots: [screenshot] });

  const result = await runVisualHydration("story-screenshot", 2, memory.dependencies);

  assert.equal(memory.calls.extract, 1);
  assert.equal(memory.calls.capture, 1);
  assert.deepEqual(memory.calls.requested, [1]);
  assert.equal(result.screenshotCount, 1);
  assert.equal(result.localReadyImageCount, 2);
  assert.equal(result.publishReadyImageCount, 0);
  assert.equal(result.rightsReviewImageCount, 2, "official images and editorial screenshots still require rights review");
});

test("visual counts reject stale paths and require both platform permissions", () => {
  const deletedPath = imageFixture("deleted.jpg");
  rmSync(deletedPath);
  const migratedPath = process.platform === "win32"
    ? "/Users/old-mac/ai-news-desk/media/migrated.jpg"
    : "C:\\Users\\old-windows\\ai-news-desk\\media\\migrated.jpg";
  const counts = countVisualAssets([
    image("remote"),
    image("public-only", { publicPath: "/media/public-only.jpg" }),
    image("local-only", { localPath: imageFixture("local-only.jpg") }),
    image("deleted", { localPath: deletedPath, publicPath: "/media/deleted.jpg" }),
    image("migrated", { localPath: migratedPath, publicPath: "/media/migrated.jpg" }),
    image("expired", {
      localPath: imageFixture("expired.jpg"),
      publicPath: "/media/expired.jpg",
      rights: "expired",
    }),
    image("licensed-ready", {
      localPath: imageFixture("licensed-ready.jpg"),
      publicPath: "/media/licensed-ready.jpg",
      rights: "licensed",
      attribution: "Example Photographer / CC BY 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      evidenceNote: "Commons 文件页确认 CC BY 4.0。",
      licenseId: "CC-BY-4.0",
      licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
      modificationNote: "仅缩放，未裁切或调色。",
      allowedPlatforms: ["wechat", "xiaoheihe"],
    }),
    image("wechat-only", {
      localPath: imageFixture("wechat-only.jpg"),
      publicPath: "/media/wechat-only.jpg",
      rights: "owned",
      allowedPlatforms: ["wechat"],
    }),
  ]);

  assert.equal(counts.discoveredImageCount, 7, "expired images leave the editorial inventory entirely");
  assert.equal(counts.localReadyImageCount, 2);
  assert.equal(counts.publishReadyImageCount, 1);
  assert.equal(counts.rightsReviewImageCount, 1);
});

test("visual merge never aliases colliding IDs or shared CDN URLs across sources", () => {
  const first = image("collision", {
    url: "https://cdn.example.com/shared.jpg",
    sourceUrl: "https://publisher-a.example/story",
  });
  const idCollision = image("collision", {
    url: "https://cdn.example.com/other.jpg",
    sourceUrl: "https://publisher-b.example/story",
  });
  const cdnCollision = image("other-id", {
    url: first.url,
    sourceUrl: "https://publisher-c.example/story",
  });

  assert.equal(mergeVisualImages([first], [idCollision, cdnCollision]).length, 3);
});

test("localization can add paths without overwriting established rights provenance", () => {
  const existing = image("licensed", {
    url: "https://cdn.example.com/licensed.jpg",
    sourceUrl: "https://publisher.example/story",
    attribution: "Trusted Photographer",
    rights: "licensed",
    evidenceNote: "License reviewed by editor",
    evidencePath: "/evidence/license.txt",
    licenseId: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modificationNote: "No modification",
    allowedPlatforms: ["wechat", "xiaoheihe"],
    fingerprint: "a".repeat(64),
  });
  const localized = image("licensed", {
    url: existing.url,
    sourceUrl: "https://publisher.example/story/?utm_source=feed#hero",
    localPath: imageFixture("licensed-local.jpg"),
    publicPath: "/media/licensed-local.jpg",
    attribution: "Unknown scraper",
    rights: "check-required",
    evidenceNote: "untrusted replacement",
    evidencePath: "/tmp/untrusted.txt",
    licenseId: "proprietary",
    licenseUrl: "https://invalid.example/license",
    modificationNote: "unknown",
    allowedPlatforms: [],
    fingerprint: "b".repeat(64),
  });

  const merged = mergeVisualImages([existing], [localized]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.localPath, localized.localPath);
  assert.equal(merged[0]?.publicPath, localized.publicPath);
  assert.equal(merged[0]?.rights, "licensed");
  assert.equal(merged[0]?.attribution, "Trusted Photographer");
  assert.equal(merged[0]?.sourceUrl, "https://publisher.example/story");
  assert.equal(merged[0]?.evidenceNote, "License reviewed by editor");
  assert.equal(merged[0]?.evidencePath, "/evidence/license.txt");
  assert.equal(merged[0]?.licenseId, "CC-BY-4.0");
  assert.equal(merged[0]?.licenseUrl, "https://creativecommons.org/licenses/by/4.0/");
  assert.equal(merged[0]?.modificationNote, "No modification");
  assert.deepEqual(merged[0]?.allowedPlatforms, ["wechat", "xiaoheihe"]);
  assert.equal(merged[0]?.fingerprint, "a".repeat(64));
});

test("reading the page again cannot erase decoded local image dimensions", () => {
  const local = image("chart", { width: 2000, height: 1200, localPath: imageFixture("chart.webp"), publicPath: "/media/chart.webp" });
  const refreshed = image("chart", { width: undefined, height: undefined });
  const merged = mergeVisualImages([local], [refreshed]);
  assert.equal(merged[0]?.width, 2000);
  assert.equal(merged[0]?.height, 1200);
});

test("localizing or rereading a chart cannot erase its source caption and benchmark conditions", () => {
  const original = image("benchmark", { caption: "Latency benchmark; H100; batch size 1; 1K input tokens; median of 5 runs." });
  const reread = image("benchmark", { caption: "来源页面配图", localPath: imageFixture("benchmark.jpg"), publicPath: "/media/benchmark.jpg" });
  const [merged] = mergeVisualImages([original], [reread]);
  assert.equal(merged.caption, original.caption);
  assert.equal(merged.localPath, reread.localPath);
});

test("a known generic placeholder may be enriched with a real source caption", () => {
  const placeholder = image("benchmark", { caption: "原文图表 1" });
  const actual = image("benchmark", { caption: "GPT-4.1 latency benchmark; batch size 1." });
  assert.equal(mergeVisualImages([placeholder], [actual])[0].caption, actual.caption);
});

test("short source captions with test conditions are never treated as placeholders", () => {
  const original = image("benchmark", { caption: "batch=1" });
  assert.equal(mergeVisualImages([original], [image("benchmark", { caption: "Benchmark results" })])[0].caption, "batch=1");
});
