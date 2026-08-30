import { spawn } from "node:child_process";
import { fetchRemote, readResponseBuffer, validateRemoteUrl } from "./remote-url.js";
import { getProviderApiKey } from "./secrets.js";
import type {
  AiProviderConfig,
  ProviderHealthErrorCategory,
  ProviderHealthResult,
  ProviderHealthStatus,
} from "./types.js";

export interface ProviderHealthCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface ProviderHealthDependencies {
  now: () => Date;
  clock: () => number;
  getApiKey: (providerId: string) => Promise<string>;
  validateUrl: (url: string) => Promise<URL>;
  fetcher: (url: string | URL, init: RequestInit) => Promise<Response>;
  runCommand: (
    command: string,
    args: string[],
    timeoutMs: number,
  ) => Promise<ProviderHealthCommandResult>;
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const unsupportedModelsStatuses = new Set([404, 405, 501]);
const maximumProbeResponseBytes = 512 * 1024;
const providerProbeTimeoutMs = 7_000;
const codexProbeTimeoutMs = 5_000;

const validateProviderUrl = async (rawUrl: string) => {
  const url = new URL(rawUrl);
  if (url.username || url.password) throw new Error("接口地址不能包含用户名或密码");
  if (loopbackHosts.has(url.hostname.toLowerCase())) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error("本机接口必须使用 HTTP 或 HTTPS");
    return url;
  }
  if (url.protocol !== "https:") throw new Error("外部模型接口必须使用 HTTPS");
  return validateRemoteUrl(url);
};

const safeProviderFetch = async (rawUrl: string | URL, init: RequestInit) => {
  const url = rawUrl instanceof URL ? rawUrl : new URL(rawUrl);
  if (loopbackHosts.has(url.hostname.toLowerCase())) {
    // Loopback is an intentional local-provider escape hatch. Redirects are
    // disabled so a local endpoint cannot bounce the probe to another target.
    return fetch(url, { ...init, redirect: "error" });
  }
  return fetchRemote(url, init);
};

