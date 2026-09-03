import assert from "node:assert/strict";
import test from "node:test";
import { buildExternalWritingPrompt } from "./external-writing-bridge.js";
import type { ArticleDraft } from "./types.js";

const draft = {
  title: "模型更新",
  paragraphs: ["当前正文。"],
  take: "编辑判断。",
  bodyHtml: "<p>当前正文。</p>",
  sources: [{ label: "官方公告", url: "https://example.com/official", kind: "primary", verified: true }],
  factClaims: [
    { id: "fact-1", claim: "新模型今天发布。", status: "full-source", sourceUrl: "https://example.com/official", capturedAt: "2026-09-04T00:00:00Z" },
    { id: "fact-2", claim: "性能翻倍。", status: "unverified", capturedAt: "2026-09-04T00:00:00Z" },
  ],
  uncertainties: ["价格尚未确认"],
  writingBrief: { suggestedAngles: ["解释适用人群"], communityFocus: [] },
} as unknown as ArticleDraft;

test("external writing prompt carries the evidence boundary and current draft without image payloads", () => {
  const prompt = buildExternalWritingPrompt(draft);

  assert.match(prompt, /只使用.*事实账本/u);
  assert.match(prompt, /新模型今天发布/u);
  assert.match(prompt, /https:\/\/example\.com\/official/u);
  assert.match(prompt, /性能翻倍.*不可写成事实/u);
  assert.match(prompt, /价格尚未确认/u);
  assert.match(prompt, /当前正文/u);
  assert.match(prompt, /只返回.*完整正文/u);
  assert.doesNotMatch(prompt, /base64|data:image/u);
});
