import assert from "node:assert/strict";
import test from "node:test";
import {
  appendAiError,
  appendAiFallback,
  appendAiProviderAttempt,
  appendAiRetry,
  completeAiRunTrace,
  sanitizeAiRunTrace,
  startAiRunTrace,
} from "./ai-run-observability.js";

test("starting an AI trace records a deterministic skill snapshot without storing instructions", () => {
  const trace = startAiRunTrace({
    traceId: "trace-1",
    replayId: "replay-1",
    taskKind: "article-generation",
    subjectId: "candidate-1",
    startedAt: "2026-08-13T01:00:00.000Z",
    provider: {
      id: "openai-main",
      name: "OpenAI",
      model: "gpt-5.6",
      kind: "openai-compatible",
    },
    skills: [
      { id: "ra-human", revision: "7", instructions: "一段不应写入运行记录的完整 Skill 指令" },
      { id: "news-desk", revision: "2", instructions: "另一段私有指令" },
    ],
  });

  assert.equal(trace.schemaVersion, "ai-run-trace/v1");
  assert.equal(trace.status, "running");
  assert.equal(trace.taskKind, "article-generation");
  assert.equal(trace.requestedProvider.model, "gpt-5.6");
  assert.deepEqual(trace.skillSnapshot.ids, ["news-desk", "ra-human"]);
  assert.match(trace.skillSnapshot.hash, /^[a-f0-9]{24}$/);
  assert.equal(trace.replayId, "replay-1");
  assert.doesNotMatch(JSON.stringify(trace), /完整 Skill|私有指令/);
});

test("a successful provider attempt records duration, exit status, usage and optional cost", () => {
  const initial = startAiRunTrace({
    traceId: "trace-success",
    taskKind: "article-analysis",
    startedAt: "2026-08-13T01:00:00.000Z",
    provider: { id: "codex", name: "Codex", model: "gpt-5.6", kind: "codex-cli" },
  });
  const running = appendAiProviderAttempt(initial, {
    attemptId: "attempt-1",
    startedAt: "2026-08-13T01:00:01.000Z",
    provider: initial.requestedProvider,
  });
  const completed = completeAiRunTrace(running, {
    status: "succeeded",
    attemptId: "attempt-1",
    completedAt: "2026-08-13T01:00:03.500Z",
    exitCode: 0,
    httpStatus: 200,
    tokens: { input: 1200, output: 300, cached: 200, total: 1500 },
    cost: { amount: 0.0125, currency: "USD", estimated: true },
  });

  assert.equal(initial.attempts.length, 0, "trace helpers should not mutate an earlier snapshot");
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.durationMs, 3500);
  assert.equal(completed.attempts[0]?.status, "succeeded");
  assert.equal(completed.attempts[0]?.durationMs, 2500);
  assert.equal(completed.attempts[0]?.exitCode, 0);
  assert.equal(completed.attempts[0]?.httpStatus, 200);
  assert.deepEqual(completed.attempts[0]?.tokens, { input: 1200, output: 300, cached: 200, total: 1500 });
  assert.deepEqual(completed.attempts[0]?.cost, { amount: 0.0125, currency: "USD", estimated: true });
});

test("provider errors are classified and secrets are redacted before entering the trace", () => {
  const started = appendAiProviderAttempt(startAiRunTrace({
    traceId: "trace-rate-limit",
    taskKind: "article-chat",
    startedAt: "2026-08-13T02:00:00.000Z",
    provider: { id: "qwen", model: "qwen-max", kind: "openai-compatible" },
  }), {
    attemptId: "attempt-rate-limit",
    startedAt: "2026-08-13T02:00:01.000Z",
    provider: { id: "qwen", model: "qwen-max", kind: "openai-compatible" },
  });
  const failedAttempt = appendAiError(started, {
    attemptId: "attempt-rate-limit",
    completedAt: "2026-08-13T02:00:02.250Z",
    error: new Error("HTTP 429 rate limit; api_key=sk-super-secret-value"),
    httpStatus: 429,
    retryable: true,
  });

  assert.equal(failedAttempt.status, "running", "a failed attempt may still be retried or fall back");
  assert.equal(failedAttempt.activeAttemptId, undefined);
  assert.equal(failedAttempt.attempts[0]?.status, "failed");
  assert.equal(failedAttempt.attempts[0]?.durationMs, 1250);
  assert.equal(failedAttempt.attempts[0]?.errorCategory, "rate-limit");
  assert.equal(failedAttempt.errors[0]?.category, "rate-limit");
  assert.equal(failedAttempt.errors[0]?.retryable, true);
  assert.doesNotMatch(JSON.stringify(failedAttempt), /sk-super-secret-value/);
  assert.match(failedAttempt.errors[0]?.message || "", /\[REDACTED\]/);
});

