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
