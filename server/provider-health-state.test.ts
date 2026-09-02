import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, upgradeState } from "./defaults.js";

test("current state initializes and preserves the latest provider health snapshot", () => {
  const state = createDefaultState();
  assert.deepEqual((state.aiSettings as { latestProviderHealth?: unknown }).latestProviderHealth, {});

  const saved = structuredClone(state) as typeof state & {
    aiSettings: typeof state.aiSettings & { latestProviderHealth: Record<string, unknown> };
  };
  saved.aiSettings.latestProviderHealth = {
    qwen: {
      providerId: "qwen",
      lastCheckedAt: "2026-08-13T12:00:00.000Z",
      status: "healthy",
      latencyMs: 84,
      model: "qwen-plus",
      errorCategory: "none",
      safeMessage: "连接正常",
    },
  };

  const upgraded = upgradeState(saved as unknown as ReturnType<typeof createDefaultState>);
  assert.deepEqual(upgraded.aiSettings.latestProviderHealth.qwen, saved.aiSettings.latestProviderHealth.qwen);
  assert.equal(upgraded.version, createDefaultState().version);
});

test("a fresh desk separates cheap inline completion from the long-form drafting provider", () => {
  const state = createDefaultState();
  const deepseek = state.aiSettings.providers.find((provider) => provider.id === "deepseek");
  const gemini = state.aiSettings.providers.find((provider) => provider.id === "gemini");
  const groq = state.aiSettings.providers.find((provider) => provider.id === "groq");

  assert.equal(state.aiSettings.activeProviderId, "codex-cli");
  assert.equal(state.aiSettings.completionProviderId, "deepseek");
  assert.equal(deepseek?.model, "deepseek-v4-flash");
  assert.equal(deepseek?.inlineCompletionModel, "deepseek-v4-flash");
  assert.equal(gemini?.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(gemini?.inlineCompletionModel, "gemini-3.1-flash-lite");
  assert.equal(groq?.baseUrl, "https://api.groq.com/openai/v1");
  assert.equal(groq?.inlineCompletionModel, "openai/gpt-oss-20b");
});

test("an older desk gains a completion provider without changing its existing Agent assignments", () => {
  const saved = createDefaultState();
  saved.aiSettings.activeProviderId = "qwen";
  saved.aiSettings.analysisProviderId = "qwen";
  saved.aiSettings.optimizationProviderId = "openai-api";
  delete (saved.aiSettings as Partial<typeof saved.aiSettings>).completionProviderId;

  const upgraded = upgradeState(saved);

  assert.equal(upgraded.aiSettings.activeProviderId, "qwen");
  assert.equal(upgraded.aiSettings.analysisProviderId, "qwen");
  assert.equal(upgraded.aiSettings.optimizationProviderId, "openai-api");
  assert.equal(upgraded.aiSettings.completionProviderId, "deepseek");
});

test("current state drops malformed or orphaned provider health records", () => {
  const saved = createDefaultState() as unknown as Omit<ReturnType<typeof createDefaultState>, "aiSettings"> & {
    aiSettings: Omit<ReturnType<typeof createDefaultState>["aiSettings"], "latestProviderHealth"> & {
      latestProviderHealth: Record<string, unknown>;
    };
  };
  saved.aiSettings.latestProviderHealth = {
    missing: {
      providerId: "missing",
      lastCheckedAt: "not-a-date",
      status: "mystery",
      latencyMs: -2,
      model: 42,
      errorCategory: "secret-error-body",
      safeMessage: null,
    },
  };

  const upgraded = upgradeState(saved as unknown as ReturnType<typeof createDefaultState>);
  assert.deepEqual(upgraded.aiSettings.latestProviderHealth, {});
});