const runCommand = (
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<ProviderHealthCommandResult> => new Promise((resolve) => {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: { ...process.env, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let settled = false;
  const finish = (result: ProviderHealthCommandResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(result);
  };
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    finish({ exitCode: null, stdout, stderr, timedOut: true });
  }, timeoutMs);
  child.stdout.on("data", (chunk) => {
    stdout = `${stdout}${String(chunk)}`.slice(-20_000);
  });
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${String(chunk)}`.slice(-20_000);
  });
  child.on("error", (error) => finish({
    exitCode: null,
    stdout,
    stderr: `${stderr}\n${error.message}`,
    timedOut,
  }));
  child.on("close", (exitCode) => finish({ exitCode, stdout, stderr, timedOut }));
});

const defaultDependencies: ProviderHealthDependencies = {
  now: () => new Date(),
  clock: () => Date.now(),
  getApiKey: getProviderApiKey,
  validateUrl: validateProviderUrl,
  fetcher: safeProviderFetch,
  runCommand,
};

const resultFor = (
  provider: AiProviderConfig,
  startedAt: number,
  dependencies: ProviderHealthDependencies,
  status: ProviderHealthStatus,
  errorCategory: ProviderHealthErrorCategory,
  safeMessage: string,
): ProviderHealthResult => ({
  providerId: provider.id,
  lastCheckedAt: dependencies.now().toISOString(),
  status,
  latencyMs: Math.max(0, Math.round(dependencies.clock() - startedAt)),
  model: provider.model.trim(),
  errorCategory,
  safeMessage,
});

const outputFrom = (result: ProviderHealthCommandResult) => `${result.stdout}\n${result.stderr}`.toLowerCase();
const commandOk = (result: ProviderHealthCommandResult) => result.exitCode === 0 && !result.timedOut;
const looksLikeConfigError = (result: ProviderHealthCommandResult) =>
  /config\.toml|loading configuration|unknown variant|toml|configuration error/.test(outputFrom(result));
const looksLikeAuthError = (result: ProviderHealthCommandResult) =>
  /not logged|login required|authentication|unauthorized|sign in/.test(outputFrom(result));

const codexHealth = async (
  provider: AiProviderConfig,
  dependencies: ProviderHealthDependencies,
  startedAt: number,
) => {
  const version = await dependencies.runCommand("codex", ["--version"], codexProbeTimeoutMs);
  if (version.timedOut) {
    return resultFor(provider, startedAt, dependencies, "error", "timeout", "Codex CLI 响应超时；请在终端运行 codex --version 检查安装。");
  }
  if (!commandOk(version)) {
    return resultFor(provider, startedAt, dependencies, "error", "not-configured", "未找到可用的 Codex CLI；请安装或更新 @openai/codex，并确认 codex 在 PATH 中。");
  }

  const normalLogin = await dependencies.runCommand("codex", ["login", "status"], codexProbeTimeoutMs);
  let commandPrefix: string[] = [];
  let configWarning = false;
  if (!commandOk(normalLogin)) {
    // The currently installed CLI may reject a newer reasoning-effort value in
    // config.toml before it can read the saved ChatGPT login. This override is
    // diagnostic only and does not start a model request.
    const isolatedLogin = await dependencies.runCommand(
      "codex",
      ["-c", "service_tier=fast", "-c", "model_reasoning_effort=xhigh", "login", "status"],
      codexProbeTimeoutMs,
    );
    if (!commandOk(isolatedLogin)) {
      if (normalLogin.timedOut || isolatedLogin.timedOut) {
        return resultFor(provider, startedAt, dependencies, "error", "timeout", "检查 Codex 登录状态超时；请在终端运行 codex login status 后重试。");
      }
      if (looksLikeAuthError(normalLogin) || looksLikeAuthError(isolatedLogin)) {
        return resultFor(provider, startedAt, dependencies, "error", "auth", "Codex CLI 可用，但没有有效的 ChatGPT 登录；请在终端运行 codex login 后重试。");
      }
      if (looksLikeConfigError(normalLogin) || looksLikeConfigError(isolatedLogin)) {
        return resultFor(provider, startedAt, dependencies, "error", "config", "Codex 配置无法读取；请检查 ~/.codex/config.toml 中的 service_tier 与 model_reasoning_effort，或更新 Codex CLI 后重试。");
      }
      return resultFor(provider, startedAt, dependencies, "error", "unknown", "Codex 登录诊断未通过；请在终端运行 codex login status 查看并修复。");
    }
    commandPrefix = ["-c", "service_tier=fast", "-c", "model_reasoning_effort=xhigh"];
    configWarning = looksLikeConfigError(normalLogin);
  }

  const execHelp = await dependencies.runCommand(
    "codex",
    [...commandPrefix, "exec", "--help"],
    codexProbeTimeoutMs,
  );
  if (!commandOk(execHelp)) {
    return resultFor(provider, startedAt, dependencies, "error", execHelp.timedOut ? "timeout" : "config", "Codex 已登录，但非交互命令不可用；请更新 Codex CLI，并在终端运行 codex exec --help 检查。");
  }
  if (configWarning) {
    return resultFor(provider, startedAt, dependencies, "warning", "config", "ChatGPT 登录有效，但 ~/.codex/config.toml 与当前 CLI 不兼容；工作台已使用兼容覆盖，仍建议更新 Codex CLI。");
  }

  const versionLabel = version.stdout.match(/codex(?:-cli)?\s+([\w.-]+)/i)?.[1];
  return resultFor(
    provider,
    startedAt,
    dependencies,
    "healthy",
    "none",
    versionLabel ? `Codex ${versionLabel} 已登录，非交互能力正常；本次未调用模型。` : "Codex 已登录，非交互能力正常；本次未调用模型。",
  );
};

const providerUrls = (provider: AiProviderConfig) => {
  const baseUrl = provider.baseUrl?.trim().replace(/\/+$/, "") || "";
  const apiRoot = baseUrl.replace(/\/chat\/completions$/i, "");
  return {
    models: `${apiRoot}/models`,
    chat: /\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`,
  };
};

const categoryForHttp = (status: number): ProviderHealthErrorCategory => {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate-limit";
  if (status >= 500) return "server";
  if (status === 400 || status === 404 || status === 422) return "model";
  return "unknown";
};

const messageForHttp = (status: number, endpoint: "models" | "chat") => {
  if (status === 401 || status === 403) return "认证失败；请重新保存 API Key，并确认它有访问所选模型的权限。";
  if (status === 429) return "厂商接口正在限流或账户额度不足；请稍后重试并检查额度。";
  if (status >= 500) return `厂商接口暂时不可用（HTTP ${status}）；请稍后重试。`;
  if (endpoint === "chat" && [400, 404, 422].includes(status)) return `最小模型检查未通过（HTTP ${status}）；请核对模型名称和 API Base URL。`;
  return `接口检查未通过（HTTP ${status}）；请核对 API Base URL 与厂商状态。`;
};

const limitedJson = async (response: Response) => {
  const buffer = await readResponseBuffer(response, maximumProbeResponseBytes);
  if (!buffer.length) return undefined;
  try {
    return JSON.parse(buffer.toString("utf8")) as unknown;
  } catch {
    return undefined;
  }
};

