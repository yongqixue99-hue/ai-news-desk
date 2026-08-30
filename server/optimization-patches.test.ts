import assert from "node:assert/strict";
import test from "node:test";
import { applyOptimizationChanges } from "../src/optimization-patches.js";
import type { ArticleOptimizationChange } from "./types.js";

const change = (
  value: Partial<ArticleOptimizationChange> & Pick<ArticleOptimizationChange, "id" | "blockId" | "before" | "after">,
): ArticleOptimizationChange => ({
  reason: "说清具体动作",
  affectedFactIds: [],
  factCheckPassed: true,
  factWarnings: [],
  ...value,
});

test("editor applies only accepted blocks and preserves untouched prose", () => {
  const result = applyOptimizationChanges({
    title: "旧标题",
    paragraphs: ["第一段保持不动。", "第二段说得比较空。"],
    take: "原结尾。",
  }, [
    change({ id: "title-1", blockId: "title", before: "旧标题", after: "新标题" }),
    change({ id: "p-2", blockId: "paragraph:1", before: "第二段说得比较空。", after: "第二段补充了产品开放日期。" }),
  ]);

  assert.deepEqual(result.draft, {
    title: "新标题",
    paragraphs: ["第一段保持不动。", "第二段补充了产品开放日期。"],
    take: "原结尾。",
  });
  assert.deepEqual(result.appliedIds, ["title-1", "p-2"]);
  assert.deepEqual(result.conflicts, []);
});

test("editor refuses stale or fact-unsafe changes", () => {
  const result = applyOptimizationChanges({
    title: "用户刚改过的标题",
    paragraphs: ["价格下调 30%。"],
    take: "",
  }, [
    change({ id: "stale", blockId: "title", before: "旧标题", after: "模型标题" }),
    change({
      id: "unsafe",
      blockId: "paragraph:0",
      before: "价格下调 30%。",
      after: "价格有所调整。",
      factCheckPassed: false,
      factWarnings: ["缺少事实锚点：30%"],
    }),
  ], { safeOnly: true });

  assert.equal(result.draft.title, "用户刚改过的标题");
  assert.equal(result.draft.paragraphs[0], "价格下调 30%。");
  assert.deepEqual(result.appliedIds, []);
  assert.deepEqual(result.conflicts.map((item) => item.id), ["stale", "unsafe"]);
});
