import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultAiSettings } from "../../server/defaults.js";
import { AISettingsPage } from "./AISettingsPage.js";

test("AI settings separates the low-cost completion engine from long-form Agent roles", () => {
  const markup = renderToStaticMarkup(createElement(AISettingsPage, {
    aiSettings: defaultAiSettings(),
    materials: [],
    onSaveProvider: async () => undefined,
    onTestProvider: async () => ({
      providerId: "deepseek",
      lastCheckedAt: "2026-09-03T00:00:00.000Z",
      status: "healthy" as const,
      latencyMs: 80,
      model: "deepseek-v4-flash",
      errorCategory: "none" as const,
      safeMessage: "连接正常",
    }),
    onSaveAgentRole: async () => undefined,
    onSaveCompletionProvider: async () => undefined,
    onSaveWritingReviewMode: async () => undefined,
    onSaveSkill: async () => undefined,
    onImportSkill: async () => undefined,
    onUploadMaterial: async () => undefined,
    onImportMaterial: async () => undefined,
    onDeleteMaterial: async () => undefined,
  }));

  assert.match(markup, /补全.*停顿后预测下一句或下一段/u);
  assert.match(markup, /DeepSeek/u);
  assert.match(markup, /用于补全/u);
  assert.match(markup, /本机受保护存储/u);
  assert.doesNotMatch(markup, /这台 Mac/u);
});
