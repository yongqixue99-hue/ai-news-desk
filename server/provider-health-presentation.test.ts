import test from "node:test";
import assert from "node:assert/strict";
import { providerHealthPresentation } from "./provider-health-presentation.js";
import type { AiProviderConfig, ProviderHealthResult } from "./types.js";

const provider: AiProviderConfig = {
  id: "qwen",
  name: "通义千问",
  vendor: "阿里云百炼",
  description: "",
  kind: "openai-compatible",
  model: "qwen-plus",
  baseUrl: "https://example.com/v1",
  supportsVision: true,
  apiKeyConfigured: true,
};

const health = (patch: Partial<ProviderHealthResult> = {}): ProviderHealthResult => ({
  providerId: "qwen",
  lastCheckedAt: "2026-08-13T12:00:00.000Z",
  status: "healthy",
  latencyMs: 84,
  model: "qwen-plus",
  errorCategory: "none",
  safeMessage: "连接正常",
  ...patch,
});

test("provider health presentation keeps latency and actionable errors visible", () => {
  assert.deepEqual(providerHealthPresentation(provider, health()), {
    tone: "success",
    label: "连接正常 · 84ms",
    detail: "连接正常",
    stale: false,
  });

  assert.deepEqual(providerHealthPresentation(provider, health({
    status: "error",
    errorCategory: "auth",
    safeMessage: "请重新保存 API Key。",
  })), {
    tone: "error",
    label: "认证失败 · 84ms",
    detail: "请重新保存 API Key。",
    stale: false,
  });
});

test("a health result for a previous model cannot appear current", () => {
  assert.deepEqual(providerHealthPresentation(
    { ...provider, model: "qwen-max" },
    health(),
  ), {
    tone: "warning",
    label: "配置已变更",
    detail: "上次测试的是 qwen-plus，请重新测试当前模型。",
    stale: true,
  });
});

test("an untested provider has a neutral, explicit state", () => {
  assert.deepEqual(providerHealthPresentation(provider, undefined), {
    tone: "neutral",
    label: "尚未测试",
    detail: "测试连接不会生成草稿。",
    stale: false,
  });
});
