import assert from "node:assert/strict";
import test from "node:test";

import { eligibleEditorialImage, planEditorialImagePlacements, uniqueEligibleEditorialImages } from "./editorial-image-policy.js";

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
