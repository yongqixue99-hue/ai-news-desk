import assert from "node:assert/strict";
import test from "node:test";
import { modelResearchTargetsFor } from "./model-release-research.js";

const urlsFor = (title: string) => modelResearchTargetsFor(title).map((target) => target.url);

test("Claude model releases preserve the existing hyphenated Platform Docs route", () => {
  const urls = urlsFor("Claude Fable 5.1 与 Mythos 5.1 发布");

  assert.ok(urls.includes("https://platform.claude.com/docs/en/models/fable-5-1/overview"));
  assert.ok(urls.includes("https://platform.claude.com/docs/en/about-claude/pricing"));
  assert.ok(urls.includes("https://artificialanalysis.ai/models/claude-fable-5-1"));
});

test("OpenAI model releases use the exact model card plus stable official catalog and changelog", () => {
  const targets = modelResearchTargetsFor("OpenAI 发布 GPT-5.6 Sol");

  assert.equal(targets.every((target) => target.vendor === "openai"), true);
  assert.ok(urlsFor("OpenAI 发布 GPT-5.6 Sol").includes(
    "https://developers.openai.com/api/docs/models/gpt-5.6-sol",
  ));
  assert.ok(targets.some((target) => target.url.endsWith("/api/docs/models") && target.role === "official"));
  assert.ok(targets.some((target) => target.url.endsWith("/api/docs/changelog") && target.role === "official"));
  assert.ok(targets.some((target) => target.url.endsWith("/api/docs/pricing") && target.role === "official"));
  assert.ok(targets.some((target) => target.url.includes("9624314-model-release-notes") && target.role === "official"));
  assert.ok(targets.some((target) => target.role === "research"));
});

test("Gemini model releases use Google's model catalog, changelog and pricing pages", () => {
  const targets = modelResearchTargetsFor("Google 发布 Gemini 3.7 Flash");
  const urls = targets.map((target) => target.url);

  assert.equal(targets.every((target) => target.vendor === "gemini"), true);
  assert.ok(urls.includes("https://ai.google.dev/gemini-api/docs/models"));
  assert.ok(urls.includes("https://ai.google.dev/gemini-api/docs/changelog"));
  assert.ok(urls.includes("https://ai.google.dev/gemini-api/docs/pricing"));
  assert.ok(urls.includes("https://deepmind.google/models/model-cards/"));
});

test("DeepSeek model releases use the official API news, model and pricing surfaces", () => {
  const targets = modelResearchTargetsFor("DeepSeek-V4-Pro 正式发布");
  const urls = targets.map((target) => target.url);

  assert.equal(targets.every((target) => target.vendor === "deepseek"), true);
  assert.ok(urls.includes("https://www.deepseek.com/"));
  assert.ok(urls.includes("https://api-docs.deepseek.com/updates/"));
  assert.ok(urls.includes("https://api-docs.deepseek.com/quick_start/pricing/"));
});

test("Qwen model releases use Qwen's official research surface and Alibaba Model Studio facts", () => {
  const targets = modelResearchTargetsFor("Qwen3.8-Max 模型发布");
  const urls = targets.map((target) => target.url);

  assert.equal(targets.every((target) => target.vendor === "qwen"), true);
  assert.ok(urls.includes("https://qwen.ai/research"));
  assert.ok(urls.includes("https://www.alibabacloud.com/help/en/model-studio/model-release-notes"));
  assert.ok(urls.includes("https://www.alibabacloud.com/help/en/model-studio/model-pricing"));
  assert.ok(urls.includes("https://www.alibabacloud.com/help/en/model-studio/models"));
});

test("ordinary non-model stories do not trigger broad vendor research", () => {
  assert.deepEqual(modelResearchTargetsFor("索尼音乐起诉一家 AI 公司"), []);
});
