import assert from "node:assert/strict";
import test from "node:test";
import {
  inlineCompletionIdleDelay,
  inlineCompletionRetryDelay,
} from "./inline-completion-policy.js";

test("inline completion waits longer for an unstable short fragment", () => {
  assert.equal(inlineCompletionIdleDelay("这是"), 900);
  assert.equal(inlineCompletionIdleDelay("这段话还在输入中，需要继续组织"), 650);
});

test("inline completion predicts the next sentence or paragraph sooner after terminal punctuation", () => {
  assert.equal(inlineCompletionIdleDelay("DeepSeek 已公布模型价格。"), 380);
  assert.equal(inlineCompletionIdleDelay("The model is now available."), 380);
});

test("inline completion backs off much longer on rate limits than transient network failures", () => {
  assert.equal(inlineCompletionRetryDelay(new Error("HTTP 429: rate limit exceeded")), 60_000);
  assert.equal(inlineCompletionRetryDelay(new Error("X API 已限流")), 60_000);
  assert.equal(inlineCompletionRetryDelay(new Error("request timeout")), 10_000);
  assert.equal(inlineCompletionRetryDelay(new TypeError("fetch failed")), 5_000);
});
