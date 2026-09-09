import assert from "node:assert/strict";
import test from "node:test";

import { eligibleEditorialImage, planEditorialImagePlacements, uniqueEligibleEditorialImages } from "./editorial-image-policy.js";

test("a wide, shallow source chart is retained without accepting badges", () => {
  assert.equal(eligibleEditorialImage({ id: "latency", url: "https://example.com/latency.png", caption: "Latency comparison chart", width: 1200, height: 150 }), true);
  assert.equal(eligibleEditorialImage({ id: "badge", url: "https://example.com/badge.png", caption: "Version badge", width: 1200, height: 150 }), false);
});

test("repository badges can never become editorial images", () => {
  assert.equal(eligibleEditorialImage({
    id: "license",
    url: "https://img.shields.io/badge/license-Apache_2.0-blue.svg",
    caption: "License Apache 2.0",
    width: 800,
    height: 200,
  }), false);
  assert.equal(eligibleEditorialImage({
    id: "demo",
    url: "https://example.com/open-executive-demo.png",
    caption: "Open Executive 产品演示",
    width: 1200,
    height: 700,
  }), true);
  assert.equal(eligibleEditorialImage({
    id: "next",
    url: "https://example.com/next.svg",
    caption: "Next.js 15",
  }), false);
});

test("different GitHub URLs with the same visual description stay one editorial image", () => {
  const images = uniqueEligibleEditorialImages([
    {
      id: "repo-image",
      url: "https://repository-images.githubusercontent.com/1/hero",
      sourceUrl: "https://github.com/example/repo",
      caption: "GitHub - example/repo: Open source AI executive team",
    },
    {
      id: "open-graph",
      url: "https://opengraph.githubassets.com/hash/example/repo",
      sourceUrl: "https://github.com/example/repo",
      caption: "GitHub - example/repo: Open source AI executive team",
    },
  ]);

  assert.deepEqual(images.map((image) => image.id), ["repo-image"]);
});

test("responsive WordPress sizes of the same source image stay one editorial image", () => {
  const images = uniqueEligibleEditorialImages([
    {
      id: "eu-flag-1152",
      url: "https://cdn.arstechnica.net/wp-content/uploads/2022/03/getty-eu-flag-1152x648.jpg",
      sourceUrl: "https://arstechnica.com/tech-policy/example-story/",
      caption: "https://www.ft.com/content/example",
    },
    {
      id: "eu-flag-1536",
      url: "https://cdn.arstechnica.net/wp-content/uploads/2022/03/getty-eu-flag-1536x864.jpg",
      sourceUrl: "https://arstechnica.com/tech-policy/example-story/",
      caption: "A European Union flag blowing in the wind.",
    },
  ]);

  assert.deepEqual(images.map((image) => image.id), ["eu-flag-1536"]);
});

test("different screenshot URLs with the same SHA-256 stay one editorial image", () => {
  const fingerprint = "5ae558cb237fe2d200d86834267a8e3de2ea6d8744d4165d442863b419d2d882";
  const images = uniqueEligibleEditorialImages([
    {
      id: "chatgpt-ads-page",
      url: "/media/chatgpt-ads-page.png",
      sourceUrl: "https://openai.com/index/testing-ads-in-chatgpt/",
      caption: "来源网页首屏截图",
      fingerprint,
    },
    {
      id: "chatgpt-ads-og",
      url: "/media/chatgpt-ads-og.png",
      sourceUrl: "https://openai.com/index/testing-ads-in-chatgpt/",
      caption: "来源网页首屏截图",
      fingerprint,
    },
  ]);

  assert.deepEqual(images.map((image) => image.id), ["chatgpt-ads-page"]);
});

test("a chart-rich source cannot become a text-only draft when the model selects no images", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [
      {
        id: "openrouter-ranking",
        url: "https://example.com/openrouter-ranking.png",
        width: 1400,
        height: 760,
        caption: "OpenRouter 与 OpenCode 模型使用量排名",
      },
      {
        id: "intelligence-index",
        url: "https://example.com/intelligence-index.png",
        width: 1600,
        height: 900,
        caption: "Artificial Analysis Intelligence Index 性价比曲线",
      },
      {
        id: "zai-logo",
        url: "https://example.com/zai-logo.png",
        width: 128,
        height: 128,
        caption: "Z.ai logo",
      },
    ],
    modelSelections: [],
    paragraphs: [
      "Z.ai 发布 GLM-5.3-Flash。",
      "模型在 OpenRouter 和 OpenCode 上获得了较高使用量。",
      "新模型降低了推理成本。",
      "Artificial Analysis 给出了性能与价格数据。",
      "后续还需要观察真实工具链表现。",
    ],
    imageLimit: 4,
  });

  assert.deepEqual(
    placements.map(({ imageId, afterParagraph }) => ({ imageId, afterParagraph })),
    [
      { imageId: "openrouter-ranking", afterParagraph: 1 },
      { imageId: "intelligence-index", afterParagraph: 3 },
    ],
  );
});

