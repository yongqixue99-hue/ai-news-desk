import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftQualityView } from "./draft-quality-view.js";
import type { DraftQualityWarning } from "./types.js";

test("draft quality view separates repairable findings into editorial dimensions", () => {
  const warnings: DraftQualityWarning[] = [
    {
      id: "brief-underdeveloped",
      message: "正文解释不足。",
      blockId: "evidence",
      dimension: "content-completeness",
    },
    {
      id: "image-coverage-missing",
      message: "还缺一张相关原图。",
      blockId: "images",
      dimension: "images-rights",
    },
  ];

  const view = buildDraftQualityView(warnings);

  assert.deepEqual(view.dimensions.map(({ id, count, state }) => ({ id, count, state })), [
    { id: "fact-safety", count: 0, state: "passed" },
    { id: "content-completeness", count: 1, state: "warning" },
    { id: "images-rights", count: 1, state: "warning" },
    { id: "writing-quality", count: 0, state: "passed" },
  ]);
  assert.equal(view.nextTab, "images");
  assert.equal(view.headline, "草稿已保留，还有 2 项可以完善");
});

test("content coverage warnings expose the exact repair scope instead of a generic rewrite", () => {
  const view = buildDraftQualityView([{
    id: "brief-underdeveloped",
    message: "正文覆盖不足。",
    blockId: "evidence",
    dimension: "content-completeness",
    factCoverage: {
      usedFactIds: ["fact-1", "fact-2", "fact-3"],
      unusedFactIds: ["fact-4", "fact-5"],
      supportedFactCount: 5,
      ratio: 0.6,
    },
    missingDimensions: ["impact", "limitations"],
  }]);

  assert.equal(view.nextTab, "agent");
  assert.equal(view.actionKind, "quality-repair");
  assert.match(view.detail, /3\/5/);
  assert.match(view.detail, /影响或后果/);
  assert.match(view.detail, /限制与未知/);
});
