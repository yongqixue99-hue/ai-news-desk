import assert from "node:assert/strict";
import test from "node:test";
import { publisherBlockingGuidance } from "./publisher-guidance.js";
import type { PublisherPreflightResult } from "./types.js";

test("publish guidance names every current blocker instead of saying only unavailable", () => {
  const preflight = {
    canQueueFill: false,
    blocking: [
      { message: "填入助手未连接" },
      { message: "标题 41 字，超过平台 30 字上限" },
      { message: "图片：未确认允许用于 xiaoheihe" },
    ],
  } as PublisherPreflightResult;

  assert.equal(
    publisherBlockingGuidance(preflight),
    "暂不能填入：填入助手未连接；标题 41 字，超过平台 30 字上限；图片：未确认允许用于 xiaoheihe。",
  );
});
