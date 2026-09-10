import test from "node:test";
import assert from "node:assert/strict";
import { confirmationTextDiff } from "./confirmation-diff";

test("confirmation diff preserves unchanged paragraphs and aligns removed limitations visibly", () => {
  assert.deepEqual(confirmationTextDiff("标题\n仅限测试用户\n结尾", "标题\n已开放使用\n结尾"), [
    { kind: "same", text: "标题" }, { kind: "removed", text: "仅限测试用户" }, { kind: "added", text: "已开放使用" }, { kind: "same", text: "结尾" },
  ]);
});
