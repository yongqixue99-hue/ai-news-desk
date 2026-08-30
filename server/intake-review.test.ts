import assert from "node:assert/strict";
import test from "node:test";
import {
  assertEvidenceReadyForDraft,
  buildLinkEvidenceBundle,
  buildScreenshotEvidenceBundle,
  normalizeEvidenceSelection,
} from "./intake-review.js";

test("link intake preserves source evidence and only normalizes the editor's selected blocks", () => {
  const bundle = buildLinkEvidenceBundle({
    sourceUrl: "https://example.com/news/ai-chip",
    canonicalUrl: "https://example.com/news/ai-chip?canonical=1",
    title: "AI chip launch",
    rawSourceText: "Navigation\nAI chip launch\nFirst verified fact.\nSecond verified fact.",
    extractedText: "First verified fact.\n\nSecond verified fact.",
    removedNoise: [{ text: "Navigation", reason: "navigation" }],
    images: [{
      id: "hero",
      url: "https://example.com/hero.jpg",
      caption: "Launch photo",
      sourceUrl: "https://example.com/news/ai-chip",
      selected: true,
    }],
    capturedAt: "2026-08-13T01:02:03.000Z",
  });

  assert.equal(bundle.method, "link-extractor");
  assert.equal(bundle.source.requestedUrl, "https://example.com/news/ai-chip");
  assert.equal(bundle.source.canonicalUrl, "https://example.com/news/ai-chip?canonical=1");
  assert.equal(bundle.source.rawText, "Navigation\nAI chip launch\nFirst verified fact.\nSecond verified fact.");
  assert.deepEqual(bundle.cleanedTextBlocks.map((block) => block.text), [
    "First verified fact.",
    "Second verified fact.",
  ]);
  assert.deepEqual(bundle.noiseBlocks.map((block) => [block.text, block.reason]), [
    ["Navigation", "navigation"],
  ]);

  const normalized = normalizeEvidenceSelection(bundle, {
    confirmedAt: "2026-08-13T01:05:00.000Z",
    excludedTextBlockIds: [bundle.cleanedTextBlocks[1].id],
    includedImageIds: [bundle.imageCandidates[0].id],
  });

  assert.equal(normalized.text, "First verified fact.");
  assert.deepEqual(normalized.images.map((image) => image.id), [bundle.imageCandidates[0].id]);
  assert.equal(normalized.review.status, "confirmed");
  assert.deepEqual(normalized.review.excludedTextBlockIds, [bundle.cleanedTextBlocks[1].id]);
});

test("screenshot intake preserves only explicit vision output and its real crop candidates", () => {
  const bundle = buildScreenshotEvidenceBundle({
    fileName: "screen.png",
    sourceAssetPath: "/data/media/draft/screen.png",
    sourcePublicPath: "/media/draft/screen.png",
    title: "模型发布截图",
    extractedText: "官方宣布模型上线。\n\n基准成绩为截图所示。",
    ignoredElements: [
      { text: "登录", reason: "authentication" },
      "相关推荐",
    ],
    imageRegions: [{
      id: "benchmark-region",
      x: 120,
      y: 300,
      width: 740,
      height: 420,
      caption: "基准测试图表",
      publicPath: "/media/draft/benchmark.webp",
      selected: true,
    }],
    capturedAt: "2026-08-13T02:00:00.000Z",
  });

  assert.equal(bundle.method, "screenshot-vision");
  assert.equal(bundle.source.assetPath, "/data/media/draft/screen.png");
  assert.equal(bundle.source.publicPath, "/media/draft/screen.png");
  assert.deepEqual(bundle.cleanedTextBlocks.map((block) => block.text), [
    "官方宣布模型上线。",
    "基准成绩为截图所示。",
  ]);
  assert.deepEqual(bundle.noiseBlocks.map((block) => [block.text, block.reason]), [
    ["登录", "authentication"],
    ["相关推荐", "upstream-identified-noise"],
  ]);
  assert.deepEqual(bundle.imageCandidates[0].region, {
    x: 120,
    y: 300,
    width: 740,
    height: 420,
    coordinateSystem: "normalized-1000",
  });
  assert.equal(bundle.imageCandidates[0].publicPath, "/media/draft/benchmark.webp");
});

test("draft generation is gated until screenshot evidence is confirmed and contains real extracted text", () => {
  const bundleWithoutOcr = buildScreenshotEvidenceBundle({
    fileName: "unknown.png",
    sourceAssetPath: "/data/media/unknown.png",
    capturedAt: "2026-08-13T03:00:00.000Z",
  });

  assert.match(bundleWithoutOcr.warnings.join(" "), /未自行补写截图内容/);
  assert.throws(
    () => assertEvidenceReadyForDraft(normalizeEvidenceSelection(bundleWithoutOcr, {})),
    /用户确认/,
  );
  assert.throws(
    () => assertEvidenceReadyForDraft(normalizeEvidenceSelection(bundleWithoutOcr, {
      confirmedAt: "2026-08-13T03:01:00.000Z",
    })),
    /可用正文/,
  );
});

test("pre-segmented extractor blocks keep their editorial type and order", () => {
  const bundle = buildLinkEvidenceBundle({
    sourceUrl: "https://example.com/segmented",
    title: "Segmented article",
    extractedText: "Heading Body Quote",
    cleanedTextBlocks: [
      { text: "Heading", kind: "heading" },
      { text: "Body", kind: "paragraph" },
      { text: "Quote", kind: "quote" },
    ],
    capturedAt: "2026-08-13T04:00:00.000Z",
  });

  assert.deepEqual(bundle.cleanedTextBlocks.map((block) => [block.kind, block.text]), [
    ["heading", "Heading"],
    ["paragraph", "Body"],
    ["quote", "Quote"],
  ]);
});