test("a second call to the same provider must be recorded as an explicit retry", () => {
  const first = appendAiProviderAttempt(startAiRunTrace({
    traceId: "trace-retry",
    taskKind: "article-generation",
    provider: { id: "deepseek", model: "deepseek-chat" },
  }), {
    attemptId: "attempt-original",
    provider: { id: "deepseek", model: "deepseek-chat" },
    startedAt: "2026-08-13T03:00:00.000Z",
  });
  const failed = appendAiError(first, {
    attemptId: "attempt-original",
    error: "request timeout",
    completedAt: "2026-08-13T03:00:05.000Z",
    retryable: true,
  });

  assert.throws(() => appendAiProviderAttempt(failed, {
    provider: { id: "deepseek", model: "deepseek-chat" },
  }), /appendAiRetry|重试/);

  const retried = appendAiRetry(failed, {
    attemptId: "attempt-retry-1",
    previousAttemptId: "attempt-original",
    startedAt: "2026-08-13T03:00:06.000Z",
    reason: "网络超时，按退避策略重试一次",
  });

  assert.equal(retried.attempts[1]?.transition, "retry");
  assert.equal(retried.attempts[1]?.retryNumber, 1);
  assert.equal(retried.attempts[1]?.provider.id, "deepseek");
  assert.equal(retried.retries[0]?.fromAttemptId, "attempt-original");
  assert.equal(retried.retries[0]?.toAttemptId, "attempt-retry-1");
  assert.match(retried.retries[0]?.reason || "", /退避策略/);
});

test("switching provider requires an explicit, visible fallback record", () => {
  const initial = appendAiProviderAttempt(startAiRunTrace({
    traceId: "trace-fallback",
    taskKind: "article-optimization",
    provider: { id: "openai", name: "OpenAI", model: "gpt-5.6" },
  }), {
    attemptId: "attempt-openai",
    provider: { id: "openai", name: "OpenAI", model: "gpt-5.6" },
  });
  const failed = appendAiError(initial, {
    attemptId: "attempt-openai",
    error: "provider unavailable",
    httpStatus: 503,
  });

  assert.throws(() => appendAiProviderAttempt(failed, {
    provider: { id: "qwen", name: "千问", model: "qwen-max" },
  }), /appendAiFallback|切换/);

  const fallback = appendAiFallback(failed, {
    attemptId: "attempt-qwen",
    fromAttemptId: "attempt-openai",
    startedAt: "2026-08-13T04:00:02.000Z",
    toProvider: { id: "qwen", name: "千问", model: "qwen-max" },
    reason: "OpenAI 返回 503，切换备用 Provider；authorization=Bearer secret-token-value",
  });

  assert.equal(fallback.attempts[1]?.transition, "fallback");
  assert.equal(fallback.attempts[1]?.provider.id, "qwen");
  assert.equal(fallback.fallbacks[0]?.fromProvider.id, "openai");
  assert.equal(fallback.fallbacks[0]?.toProvider.id, "qwen");
  assert.equal(fallback.fallbacks[0]?.fromAttemptId, "attempt-openai");
  assert.equal(fallback.fallbacks[0]?.toAttemptId, "attempt-qwen");
  assert.doesNotMatch(JSON.stringify(fallback), /secret-token-value/);
  assert.match(fallback.fallbacks[0]?.reason || "", /503/);
});

