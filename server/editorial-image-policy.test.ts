import assert from "node:assert/strict";
import test from "node:test";

import { planEditorialImagePlacements } from "./editorial-image-policy.js";

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
