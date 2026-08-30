import assert from "node:assert/strict";
import test from "node:test";
import { rememberRecentValues } from "./publishing-memory.js";

test("successful publication metadata is deduplicated by recency", () => {
  assert.deepEqual(
    rememberRecentValues(["ChatGPT", "OpenAI", "Claude"], [" openai ", "AI 人工智能"], 4),
    ["openai", "AI 人工智能", "ChatGPT", "Claude"],
  );
});

test("publication metadata keeps only the configured recent limit", () => {
  assert.deepEqual(
    rememberRecentValues(["四", "五", "六"], ["一", "二", "三"], 5),
    ["一", "二", "三", "四", "五"],
  );
});
