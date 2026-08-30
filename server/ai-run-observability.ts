import { createHash, randomUUID } from "node:crypto";

export type AiTaskKind =
  | "article-generation"
  | "article-analysis"
  | "article-optimization"
  | "article-chat"
  | "candidate-briefing"
  | "link-intake"
  | "screenshot-intake";

export interface AiProviderSnapshot {
  id: string;
  name?: string;
  model: string;
  kind?: string;
}

export interface AiSkillSnapshotInput {
  id: string;
  revision?: string;
  /** Included in the fingerprint only. It is never persisted in the trace. */
  instructions?: string;
}

export interface StartAiRunTraceInput {
  traceId?: string;
  replayId?: string;
  taskKind: AiTaskKind;
  subjectId?: string;
  startedAt?: string;
  provider: AiProviderSnapshot;
  skills?: AiSkillSnapshotInput[];
}

export interface AiRunTrace {
  schemaVersion: "ai-run-trace/v1";
  id: string;
  replayId: string;
  taskKind: AiTaskKind;
  subjectId?: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  requestedProvider: AiProviderSnapshot;
  skillSnapshot: {
    ids: string[];
    hash: string;
  };
  activeAttemptId?: string;
  tokens?: AiTokenUsage;
  cost?: AiCost;
  attempts: AiProviderAttempt[];
  retries: AiRetryEvent[];
  fallbacks: AiFallbackEvent[];
  errors: AiErrorEvent[];
}

export interface AiProviderAttempt {
  id: string;
  replayId: string;
  attemptNumber: number;
  transition: "initial" | "retry" | "fallback";
  retryNumber: number;
  provider: AiProviderSnapshot;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  exitCode?: number;
  httpStatus?: number;
  errorCategory?: AiErrorCategory;
  tokens?: AiTokenUsage;
  cost?: AiCost;
}

export interface AiTokenUsage {
  input?: number;
  output?: number;
  cached?: number;
  total?: number;
}

export interface AiCost {
  amount: number;
  currency: string;
  estimated?: boolean;
}

export type AiErrorCategory =
  | "authentication"
  | "rate-limit"
  | "timeout"
  | "network"
  | "provider"
  | "invalid-response"
  | "configuration"
  | "cancelled"
  | "unknown";

export interface AiRetryEvent {
  id: string;
  at: string;
  fromAttemptId: string;
  toAttemptId: string;
  retryNumber: number;
  reason: string;
}

export interface AiFallbackEvent {
  id: string;
  at: string;
  fromAttemptId: string;
  toAttemptId: string;
  fromProvider: AiProviderSnapshot;
  toProvider: AiProviderSnapshot;
  reasonCategory: AiErrorCategory;
  reason: string;
}

export interface AiErrorEvent {
  id: string;
  attemptId: string;
  at: string;
  category: AiErrorCategory;
  message: string;
  retryable: boolean;
  exitCode?: number;
  httpStatus?: number;
}

export interface AppendAiProviderAttemptInput {
  attemptId?: string;
  startedAt?: string;
  provider: AiProviderSnapshot;
}

export interface CompleteAiRunTraceInput {
  status: "succeeded" | "failed" | "cancelled";
  attemptId?: string;
  completedAt?: string;
  exitCode?: number;
  httpStatus?: number;
  errorCategory?: AiErrorCategory;
  tokens?: AiTokenUsage;
  cost?: AiCost;
}

export interface AppendAiErrorInput {
  attemptId?: string;
  completedAt?: string;
  error: unknown;
  category?: AiErrorCategory;
  retryable?: boolean;
  exitCode?: number;
  httpStatus?: number;
  tokens?: AiTokenUsage;
  cost?: AiCost;
}

export interface AppendAiRetryInput {
  attemptId?: string;
  previousAttemptId?: string;
  startedAt?: string;
  reason: string;
}

