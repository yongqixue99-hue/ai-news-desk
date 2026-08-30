import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { getProviderApiKey } from "./secrets.js";
import type { AiProviderConfig } from "./types.js";

const readableCodexError = (stderr: string, code: number | null) => {
  const modelMessage = stderr.match(/"message":"([^"]+)"/)?.[1];
  if (modelMessage) return modelMessage.replaceAll("\\n", " ").slice(0, 700);
  const useful = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.includes(" WARN ") && !line.includes("OpenAI Codex v"))
    .slice(-5)
    .join(" · ");
  return (useful || `Codex 退出码 ${code ?? "unknown"}`).slice(0, 700);
};

const assertModelName = (model: string) => {
  const value = model.trim();
  if (!value || !/^[a-zA-Z0-9._:/-]+$/.test(value)) throw new Error("模型名称格式不正确");
  return value;
};

interface ProviderOutput {
  output: string;
  exitCode?: number;
  httpStatus?: number;
  tokens?: { input?: number; output?: number; total?: number };
}

const abortError = () => new DOMException("请求已取消", "AbortError");

const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError();
};

const runCodex = (
  provider: AiProviderConfig,
  prompt: string,
  schemaPath: string,
  outputPath: string,
  imagePath?: string,
  timeoutMs = 900_000,
  reasoningEffort: "low" | "medium" | "high" | "xhigh" = "xhigh",
  signal?: AbortSignal,
) => new Promise<ProviderOutput>((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError());
    return;
  }
  const model = assertModelName(provider.model);
  const child = spawn(
    "codex",
    [
      "-c",
      `model="${model}"`,
      "-c",
      "service_tier=fast",
      "-c",
      `model_reasoning_effort=${reasoningEffort}`,
      "exec",
      "--ephemeral",
      "-s",
      "workspace-write",
      "-C",
      process.cwd(),
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      ...(imagePath ? ["--image", imagePath] : []),
      prompt,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  let settled = false;
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    signal?.removeEventListener("abort", onAbort);
    callback();
  };
  const onAbort = () => {
    child.kill("SIGTERM");
    finish(() => reject(abortError()));
  };
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    finish(() => reject(new Error("Codex 成稿超时")));
  }, timeoutMs);
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });
  signal?.addEventListener("abort", onAbort, { once: true });
  child.stdout.resume();
  child.on("error", (error) => finish(() => reject(error)));
  child.on("close", (code) => {
    if (code !== 0) {
      finish(() => reject(new Error(readableCodexError(stderr, code))));
      return;
    }
    void readFile(outputPath, "utf8")
      .then((output) => finish(() => resolve({ output: output.trim(), exitCode: code ?? 0 })))
      .catch((error) => finish(() => reject(error)));
  });
});

const contentText = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => item && typeof item === "object" && "text" in item ? String(item.text) : "")
      .join("");
  }
  return "";
};

