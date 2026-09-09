import assert from "node:assert/strict";
import test from "node:test";
import { assessEditorialOpportunity } from "./newsworthiness.js";

// Hand-labelled synthetic cases test routing boundaries, not live-event recall.
const cases = [
  ["Aster releases Model 2 with a public API", "important"],
  ["Nebula cuts inference pricing by half", "important"],
  ["Orion launches a new GPU chip", "important"],
  ["开发商开放模型权重", "important"],
  ["云服务发生数据泄露", "important"],
  ["Maintainers patch a security vulnerability", "important"],
  ["Acme announces new API pricing", "important"],
  ["Product service outage affects account access", "important"],
  ["How I built an offline coding assistant", "interesting"],
  ["Porting a 1993 Amiga game to Godot", "interesting"],
  ["I tested a small model on an old laptop", "interesting"],
  ["用树莓派制作离线语音助手", "interesting"],
  ["A hands-on benchmark of local inference", "interesting"],
  ["复现老游戏里的守卫行为", "interesting"],
  ["Join our AI webinar: register now", "routine"],
  ["Weekly roundup: model releases and pricing", "routine"],
  ["The Download: drones and AI language", "routine"],
  ["AI software nightly build", "routine"],
  ["Rumored model may launch tomorrow", "routine"],
  ["A CEO says AI is the future", "routine"],
  ["Nvidia buys Hugging Face for $13 billion", "important"],
  ["Paying users locked out after a model rollout", "important"],
  ["Set up OpenAI Codex with LiteLLM on Amazon ECS", "interesting"],
  ["Which tools do coding agents choose? We measured 17k runs", "interesting"],
  ["Show HN: Reactor Atlas", "interesting"],
  ["[分享创造] 一个免 API Key 的 AI 开源工具", "interesting"],
  ["Formalizing Fermat's Last Theorem", "interesting"],
  ["Virtual Claude Coworkshop", "routine"],
] as const;

for (const [title, expected] of cases) test(`editorial selection: ${title}`, () => {
  assert.equal(assessEditorialOpportunity(title).lane, expected);
});

test("a loud registration page cannot borrow importance from its excerpt", () => {
  assert.equal(assessEditorialOpportunity("Join our AI webinar", "Major model release, API prices, a data breach").lane, "routine");
});

test("a client patch for a complete CVE identifier is consequential despite its small version", () => {
  assert.equal(assessEditorialOpportunity("OpenAI API client v1.2.3 patches CVE-2026-12345").lane, "important");
});

test("a monthly news recap cannot promote model releases mentioned in its body", () => {
  assert.equal(assessEditorialOpportunity("The latest AI news we announced in August 2026", "Google released Gemini models and API pricing updates.", { official: true }).lane, "routine");
});

test("confirmed security incidents are not rumors merely because data leaked", () => {
  assert.equal(assessEditorialOpportunity("OpenAI patches vulnerability that leaked ChatGPT user data").lane, "important");
  assert.equal(assessEditorialOpportunity("OpenAI confirms data breach after leaked API keys").lane, "important");
});
