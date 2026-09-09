import assert from "node:assert/strict";
import test from "node:test";
import { defaultHomeLayout, homeLayoutFor, matchesHomeKeyword, parseHomeLayout } from "./home-layout.js";

test("custom columns keep their order, source, keyword, and draft visibility", () => {
  const input = { columns: [{ id: "custom-code", label: " AI 编程 ", source: "news", keyword: " Codex " }, defaultHomeLayout.columns[1]], showDrafts: false };
  const result = parseHomeLayout(input);
  assert.deepEqual(result.columns.map((column) => column.id), ["custom-code", "zhihu"]);
  assert.equal(result.columns[0]?.keyword, "Codex");
  assert.equal(result.columns[0]?.label, "AI 编程");
  assert.equal(result.showDrafts, false);
  assert.deepEqual(homeLayoutFor(JSON.parse(JSON.stringify(result))), result);
});
test("invalid layouts cannot remove all navigation or introduce unimplemented sources", () => {
  for (const columns of [[], [{ id: "unknown", label: "unknown", source: "weibo" }], [defaultHomeLayout.columns[0], defaultHomeLayout.columns[0]], Array.from({ length: 13 }, (_, index) => ({ id: `col-${index}`, label: "news", source: "news" }))]) {
    assert.throws(() => parseHomeLayout({ columns, showDrafts: true }));
  }
  const fallback = homeLayoutFor(null); fallback.columns.pop();
  assert.equal(defaultHomeLayout.columns.length, 5, "fallback mutations cannot change presets");
});
test("keywords normalize case and full-width text without regex execution", () => {
  assert.equal(matchesHomeKeyword(["ＣＯＤＥＸ 发布", "AI 编程"], "codex"), true);
  assert.equal(matchesHomeKeyword(["some unrelated article"], "Codex"), false);
  assert.equal(matchesHomeKeyword(["Codex"], ".*"), false);
});
