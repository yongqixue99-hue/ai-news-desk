import assert from "node:assert/strict";
import test from "node:test";
import {
  applySpendingPolicy,
  assertMeteredProviderAllowed,
  assertMeteredSourceAllowed,
  meteredAutomationAllowed,
} from "./spending-policy.js";

test("zero-cost mode blocks X and Gemini while preserving DeepSeek and other configured providers", () => {
  const state = {
    settings: { spendingPolicy: "allow-metered" },
    aiSettings: {
      activeProviderId: "deepseek",
      completionProviderId: "deepseek",
      analysisProviderId: "gemini",
      optimizationProviderId: "deepseek",
      providers: [
        { id: "codex-cli", kind: "codex-cli", apiKeyConfigured: true },
        { id: "deepseek", kind: "openai-compatible", apiKeyConfigured: true, apiKeyHint: "sk-…1234" },
        { id: "gemini", kind: "openai-compatible", apiKeyConfigured: true, apiKeyHint: "AIza…5678" },
      ],
    },
    sources: [
      { id: "x-ai-official", kind: "x", enabled: true, selected: true },
      { id: "openai-official", kind: "rss", enabled: true, selected: true },
    ],
  } as any;

  const result = applySpendingPolicy(state, "zero-cost");

  assert.equal(state.settings.spendingPolicy, "zero-cost");
  assert.equal(state.aiSettings.activeProviderId, "deepseek");
  assert.equal(state.aiSettings.analysisProviderId, "codex-cli");
  assert.equal(state.aiSettings.optimizationProviderId, "deepseek");
  assert.equal(state.aiSettings.completionProviderId, "deepseek");
  assert.deepEqual(state.sources.map((source: any) => [source.id, source.enabled, source.selected]), [
    ["x-ai-official", false, false],
    ["openai-official", true, true],
  ]);
  assert.equal(state.aiSettings.providers[1].apiKeyConfigured, true);
  assert.equal(state.aiSettings.providers[1].apiKeyHint, "sk-…1234");
  assert.deepEqual(result, { disabledXSourceCount: 1, completionDisabled: false });
  assert.equal(meteredAutomationAllowed(state), false);
});

test("allow-metered mode only unlocks controls and never enables a connector by itself", () => {
  const state = {
    settings: { spendingPolicy: "zero-cost" },
    aiSettings: {
      activeProviderId: "codex-cli",
      completionProviderId: "",
      analysisProviderId: "codex-cli",
      optimizationProviderId: "codex-cli",
      providers: [{ id: "codex-cli", kind: "codex-cli", apiKeyConfigured: true }],
    },
    sources: [{ id: "x-ai-official", kind: "x", enabled: false, selected: false }],
  } as any;

  const result = applySpendingPolicy(state, "allow-metered");

  assert.equal(meteredAutomationAllowed(state), true);
  assert.equal(state.sources[0].enabled, false);
  assert.equal(state.aiSettings.completionProviderId, "");
  assert.deepEqual(result, { disabledXSourceCount: 0, completionDisabled: false });
});

test("zero-cost guards reject Gemini and X but leave DeepSeek available", () => {
  const state = { settings: { spendingPolicy: "zero-cost" } } as any;

  assert.doesNotThrow(() => assertMeteredProviderAllowed(state, { kind: "codex-cli", name: "Codex" } as any));
  assert.doesNotThrow(() => assertMeteredProviderAllowed(state, { id: "deepseek", kind: "openai-compatible", name: "DeepSeek" } as any));
  assert.throws(
    () => assertMeteredProviderAllowed(state, { id: "gemini", kind: "openai-compatible", name: "Gemini" } as any),
    /X.*Gemini.*零.*支出.*Gemini/u,
  );
  assert.throws(
    () => assertMeteredSourceAllowed(state, { kind: "x", name: "X 官方账号" } as any),
    /X.*Gemini.*零.*支出.*X 官方账号/u,
  );
  assert.doesNotThrow(() => assertMeteredSourceAllowed(state, { kind: "rss", name: "OpenAI" } as any));
});
