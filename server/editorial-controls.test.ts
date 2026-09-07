import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { completionAvailability, editorialProfileForWriting } from "./editorial-controls.js";
import { buildInlineCompletionPrompt } from "./inline-completion.js";
import type { ContentPackage } from "./product-types.js";

test("saved profile is frozen into writing context only while enabled", () => {
  const state = createDefaultState();
  assert.equal(editorialProfileForWriting(state), undefined);
  state.editorialSystem.profile.positioning = "用实际变化吸引读者";
  state.editorialSystem.profile.audience = "普通 AI 读者";
  const snapshot = editorialProfileForWriting(state)!;
  state.editorialSystem.profile.positioning = "后续修改";
  assert.equal(snapshot.positioning, "用实际变化吸引读者");
  state.settings.editorialProfileEnabled = false;
  assert.equal(editorialProfileForWriting(state), undefined);
  assert.equal(state.editorialSystem.profile.positioning, "后续修改");
});

test("completion availability honors the actual X/Gemini spending scope and global completion switch", () => {
  const state = createDefaultState();
  state.aiSettings.completionProviderId = "deepseek";
  state.aiSettings.providers.find((provider) => provider.id === "deepseek")!.apiKeyConfigured = true;
  state.settings.spendingPolicy = "zero-cost";
  assert.equal(completionAvailability(state.settings, state.aiSettings).ready, true);
  state.settings.inlineCompletionEnabled = false;
  assert.match(completionAvailability(state.settings, state.aiSettings).reason, /已关闭/u);
  state.settings.inlineCompletionEnabled = true;
  state.aiSettings.completionProviderId = "gemini";
  state.aiSettings.providers.find((provider) => provider.id === "gemini")!.apiKeyConfigured = true;
  assert.equal(completionAvailability(state.settings, state.aiSettings).ready, false);
  state.settings.spendingPolicy = "allow-metered";
  assert.equal(completionAvailability(state.settings, state.aiSettings).ready, true);
});

test("completion prompt separates user voice from evidence", () => {
  const state = createDefaultState();
  state.editorialSystem.profile.audience = "第一次了解模型的读者";
  const contentPackage = { title: "样本", mode: "brief", intent: "news", facts: [], sources: [], uncertainties: [], suggestedAngles: [] } as unknown as ContentPackage;
  const prompt = buildInlineCompletionPrompt({ contentPackage, title: "样本", before: "已知的信息是", editorialProfile: editorialProfileForWriting(state), writingGuidelines: ["缩短导语"] });
  assert.match(prompt.user, /第一次了解模型的读者/u);
  assert.match(prompt.user, /仅组织语言，不是事实/u);
  assert.match(prompt.system, /不得创造数字/u);
});
