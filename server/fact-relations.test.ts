import assert from "node:assert/strict";
import test from "node:test";
import { auditFrozenFactIntegrity } from "./frozen-fact-integrity.js";
const check = (text: string, ...facts: string[]) => auditFrozenFactIntegrity(text, facts.map(text => ({ text })));
for (const [name, fact, valid, invalid] of [
  ["price direction", "Nova Pro 的月费从 20 美元降至 10 美元。", "Nova Pro 的月费从 20 美元降至 10 美元。", "Nova Pro 的月费从 10 美元涨至 20 美元。"],
  ["comparison baseline", "GPT-5.5 比 GPT-5.4 快 20%。", "GPT-5.5 比 GPT-5.4 快 20%。", "GPT-5.4 比 GPT-5.5 快 20%。"],
  ["plan restriction", "导出功能仅限 Pro 套餐。", "导出功能仅限 Pro 套餐。", "导出功能面向所有用户开放。"],
  ["negation", "免费套餐不支持批量导出。", "免费套餐不支持批量导出。", "免费套餐支持批量导出。"],
  ["model version", "Gemini 3.8 Flash 的输入价格为 1 美元。", "Gemini 3.8 Flash 的输入价格为 1 美元。", "Gemini 3.7 Flash 的输入价格为 1 美元。"],
  ["conditions", "仅在缓存命中条件下，输入价格为 1 美元。", "仅在缓存命中条件下，输入价格为 1 美元。", "输入价格为 1 美元。"],
] as const) test(`relationship: ${name}`, () => { assert.equal(check(valid, fact).passed, true); assert.equal(check(invalid, fact).passed, false); });
test("asserting absence is not a contradictory positive claim", () => {
  assert.equal(check("尚未确认免费套餐支持批量导出。", "免费套餐不支持批量导出。").passed, true);
});
test("quantities stay attached to the model when both numbers occur in the package", () => {
  assert.equal(check("GPT-5.5 的输入价格为 2 美元。", "GPT-5.5 的输入价格为 1 美元。", "GPT-5.4 的输入价格为 2 美元。").passed, false);
});
