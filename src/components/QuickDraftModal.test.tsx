import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import { QuickDraftModal } from "./QuickDraftModal.js";

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
  assert.match(markup, /不调用 X API/u);
  assert.match(markup, /粘贴帖子正文/u);
});