const runOpenAiCompatible = async (
  provider: AiProviderConfig,
  systemPrompt: string,
  userPrompt: string,
  imageDataUrl?: string,
  modelOverride?: string,
  options: {
    signal?: AbortSignal;
    fetcher?: typeof fetch;
    apiKey?: string;
  } = {},
): Promise<ProviderOutput> => {
  throwIfAborted(options.signal);
  const apiKey = options.apiKey ?? await getProviderApiKey(provider.id);
  const baseUrl = provider.baseUrl?.trim().replace(/\/+$/, "");
  if (!baseUrl) throw new Error("请先配置 API Base URL");
  const parsed = new URL(baseUrl);
  const local = ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && local)) {
    throw new Error("外部模型接口必须使用 HTTPS；本机接口可使用 127.0.0.1");
  }
  const endpoint = baseUrl.endsWith("/chat/completions") ? baseUrl : `${baseUrl}/chat/completions`;
  const fetcher = options.fetcher ?? fetch;
  const requestBody = JSON.stringify({
    model: assertModelName(modelOverride || provider.model),
    messages: [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: imageDataUrl
          ? [
              { type: "text", text: userPrompt },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ]
          : userPrompt,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.35,
  });
  const retryableStatuses = new Set([429, 502, 503]);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    throwIfAborted(options.signal);
    const timeoutSignal = AbortSignal.timeout(180_000);
    const requestSignal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;
    const response = await fetcher(endpoint, {
      method: "POST",
      signal: requestSignal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: requestBody,
    });
    const payload = await response.json().catch(() => ({})) as {
      error?: { message?: string };
      choices?: Array<{ message?: { content?: unknown } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    if (response.ok) {
      const output = contentText(payload.choices?.[0]?.message?.content).trim();
      if (!output) throw new Error("模型接口没有返回文章内容");
      return {
        output,
        httpStatus: response.status,
        tokens: payload.usage ? {
          input: payload.usage.prompt_tokens,
          output: payload.usage.completion_tokens,
          total: payload.usage.total_tokens,
        } : undefined,
      };
    }
    if (!retryableStatuses.has(response.status) || attempt === 2) {
      throw new Error(payload.error?.message || `模型接口请求失败：HTTP ${response.status}`);
    }
    const retryAfter = response.headers.get("retry-after");
    const retrySeconds = retryAfter && /^\d+(?:\.\d+)?$/.test(retryAfter)
      ? Number(retryAfter)
      : undefined;
    const delayMs = Math.min(10_000, retrySeconds === undefined ? 500 * (2 ** attempt) : retrySeconds * 1_000);
    await new Promise<void>((resolve, reject) => {
      if (!delayMs) {
        resolve();
        return;
      }
      const timer = setTimeout(resolve, delayMs);
      options.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(abortError());
      }, { once: true });
    });
  }
  throw new Error("模型接口重试次数已用完");
};

export interface ProviderRunInput {
  provider: AiProviderConfig;
  codexPrompt: string;
  apiSystemPrompt: string;
  apiUserPrompt: string;
  schemaPath: string;
  outputPath: string;
  apiImageDataUrl?: string;
  modelOverride?: string;
  codexImagePath?: string;
  codexReasoningEffort?: "low" | "medium" | "high" | "xhigh";
  codexTimeoutMs?: number;
  signal?: AbortSignal;
  /** Boundary injection used by tests and embedded runtimes. */
  fetcher?: typeof fetch;
  /** Optional already-resolved secret for an embedded runtime. */
  apiKey?: string;
}

export interface ProviderExecutionMeta {
  providerId: string;
  model: string;
  kind: AiProviderConfig["kind"];
  startedAt: string;
  completedAt: string;
  durationMs: number;
  exitCode?: number;
  httpStatus?: number;
  tokens?: { input?: number; output?: number; total?: number };
}

export interface ProviderRunResult {
  output: string;
  meta: ProviderExecutionMeta;
}

export const runGenerationProviderObserved = async (
  input: ProviderRunInput,
): Promise<ProviderRunResult> => {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const result = await executeGenerationProvider(input);
  const completedAt = new Date().toISOString();
  return {
    output: result.output,
    meta: {
      providerId: input.provider.id,
      model: input.modelOverride || input.provider.model,
      kind: input.provider.kind,
      startedAt,
      completedAt,
      durationMs: Math.max(0, Date.now() - started),
      exitCode: result.exitCode,
      httpStatus: result.httpStatus,
      tokens: result.tokens,
    },
  };
};

const executeGenerationProvider = async (input: ProviderRunInput): Promise<ProviderOutput> => {
  throwIfAborted(input.signal);
  if (input.provider.kind === "codex-cli") {
    return runCodex(
      input.provider,
      input.codexPrompt,
      input.schemaPath,
      input.outputPath,
      input.codexImagePath,
      input.codexTimeoutMs ?? 900_000,
      input.codexReasoningEffort,
      input.signal,
    );
  }
  return runOpenAiCompatible(
    input.provider,
    input.apiSystemPrompt,
    input.apiUserPrompt,
    input.apiImageDataUrl,
    input.modelOverride,
    { signal: input.signal, fetcher: input.fetcher, apiKey: input.apiKey },
  );
};

export const runGenerationProvider = async (input: ProviderRunInput) =>
  (await executeGenerationProvider(input)).output;