test("sanitizing a trace drops unknown secret fields and redacts prompt bodies", () => {
  const trace = appendAiError(appendAiProviderAttempt(startAiRunTrace({
    traceId: "trace-sanitize",
    replayId: "replay-sanitize",
    taskKind: "article-chat",
    provider: { id: "openai", model: "gpt-5.6" },
  }), {
    attemptId: "attempt-sanitize",
    provider: { id: "openai", model: "gpt-5.6" },
  }), {
    error: "request failed: {\"prompt\":\"这是用户尚未发布的完整私密草稿\",\"apiKey\":\"sk-123456789-secret\"}",
  });
  const polluted = {
    ...trace,
    apiKey: "sk-top-level-secret",
    prompt: "完整系统提示词",
    requestedProvider: {
      ...trace.requestedProvider,
      authorization: "Bearer provider-secret-value",
    },
    skillSnapshot: {
      ...trace.skillSnapshot,
      instructions: "Skill 全文不能出现在运行记录",
    },
  } as typeof trace & Record<string, unknown>;

  const safe = sanitizeAiRunTrace(polluted);
  const serialized = JSON.stringify(safe);

  assert.equal(safe.replayId, "replay-sanitize");
  assert.equal(safe.requestedProvider.model, "gpt-5.6");
  assert.doesNotMatch(serialized, /私密草稿|系统提示词|Skill 全文/);
  assert.doesNotMatch(serialized, /sk-|provider-secret-value|top-level-secret/);
  assert.match(safe.errors[0]?.message || "", /\[PRIVATE\]|\[REDACTED\]/);
  assert.equal("apiKey" in safe, false);
  assert.equal("prompt" in safe, false);
});

test("a failed trace cannot be completed without an explicit error event", () => {
  const running = appendAiProviderAttempt(startAiRunTrace({
    traceId: "trace-no-silent-error",
    taskKind: "article-generation",
    provider: { id: "openai", model: "gpt-5.6" },
  }), {
    attemptId: "attempt-no-silent-error",
    provider: { id: "openai", model: "gpt-5.6" },
  });

  assert.throws(() => completeAiRunTrace(running, {
    status: "failed",
    attemptId: "attempt-no-silent-error",
  }), /appendAiError|错误事件/);

  const withError = appendAiError(running, {
    attemptId: "attempt-no-silent-error",
    error: "模型返回的 JSON 结构不完整",
  });
  const completed = completeAiRunTrace(withError, {
    status: "failed",
    attemptId: "attempt-no-silent-error",
  });
  assert.equal(completed.status, "failed");
  assert.equal(completed.errors.length, 1);
});

test("trace usage aggregates failed attempts and the successful retry", () => {
  const first = appendAiProviderAttempt(startAiRunTrace({
    traceId: "trace-aggregate",
    taskKind: "article-generation",
    provider: { id: "qwen", model: "qwen-max" },
  }), {
    attemptId: "aggregate-first",
    provider: { id: "qwen", model: "qwen-max" },
  });
  const failed = appendAiError(first, {
    error: "provider timeout after partial response",
    tokens: { input: 100, output: 20, total: 120 },
    cost: { amount: 0.01, currency: "usd", estimated: true },
  });
  const retry = appendAiRetry(failed, {
    attemptId: "aggregate-retry",
    reason: "超时后重试",
  });
  const completed = completeAiRunTrace(retry, {
    status: "succeeded",
    tokens: { input: 80, output: 40, total: 120 },
    cost: { amount: 0.02, currency: "USD", estimated: false },
  });

  assert.deepEqual(completed.tokens, { input: 180, output: 60, total: 240 });
  assert.deepEqual(completed.cost, { amount: 0.03, currency: "USD", estimated: true });
  assert.deepEqual(completed.attempts[0]?.tokens, { input: 100, output: 20, total: 120 });
});