export interface AppendAiFallbackInput {
  attemptId?: string;
  fromAttemptId?: string;
  startedAt?: string;
  toProvider: AiProviderSnapshot;
  reason: string;
  reasonCategory?: AiErrorCategory;
}

const normalizedProvider = (provider: AiProviderSnapshot): AiProviderSnapshot => ({
  id: provider.id.trim().slice(0, 160),
  name: provider.name?.trim().slice(0, 160) || undefined,
  model: provider.model.trim().slice(0, 160),
  kind: provider.kind?.trim().slice(0, 80) || undefined,
});

const sameProvider = (left: AiProviderSnapshot, right: AiProviderSnapshot) =>
  left.id === right.id && left.model === right.model;

const skillSnapshotFor = (skills: AiSkillSnapshotInput[] = []) => {
  const normalized = skills
    .map((skill) => ({
      id: skill.id.trim().slice(0, 240),
      revision: skill.revision?.trim().slice(0, 160) || "",
      instructions: skill.instructions || "",
    }))
    .filter((skill) => skill.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    ids: [...new Set(normalized.map((skill) => skill.id))],
    hash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex").slice(0, 24),
  };
};

const durationBetween = (startedAt: string, completedAt: string) => {
  const duration = Date.parse(completedAt) - Date.parse(startedAt);
  return Number.isFinite(duration) ? Math.max(0, duration) : 0;
};

const nonNegativeInteger = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : undefined;

const normalizedTokens = (tokens: AiTokenUsage | undefined): AiTokenUsage | undefined => {
  if (!tokens) return undefined;
  const normalized: AiTokenUsage = {};
  const input = nonNegativeInteger(tokens.input);
  const output = nonNegativeInteger(tokens.output);
  const cached = nonNegativeInteger(tokens.cached);
  const total = nonNegativeInteger(tokens.total);
  if (input !== undefined) normalized.input = input;
  if (output !== undefined) normalized.output = output;
  if (cached !== undefined) normalized.cached = cached;
  if (total !== undefined) normalized.total = total;
  return Object.keys(normalized).length ? normalized : undefined;
};

const normalizedCost = (cost: AiCost | undefined): AiCost | undefined => {
  if (!cost || !Number.isFinite(cost.amount) || cost.amount < 0) return undefined;
  return {
    amount: cost.amount,
    currency: cost.currency.trim().toUpperCase().slice(0, 12) || "USD",
    estimated: cost.estimated,
  };
};

const aggregateTokens = (attempts: AiProviderAttempt[]): AiTokenUsage | undefined => {
  const usages = attempts.map((attempt) => attempt.tokens).filter((usage): usage is AiTokenUsage => Boolean(usage));
  if (!usages.length) return undefined;
  const totalFor = (key: keyof AiTokenUsage) => {
    const values = usages.map((usage) => usage[key]).filter((value): value is number => value !== undefined);
    return values.length ? values.reduce((sum, value) => sum + value, 0) : undefined;
  };
  return normalizedTokens({
    input: totalFor("input"),
    output: totalFor("output"),
    cached: totalFor("cached"),
    total: totalFor("total"),
  });
};

const aggregateCost = (attempts: AiProviderAttempt[]): AiCost | undefined => {
  const costs = attempts.map((attempt) => attempt.cost).filter((cost): cost is AiCost => Boolean(cost));
  if (!costs.length || costs.some((cost) => cost.currency !== costs[0].currency)) return undefined;
  return {
    amount: Number(costs.reduce((sum, cost) => sum + cost.amount, 0).toFixed(8)),
    currency: costs[0].currency,
    estimated: costs.some((cost) => cost.estimated === true),
  };
};

