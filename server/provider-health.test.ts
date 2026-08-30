import test from "node:test";
import assert from "node:assert/strict";
import { probeProviderConnection } from "./provider-health.js";
import type { AiProviderConfig } from "./types.js";

const provider = (patch: Partial<AiProviderConfig> = {}): AiProviderConfig => ({
  id: "qwen",
  name: "通义千问",
  vendor: "阿里云百炼",
  description: "测试接口",
  kind: "openai-compatible",
  model: "qwen-plus",
  baseUrl: "https://example.com/v1",
  supportsVision: true,
  apiKeyConfigured: true,
  ...patch,
});

const deterministicTime = () => {
  const values = [1_000, 1_042];
  return () => values.shift() ?? 1_042;
};

test("an OpenAI-compatible probe uses the no-generation models endpoint and never exposes the API key", async () => {
  const secret = "sk-private-provider-secret";
  let receivedUrl = "";
  let receivedInit: RequestInit | undefined;

  const result = await probeProviderConnection(provider(), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    clock: deterministicTime(),
    getApiKey: async () => secret,
    validateUrl: async (url) => new URL(url),
    fetcher: async (url, init) => {
      receivedUrl = String(url);
      receivedInit = init;
      return new Response(JSON.stringify({ data: [{ id: "qwen-plus" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  assert.equal(receivedUrl, "https://example.com/v1/models");
  assert.equal(receivedInit?.method, "GET");
  assert.equal(receivedInit?.body, undefined);
  assert.equal(result.status, "healthy");
  assert.equal(result.latencyMs, 42);
  assert.equal(result.errorCategory, "none");
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("an unsupported models endpoint falls back to a one-output-token compatibility check", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await probeProviderConnection(provider(), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    clock: deterministicTime(),
    getApiKey: async () => "sk-test",
    validateUrl: async (url) => new URL(url),
    fetcher: async (url, init) => {
      calls.push({ url: String(url), init });
      if (calls.length === 1) return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 });
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[1].url, "https://example.com/v1/chat/completions");
  const body = JSON.parse(String(calls[1].init?.body));
  assert.equal(body.max_tokens, 1);
  assert.equal(body.stream, false);
  assert.equal(result.status, "healthy");
  assert.match(result.safeMessage, /1 token/);
});

test("authentication failures are actionable and redact upstream bodies", async () => {
  const secret = "sk-never-leak-this";
  const result = await probeProviderConnection(provider(), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    clock: deterministicTime(),
    getApiKey: async () => secret,
    validateUrl: async (url) => new URL(url),
    fetcher: async () => new Response(`invalid key ${secret}`, { status: 401 }),
  });

  assert.equal(result.status, "error");
  assert.equal(result.errorCategory, "auth");
  assert.match(result.safeMessage, /API Key/);
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test("Codex diagnosis checks version, login/config and exec help without starting a generation", async () => {
  const calls: string[][] = [];
  const result = await probeProviderConnection(provider({
    id: "codex-cli",
    name: "Codex",
    vendor: "OpenAI",
    kind: "codex-cli",
    model: "gpt-5.4",
    baseUrl: undefined,
  }), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    clock: deterministicTime(),
    runCommand: async (_command, args) => {
      calls.push(args);
      const isUnsafeExec = args.includes("exec") && !args.includes("--help");
      if (isUnsafeExec) throw new Error("health checks must not generate");
      if (args[0] === "--version") return { exitCode: 0, stdout: "codex-cli 0.134.0", stderr: "", timedOut: false };
      if (args[0] === "login") {
        return {
          exitCode: 1,
          stdout: "",
          stderr: "unknown variant `max`, expected xhigh; token sk-should-stay-private",
          timedOut: false,
        };
      }
      return { exitCode: 0, stdout: "Logged in using ChatGPT", stderr: "", timedOut: false };
    },
  });

  assert.equal(result.status, "warning");
  assert.equal(result.errorCategory, "config");
  assert.match(result.safeMessage, /config\.toml|配置/);
  assert.equal(JSON.stringify(result).includes("sk-should-stay-private"), false);
  assert.equal(calls.some((args) => args.includes("exec") && !args.includes("--help")), false);
});