test("lower-priority model choices cannot displace original images, screenshots or entity assets", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [
      { id: "article", url: "https://publisher.example/hero.jpg", caption: "原新闻事件现场", editorialPriority: 1 },
      { id: "screenshot", url: "/media/article-page.png", caption: "原文页面截图", editorialPriority: 2 },
      { id: "entity", url: "/materials/sony-music.png", caption: "Sony Music 公司资料图", editorialPriority: 3 },
      { id: "related", url: "/materials/music-rights.png", caption: "音乐版权资料图", editorialPriority: 4 },
      { id: "generated", url: "/materials/generated-ai.png", caption: "AI 生成示意图", editorialPriority: 5 },
    ],
    modelSelections: [
      { imageId: "generated", afterParagraph: 0, caption: "生成图" },
      { imageId: "related", afterParagraph: 1, caption: "相关图" },
      { imageId: "article", afterParagraph: 2, caption: "原图" },
    ],
    paragraphs: ["第一段", "第二段", "第三段", "第四段"],
    imageLimit: 3,
  });

  assert.deepEqual(placements.map((placement) => placement.imageId), [
    "article",
    "screenshot",
    "entity",
  ]);
});

test("explicit relevant source charts are not displaced or padded with unrelated article illustrations", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [
      { id: "radar", url: "https://publisher.example/radar.png", caption: "Magellan radar", editorialPriority: 1 },
      { id: "altimetry", url: "https://publisher.example/altimetry.png", caption: "Altimetry footprint", editorialPriority: 1 },
      { id: "cost", url: "/media/cost.png", caption: "Indexed cost of model usage", editorialPriority: 2 },
    ],
    modelSelections: [{ imageId: "cost", afterParagraph: 2, caption: "官方提供的任务成本对比，测试条件见原图。" }],
    paragraphs: ["新模型上线。", "两种访问范围。", "缓存读取价格降低。", "企业客户可以申请。"],
    imageLimit: 5,
  });
  assert.deepEqual(placements.map((image) => image.imageId), ["cost"]);
  assert.equal(placements[0]?.afterParagraph, 2);
});

test("frozen package asset IDs resolve to source image IDs before ranking selected charts", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [
      { id: "radar", url: "https://publisher.example/radar.png", caption: "Magellan radar", editorialPriority: 1 },
      { id: "cost", url: "/media/cost.png", caption: "Indexed cost of model usage", editorialPriority: 2 },
    ],
    imageAliases: { asset_cost: "cost" },
    modelSelections: [{ imageId: "asset_cost", afterParagraph: 1, caption: "官方提供的缓存读取成本对比。" }],
    paragraphs: ["发布两种模型。", "缓存读取降低了成本。", "接入条件。"], imageLimit: 4,
  });
  assert.deepEqual(placements, [{ imageId: "cost", afterParagraph: 1, caption: "Indexed cost of model usage" }]);
});

test("model caption suggestions cannot erase source benchmark conditions or add unverified chart conclusions", () => {
  const sourceCaption = "GPT-4.1 latency benchmark; H100, batch size 1, 1K input tokens, median of 5 runs.";
  const placements = planEditorialImagePlacements({
    availableImages: [{ id: "benchmark", url: "https://example.com/latency.png", caption: sourceCaption, editorialPriority: 1 }],
    modelSelections: [{ imageId: "benchmark", afterParagraph: 0, caption: "GPT-4.1 在所有任务上快 10 倍。" }],
    paragraphs: ["GPT-4.1 已经发布。", "测试覆盖指定硬件与任务，不能直接代表所有场景。"], imageLimit: 1,
  });
  assert.equal(placements[0]?.caption, sourceCaption);
});

test("generic source captions do not authorize invented OCR numbers", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [{ id: "source-chart", url: "/media/chart.png", caption: "原文图表 1", editorialPriority: 2 }],
    modelSelections: [{ imageId: "source-chart", afterParagraph: 0, caption: "从图中可知新模型得分 92.6%，全面超过人类。" }],
    paragraphs: ["官方提供了评测图表，具体测试条件仍需核对。"], imageLimit: 1,
  });
  assert.equal(placements[0]?.caption, "原文图表 1");
});

test("an older model chart cannot be automatically inserted into an article that only discusses the new version", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [{ id: "old-chart", url: "https://example.com/chart.png", caption: "GPT-4.1 latency benchmark", editorialPriority: 1 }],
    modelSelections: [{ imageId: "old-chart", afterParagraph: 0, caption: "新版本测试结果" }],
    paragraphs: ["GPT-5 正式发布。", "本文介绍 GPT5 的 API 接入方式。"], imageLimit: 2,
  });
  assert.deepEqual(placements, []);
});

test("a valid old-versus-new discussion keeps the old chart beside the paragraph about that version", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [{ id: "old-chart", url: "https://example.com/chart.png", caption: "GPT-4.1 latency benchmark", editorialPriority: 1 }],
    modelSelections: [{ imageId: "old-chart", afterParagraph: 0, caption: "新版本测试结果" }],
    paragraphs: ["GPT-5 已经上线。", "回顾 GPT 4.1 的 latency benchmark，需要保留此前测试条件。"], imageLimit: 1,
  });
  assert.equal(placements[0]?.afterParagraph, 1);
  assert.equal(placements[0]?.caption, "GPT-4.1 latency benchmark");
});

test("version punctuation aliases stay compatible and a multi-model comparison chart remains eligible", () => {
  const placements = planEditorialImagePlacements({
    availableImages: [{ id: "comparison", url: "https://example.com/chart.png", caption: "Qwen 2.5 and Qwen3 benchmark comparison", editorialPriority: 1 }],
    modelSelections: [], paragraphs: ["Qwen-3 的发布资料包含多模型评测比较。"], imageLimit: 1,
  });
  assert.equal(placements[0]?.imageId, "comparison");
});
