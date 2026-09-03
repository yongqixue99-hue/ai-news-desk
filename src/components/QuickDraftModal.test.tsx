import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import { QuickDraftModal } from "./QuickDraftModal.js";
import type { IntakeReviewRecord } from "../types.js";

test("quick draft offers a free manual X-post intake that does not call the X API", () => {
  const state = createDefaultState();
  const provider = state.aiSettings.providers.find((entry) => entry.kind === "codex-cli")!;
  const markup = renderToStaticMarkup(createElement(QuickDraftModal, {
    provider,
    onClose: () => undefined,
    onOpenAiSettings: () => undefined,
    onSubmitUrl: async () => state.intakeReviews[0]!,
    onSubmitXPost: async () => state.intakeReviews[0]!,
    onSubmitScreenshot: async () => state.intakeReviews[0]!,
    onConfirmReview: async () => undefined,
  }));

  assert.match(markup, /X 原帖/u);
  assert.match(markup, /不调用计费 X API/u);
  assert.match(markup, /只填链接即可/u);
  assert.match(markup, /官方 oEmbed/u);
  assert.match(markup, /粘贴帖子正文/u);
});

test("quick draft opens an extension-captured X post directly in evidence review", () => {
  const state = createDefaultState();
  const provider = state.aiSettings.providers.find((entry) => entry.kind === "codex-cli")!;
  const initialReview: IntakeReviewRecord = {
    id: "review-x-1",
    createdAt: "2026-09-04T08:00:00.000Z",
    updatedAt: "2026-09-04T08:00:00.000Z",
    status: "pending",
    bundle: {
      id: "evidence-x-1",
      method: "link-extractor",
      capturedAt: "2026-09-04T08:00:00.000Z",
      title: "@OpenAI 的 X 原帖",
      source: {
        kind: "url",
        label: "X 原帖",
        requestedUrl: "https://x.com/OpenAI/status/1234567890",
        canonicalUrl: "https://x.com/OpenAI/status/1234567890",
        rawTextAvailable: true,
      },
      cleanedTextBlocks: [{ id: "text-1", text: "这是由浏览器助手收录的公开原帖正文。", kind: "paragraph", origin: "extractor" }],
      noiseBlocks: [],
      imageCandidates: [],
      warnings: ["账号身份与上下文需要核对。"],
    },
  };
  const markup = renderToStaticMarkup(createElement(QuickDraftModal, {
    provider,
    initialReview,
    onClose: () => undefined,
    onOpenAiSettings: () => undefined,
    onSubmitUrl: async () => initialReview,
    onSubmitXPost: async () => initialReview,
    onSubmitScreenshot: async () => initialReview,
    onConfirmReview: async () => undefined,
  }));

  assert.match(markup, /复核提取证据/u);
  assert.match(markup, /这是由浏览器助手收录的公开原帖正文/u);
  assert.match(markup, /确认证据并生成草稿/u);
  assert.doesNotMatch(markup, /粘贴帖子正文/u);
});