const errorResult = (
  provider: AiProviderConfig,
  dependencies: ProviderHealthDependencies,
  startedAt: number,
  error: unknown,
) => {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "TimeoutError" || name === "AbortError" || /timed?\s*out|timeout/i.test(message)) {
    return resultFor(provider, startedAt, dependencies, "error", "timeout", "连接模型接口超时；请检查网络、代理或 API Base URL 后重试。");
  }
  if (/api key|钥匙串|尚未配置|not configured/i.test(message)) {
    return resultFor(provider, startedAt, dependencies, "error", "not-configured", "尚未找到这个厂商的 API Key；请先保存密钥再测试。");
  }
  if (/https|地址|url|私网|回环|保留|解析|用户名|密码/i.test(message)) {
    return resultFor(provider, startedAt, dependencies, "error", "config", "API Base URL 不可用；外部接口需使用 HTTPS，且不能指向私网地址。");
  }
  return resultFor(provider, startedAt, dependencies, "error", "network", "无法连接模型接口；请检查网络、代理与厂商服务状态后重试。");
};

const compatibleHealth = async (
  provider: AiProviderConfig,
  dependencies: ProviderHealthDependencies,
  startedAt: number,
) => {
  if (!provider.model.trim()) {
    return resultFor(provider, startedAt, dependencies, "error", "not-configured", "尚未填写模型名称；请先配置后再测试。");
  }
  if (!provider.baseUrl?.trim()) {
    return resultFor(provider, startedAt, dependencies, "error", "not-configured", "尚未填写 API Base URL；请先配置后再测试。");
  }

  try {
    const apiKey = await dependencies.getApiKey(provider.id);
    const urls = providerUrls(provider);
    const modelsUrl = await dependencies.validateUrl(urls.models);
    const modelsResponse = await dependencies.fetcher(modelsUrl, {
      method: "GET",
      signal: AbortSignal.timeout(providerProbeTimeoutMs),
      headers: { authorization: `Bearer ${apiKey}`, accept: "application/json" },
    });

    if (modelsResponse.ok) {
      const payload = await limitedJson(modelsResponse) as { data?: Array<{ id?: unknown }> } | undefined;
      const modelIds = Array.isArray(payload?.data)
        ? payload.data.flatMap((entry) => typeof entry?.id === "string" ? [entry.id] : [])
        : [];
      if (!modelIds.length) {
        return resultFor(provider, startedAt, dependencies, "warning", "invalid-response", "接口认证成功，但 /models 返回格式不标准；请确认该地址兼容 OpenAI API。");
      }
      if (!modelIds.includes(provider.model)) {
        return resultFor(provider, startedAt, dependencies, "warning", "model", `接口认证成功，但模型列表中未发现 ${provider.model}；请核对模型名称。`);
      }
      return resultFor(provider, startedAt, dependencies, "healthy", "none", "API Key 与模型列表检查通过；本次没有生成内容，也未消耗生成 token。");
    }

    if (!unsupportedModelsStatuses.has(modelsResponse.status)) {
      await modelsResponse.body?.cancel().catch(() => undefined);
      return resultFor(
        provider,
        startedAt,
        dependencies,
        "error",
        categoryForHttp(modelsResponse.status),
        messageForHttp(modelsResponse.status, "models"),
      );
    }
    await modelsResponse.body?.cancel().catch(() => undefined);

    const chatUrl = await dependencies.validateUrl(urls.chat);
    const chatResponse = await dependencies.fetcher(chatUrl, {
      method: "POST",
      signal: AbortSignal.timeout(providerProbeTimeoutMs),
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        model: provider.model,
        messages: [{ role: "user", content: "Reply OK." }],
        max_tokens: 1,
        temperature: 0,
        stream: false,
      }),
    });
    if (!chatResponse.ok) {
      await chatResponse.body?.cancel().catch(() => undefined);
      return resultFor(
        provider,
        startedAt,
        dependencies,
        "error",
        categoryForHttp(chatResponse.status),
        messageForHttp(chatResponse.status, "chat"),
      );
    }
    const payload = await limitedJson(chatResponse) as { choices?: unknown[] } | undefined;
    if (!Array.isArray(payload?.choices)) {
      return resultFor(provider, startedAt, dependencies, "warning", "invalid-response", "最小请求已被接口接受，但响应格式不标准；请确认该地址兼容 Chat Completions。");
    }
    return resultFor(provider, startedAt, dependencies, "healthy", "none", "厂商不提供 /models，已用最多 1 token 的最小请求验证连接；没有生成草稿。");
  } catch (error) {
    return errorResult(provider, dependencies, startedAt, error);
  }
};

export const probeProviderConnection = async (
  provider: AiProviderConfig,
  overrides: Partial<ProviderHealthDependencies> = {},
): Promise<ProviderHealthResult> => {
  const dependencies = { ...defaultDependencies, ...overrides };
  const startedAt = dependencies.clock();
  return provider.kind === "codex-cli"
    ? codexHealth(provider, dependencies, startedAt)
    : compatibleHealth(provider, dependencies, startedAt);
};
