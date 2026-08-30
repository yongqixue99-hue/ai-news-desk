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