const redactSensitiveText = (value: string) => value
  .replace(/("(?:prompt|systemPrompt|userPrompt|codexPrompt|messages|content|requestBody)"\s*:\s*")[^"]*(")/gi, "$1[PRIVATE]$2")
  .replace(/("messages"\s*:\s*)\[[^\]]*\]/gi, "$1[PRIVATE]")
  .replace(/((?:system|user|codex)?prompt\s*[=:]\s*)[^;\n]+/gi, "$1[PRIVATE]")
  .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]")
  .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
  .replace(/((?:api[_-]?key|access[_-]?token|secret|password)\s*[=:]\s*)[^\s,;"'}]+/gi, "$1[REDACTED]")
  .replace(/("(?:apiKey|api_key|authorization|access_token|secret|password)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
  .slice(0, 900);

const errorMessage = (error: unknown) => redactSensitiveText(
  error instanceof Error ? error.message : typeof error === "string" ? error : String(error),
);

export const classifyAiError = (input: {
  error?: unknown;
  httpStatus?: number;
  exitCode?: number;
}): AiErrorCategory => {
  const message = errorMessage(input.error).toLowerCase();
  if (input.httpStatus === 401 || input.httpStatus === 403 || /unauthori[sz]ed|forbidden|api key|authentication/.test(message)) {
    return "authentication";
  }
  if (input.httpStatus === 429 || /rate.?limit|too many requests|quota/.test(message)) return "rate-limit";
  if (/timeout|timed out|超时|aborterror/.test(message)) return "timeout";
  if (/fetch failed|econn|enotfound|socket|network|dns/.test(message)) return "network";
  if (/json|schema|结构不完整|invalid response|没有返回/.test(message)) return "invalid-response";
  if (/base url|模型名称|未配置|configuration|config/.test(message)) return "configuration";
  if (/cancel|取消|sigterm/.test(message)) return "cancelled";
  if (input.httpStatus !== undefined || input.exitCode !== undefined) return "provider";
  return "unknown";
};

export const startAiRunTrace = (input: StartAiRunTraceInput): AiRunTrace => {
  const id = input.traceId?.trim() || `ai_trace_${randomUUID()}`;
  return {
    schemaVersion: "ai-run-trace/v1",
    id,
    replayId: input.replayId?.trim() || `ai_replay_${randomUUID()}`,
    taskKind: input.taskKind,
    subjectId: input.subjectId?.trim().slice(0, 240) || undefined,
    status: "running",
    startedAt: input.startedAt || new Date().toISOString(),
    requestedProvider: normalizedProvider(input.provider),
    skillSnapshot: skillSnapshotFor(input.skills),
    attempts: [],
    retries: [],
    fallbacks: [],
    errors: [],
  };
};

export const appendAiProviderAttempt = (
  trace: AiRunTrace,
  input: AppendAiProviderAttemptInput,
): AiRunTrace => {
  if (trace.status !== "running") throw new Error("AI 运行已结束，不能再追加 Provider 尝试");
  const provider = normalizedProvider(input.provider);
  if (trace.attempts.length > 0) {
    throw new Error("后续 Provider 调用必须使用 appendAiRetry 或 appendAiFallback 显式记录原因");
  }
  if (!sameProvider(provider, trace.requestedProvider)) {
    throw new Error("首次调用与请求 Provider 不一致；如需切换必须使用 appendAiFallback 显式记录");
  }
  const attempt: AiProviderAttempt = {
    id: input.attemptId?.trim() || `ai_attempt_${randomUUID()}`,
    replayId: trace.replayId,
    attemptNumber: trace.attempts.length + 1,
    transition: "initial",
    retryNumber: 0,
    provider,
    status: "running",
    startedAt: input.startedAt || new Date().toISOString(),
  };
  return {
    ...trace,
    activeAttemptId: attempt.id,
    attempts: [...trace.attempts, attempt],
  };
};

export const appendAiRetry = (
  trace: AiRunTrace,
  input: AppendAiRetryInput,
): AiRunTrace => {
  if (trace.status !== "running") throw new Error("AI 运行已结束，不能再重试");
  if (trace.activeAttemptId) throw new Error("当前 Provider 尝试尚未结束，不能开始重试");
  const previous = input.previousAttemptId
    ? trace.attempts.find((attempt) => attempt.id === input.previousAttemptId)
    : trace.attempts.at(-1);
  if (!previous) throw new Error("找不到需要重试的 Provider 尝试");
  if (previous.status !== "failed" && previous.status !== "cancelled") {
    throw new Error("只有失败或取消的 Provider 尝试可以重试");
  }
  const startedAt = input.startedAt || new Date().toISOString();
  const attempt: AiProviderAttempt = {
    id: input.attemptId?.trim() || `ai_attempt_${randomUUID()}`,
    replayId: trace.replayId,
    attemptNumber: trace.attempts.length + 1,
    transition: "retry",
    retryNumber: previous.retryNumber + 1,
    provider: { ...previous.provider },
    status: "running",
    startedAt,
  };
  const event: AiRetryEvent = {
    id: `ai_retry_${randomUUID()}`,
    at: startedAt,
    fromAttemptId: previous.id,
    toAttemptId: attempt.id,
    retryNumber: attempt.retryNumber,
    reason: redactSensitiveText(input.reason.trim() || "调用方要求重试"),
  };
  return {
    ...trace,
    activeAttemptId: attempt.id,
    attempts: [...trace.attempts, attempt],
    retries: [...trace.retries, event],
  };
};

export const appendAiFallback = (
  trace: AiRunTrace,
  input: AppendAiFallbackInput,
): AiRunTrace => {
  if (trace.status !== "running") throw new Error("AI 运行已结束，不能切换备用 Provider");
  if (trace.activeAttemptId) throw new Error("当前 Provider 尝试尚未结束，不能切换备用 Provider");
  const previous = input.fromAttemptId
    ? trace.attempts.find((attempt) => attempt.id === input.fromAttemptId)
    : trace.attempts.at(-1);
  if (!previous) throw new Error("找不到需要切换的 Provider 尝试");
  if (previous.status !== "failed" && previous.status !== "cancelled") {
    throw new Error("只有失败或取消的 Provider 尝试可以切换备用 Provider");
  }
  const provider = normalizedProvider(input.toProvider);
  if (sameProvider(previous.provider, provider)) {
    throw new Error("相同 Provider 与模型应使用 appendAiRetry，不应伪装成 fallback");
  }
  const startedAt = input.startedAt || new Date().toISOString();
  const attempt: AiProviderAttempt = {
    id: input.attemptId?.trim() || `ai_attempt_${randomUUID()}`,
    replayId: trace.replayId,
    attemptNumber: trace.attempts.length + 1,
    transition: "fallback",
    retryNumber: 0,
    provider,
    status: "running",
    startedAt,
  };
  const previousError = [...trace.errors].reverse().find((error) => error.attemptId === previous.id);
  const event: AiFallbackEvent = {
    id: `ai_fallback_${randomUUID()}`,
    at: startedAt,
    fromAttemptId: previous.id,
    toAttemptId: attempt.id,
    fromProvider: { ...previous.provider },
    toProvider: { ...provider },
    reasonCategory: input.reasonCategory || previousError?.category || previous.errorCategory || "unknown",
    reason: redactSensitiveText(input.reason.trim() || "调用方切换到备用 Provider"),
  };
  return {
    ...trace,
    activeAttemptId: attempt.id,
    attempts: [...trace.attempts, attempt],
    fallbacks: [...trace.fallbacks, event],
  };
};

export const appendAiError = (
  trace: AiRunTrace,
  input: AppendAiErrorInput,
): AiRunTrace => {
  if (trace.status !== "running") throw new Error("AI 运行已结束，不能再记录 Provider 错误");
  const attemptId = input.attemptId || trace.activeAttemptId;
  if (!attemptId) throw new Error("AI 运行没有可关联错误的 Provider 尝试");
  const completedAt = input.completedAt || new Date().toISOString();
  const category = input.category || classifyAiError(input);
  const message = errorMessage(input.error);
  let found = false;
  const attempts = trace.attempts.map((attempt) => {
    if (attempt.id !== attemptId) return attempt;
    found = true;
    return {
      ...attempt,
      status: "failed" as const,
      completedAt,
      durationMs: durationBetween(attempt.startedAt, completedAt),
      exitCode: input.exitCode,
      httpStatus: input.httpStatus,
      errorCategory: category,
      tokens: normalizedTokens(input.tokens),
      cost: normalizedCost(input.cost),
    };
  });
  if (!found) throw new Error("找不到发生错误的 Provider 尝试");
  const event: AiErrorEvent = {
    id: `ai_error_${randomUUID()}`,
    attemptId,
    at: completedAt,
    category,
    message,
    retryable: input.retryable ?? ["rate-limit", "timeout", "network", "provider"].includes(category),
    exitCode: input.exitCode,
    httpStatus: input.httpStatus,
  };
  return {
    ...trace,
    activeAttemptId: trace.activeAttemptId === attemptId ? undefined : trace.activeAttemptId,
    attempts,
    errors: [...trace.errors, event],
  };
};

export const completeAiRunTrace = (
  trace: AiRunTrace,
  input: CompleteAiRunTraceInput,
): AiRunTrace => {
  if (trace.status !== "running") throw new Error("AI 运行已经完成");
  const attemptId = input.attemptId || trace.activeAttemptId;
  if (!attemptId) throw new Error("AI 运行没有可完成的 Provider 尝试");
  if (input.status === "failed" && !trace.errors.some((error) => error.attemptId === attemptId)) {
    throw new Error("失败运行必须先通过 appendAiError 写入明确的错误事件，不能静默失败");
  }
  const completedAt = input.completedAt || new Date().toISOString();
  let found = false;
  const attempts = trace.attempts.map((attempt) => {
    if (attempt.id !== attemptId) return attempt;
    found = true;
    return {
      ...attempt,
      status: input.status,
      completedAt,
      durationMs: durationBetween(attempt.startedAt, completedAt),
      exitCode: input.exitCode ?? attempt.exitCode,
      httpStatus: input.httpStatus ?? attempt.httpStatus,
      errorCategory: input.errorCategory ?? attempt.errorCategory,
      tokens: normalizedTokens(input.tokens) ?? attempt.tokens,
      cost: normalizedCost(input.cost) ?? attempt.cost,
    };
  });
  if (!found) throw new Error("找不到要完成的 Provider 尝试");
  return {
    ...trace,
    status: input.status,
    completedAt,
    durationMs: durationBetween(trace.startedAt, completedAt),
    activeAttemptId: undefined,
    tokens: aggregateTokens(attempts),
    cost: aggregateCost(attempts),
    attempts,
  };
};

const safeProvider = (provider: AiProviderSnapshot): AiProviderSnapshot => ({
  id: redactSensitiveText(String(provider.id || "")).slice(0, 160),
  name: provider.name ? redactSensitiveText(String(provider.name)).slice(0, 160) : undefined,
  model: redactSensitiveText(String(provider.model || "")).slice(0, 160),
  kind: provider.kind ? redactSensitiveText(String(provider.kind)).slice(0, 80) : undefined,
});

const finiteInteger = (value: number | undefined) =>
  typeof value === "number" && Number.isFinite(value) ? Math.round(value) : undefined;

/**
 * Produces the only shape that may be persisted or returned by an API. The
 * projection deliberately drops every unknown key, so accidental request
 * headers, API keys, prompts and model message bodies cannot escape through a
 * broad object spread.
 */
export const sanitizeAiRunTrace = (trace: AiRunTrace): AiRunTrace => ({
  schemaVersion: "ai-run-trace/v1",
  id: redactSensitiveText(String(trace.id || "")).slice(0, 240),
  replayId: redactSensitiveText(String(trace.replayId || "")).slice(0, 240),
  taskKind: trace.taskKind,
  subjectId: trace.subjectId ? redactSensitiveText(String(trace.subjectId)).slice(0, 240) : undefined,
  status: trace.status,
  startedAt: String(trace.startedAt || ""),
  completedAt: trace.completedAt ? String(trace.completedAt) : undefined,
  durationMs: nonNegativeInteger(trace.durationMs),
  requestedProvider: safeProvider(trace.requestedProvider),
  skillSnapshot: {
    ids: [...new Set((trace.skillSnapshot?.ids || [])
      .map((id) => redactSensitiveText(String(id)).slice(0, 240))
      .filter(Boolean))],
    hash: String(trace.skillSnapshot?.hash || "").replace(/[^a-f0-9]/gi, "").slice(0, 64),
  },
  activeAttemptId: trace.activeAttemptId
    ? redactSensitiveText(String(trace.activeAttemptId)).slice(0, 240)
    : undefined,
  tokens: normalizedTokens(trace.tokens),
  cost: normalizedCost(trace.cost),
  attempts: (trace.attempts || []).map((attempt) => ({
    id: redactSensitiveText(String(attempt.id || "")).slice(0, 240),
    replayId: redactSensitiveText(String(attempt.replayId || trace.replayId || "")).slice(0, 240),
    attemptNumber: nonNegativeInteger(attempt.attemptNumber) || 0,
    transition: attempt.transition,
    retryNumber: nonNegativeInteger(attempt.retryNumber) || 0,
    provider: safeProvider(attempt.provider),
    status: attempt.status,
    startedAt: String(attempt.startedAt || ""),
    completedAt: attempt.completedAt ? String(attempt.completedAt) : undefined,
    durationMs: nonNegativeInteger(attempt.durationMs),
    exitCode: finiteInteger(attempt.exitCode),
    httpStatus: nonNegativeInteger(attempt.httpStatus),
    errorCategory: attempt.errorCategory,
    tokens: normalizedTokens(attempt.tokens),
    cost: normalizedCost(attempt.cost),
  })),
  retries: (trace.retries || []).map((retry) => ({
    id: redactSensitiveText(String(retry.id || "")).slice(0, 240),
    at: String(retry.at || ""),
    fromAttemptId: redactSensitiveText(String(retry.fromAttemptId || "")).slice(0, 240),
    toAttemptId: redactSensitiveText(String(retry.toAttemptId || "")).slice(0, 240),
    retryNumber: nonNegativeInteger(retry.retryNumber) || 0,
    reason: redactSensitiveText(String(retry.reason || "")),
  })),
  fallbacks: (trace.fallbacks || []).map((fallback) => ({
    id: redactSensitiveText(String(fallback.id || "")).slice(0, 240),
    at: String(fallback.at || ""),
    fromAttemptId: redactSensitiveText(String(fallback.fromAttemptId || "")).slice(0, 240),
    toAttemptId: redactSensitiveText(String(fallback.toAttemptId || "")).slice(0, 240),
    fromProvider: safeProvider(fallback.fromProvider),
    toProvider: safeProvider(fallback.toProvider),
    reasonCategory: fallback.reasonCategory,
    reason: redactSensitiveText(String(fallback.reason || "")),
  })),
  errors: (trace.errors || []).map((error) => ({
    id: redactSensitiveText(String(error.id || "")).slice(0, 240),
    attemptId: redactSensitiveText(String(error.attemptId || "")).slice(0, 240),
    at: String(error.at || ""),
    category: error.category,
    message: redactSensitiveText(String(error.message || "")),
    retryable: error.retryable === true,
    exitCode: finiteInteger(error.exitCode),
    httpStatus: nonNegativeInteger(error.httpStatus),
  })),
});
