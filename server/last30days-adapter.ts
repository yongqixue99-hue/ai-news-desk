import { spawn } from "node:child_process";
import { access, mkdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { workflowRoot } from "./storage.js";

const MINIMUM_PYTHON = [3, 12] as const;
const DEFAULT_TIMEOUT_MS = 240_000;

interface CommandOutput {
  stdout: string;
  stderr: string;
}

export type Last30DaysCommandRunner = (
  command: string,
  args: string[],
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeoutMs: number;
    signal?: AbortSignal;
  },
) => Promise<CommandOutput>;

export interface Last30DaysStatus {
  installed: boolean;
  setupComplete: boolean;
  browserConsent: boolean;
  pythonPath?: string;
  ready: boolean;
  detail: string;
  skillDir: string;
}

export interface Last30DaysDiscoveryTopic {
  rank: number;
  topic: string;
  whySpiking: string;
  momentum: "new-this-week" | "building";
  velocityScore: number;
  sources: string[];
  evidenceUrls: string[];
  topComment?: string;
  corroborationCount: number;
}

export interface Last30DaysDiscovery {
  domain: string;
  generatedAt: string;
  windowDays: number;
  topics: Last30DaysDiscoveryTopic[];
  warnings: string[];
  outcome: string;
}

interface AdapterOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  skillDir?: string;
  runCommand?: Last30DaysCommandRunner;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const truthy = (value: unknown) => /^(?:1|true|yes|on)$/iu.test(String(value ?? "").trim());

const defaultRunCommand: Last30DaysCommandRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...options.env, PYTHONUNBUFFERED: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("last30days 采集已取消")));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("last30days 社区趋势采集超时")));
    }, options.timeoutMs);
    if (options.signal?.aborted) {
      abort();
      return;
    }
    options.signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", (error) => finish(() => reject(error)));
    child.on("close", (code) => finish(() => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `last30days 退出码 ${code}`));
    }));
  });

const readEnvFlags = async (
  filePath: string,
): Promise<{ setupComplete: boolean; browserConsent: boolean }> => {
  try {
    const content = await readFile(filePath, "utf8");
    const valueFor = (key: string) => {
      const match = content.match(new RegExp(`^\\s*${key}\\s*=\\s*([^#\\r\\n]+)`, "mu"));
      return match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
    };
    return {
      setupComplete: truthy(valueFor("SETUP_COMPLETE")),
      browserConsent: truthy(valueFor("BROWSER_CONSENT")),
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { setupComplete: false, browserConsent: false };
    }
    throw error;
  }
};

const pythonVersion = (stdout: string) => {
  const match = stdout.trim().match(/^(\d+)\.(\d+)$/u);
  return match ? [Number(match[1]), Number(match[2])] as const : undefined;
};

const supportedPython = (version?: readonly [number, number]) => Boolean(
  version && (
    version[0] > MINIMUM_PYTHON[0]
    || (version[0] === MINIMUM_PYTHON[0] && version[1] >= MINIMUM_PYTHON[1])
  ),
);

const resolvePython = async (
  options: Required<Pick<AdapterOptions, "cwd" | "env" | "runCommand">>,
) => {
  const candidates = [...new Set([
    options.env.LAST30DAYS_PYTHON,
    "python3.14",
    "python3.13",
    "python3.12",
    "python3",
  ].filter((value): value is string => Boolean(value?.trim())))];
  for (const command of candidates) {
    try {
      const output = await options.runCommand(command, [
        "-c",
        "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')",
      ], {
        cwd: options.cwd,
        env: options.env,
        timeoutMs: 5_000,
      });
      if (supportedPython(pythonVersion(output.stdout))) return command;
    } catch {
      // Try the next interpreter without turning a missing command into noise.
    }
  }
  return undefined;
};

const normalizedOptions = (options: AdapterOptions = {}) => ({
  cwd: options.cwd ?? process.cwd(),
  env: options.env ?? process.env,
  homeDir: options.homeDir ?? os.homedir(),
  skillDir: options.skillDir
    ?? options.env?.LAST30DAYS_SKILL_DIR
    ?? process.env.LAST30DAYS_SKILL_DIR
    ?? path.join(options.homeDir ?? os.homedir(), ".codex", "skills", "last30days"),
  runCommand: options.runCommand ?? defaultRunCommand,
  signal: options.signal,
  timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
});

export const getLast30DaysStatus = async (
  options: AdapterOptions = {},
): Promise<Last30DaysStatus> => {
  const normalized = normalizedOptions(options);
  const scriptPath = path.join(normalized.skillDir, "scripts", "last30days.py");
  const installed = await access(scriptPath).then(() => true).catch(() => false);
  const globalFlags = await readEnvFlags(path.join(normalized.homeDir, ".config", "last30days", ".env"));
  const projectFlags = truthy(normalized.env.LAST30DAYS_TRUST_PROJECT_CONFIG)
    ? await readEnvFlags(path.join(normalized.cwd, ".claude", "last30days.env"))
    : { setupComplete: false, browserConsent: false };
  const setupComplete = truthy(normalized.env.SETUP_COMPLETE)
    || globalFlags.setupComplete
    || projectFlags.setupComplete;
  const browserConsent = truthy(normalized.env.BROWSER_CONSENT)
    || globalFlags.browserConsent
    || projectFlags.browserConsent;
  const pythonPath = installed
    ? await resolvePython({
        cwd: normalized.skillDir,
        env: normalized.env,
        runCommand: normalized.runCommand,
      })
    : undefined;
  const ready = installed && setupComplete && Boolean(pythonPath);
  const detail = !installed
    ? "未安装 last30days Skill"
    : !setupComplete
      ? "尚未完成首次初始化；请在 Codex 中启动 last30days 并选择是否授权浏览器 Cookie"
      : !pythonPath
        ? "last30days 需要 Python 3.12 或更高版本"
        : browserConsent
          ? "last30days 已就绪；会遵循你已保存的浏览器 Cookie 授权"
          : "last30days 已就绪；当前未授权读取浏览器 Cookie，仍可使用免登录社区源";
  return {
    installed,
    setupComplete,
    browserConsent,
    pythonPath,
    ready,
    detail,
    skillDir: normalized.skillDir,
  };
};

const parseJsonObject = (stdout: string) => {
  const trimmed = stdout.trim();
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
  } catch {
    const lines = trimmed.split(/\r?\n/u);
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const candidate = lines.slice(index).join("\n").trim();
      if (!candidate.startsWith("{")) continue;
      try {
        const parsed = JSON.parse(candidate) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
      } catch {
        // Keep looking for the beginning of the final JSON object.
      }
    }
  }
  throw new Error("last30days 没有返回可识别的趋势 JSON");
};

const stringList = (value: unknown) => Array.isArray(value)
  ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
  : [];

const finiteNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const httpUrls = (value: unknown) => stringList(value).flatMap((item) => {
  try {
    const url = new URL(item);
    return ["http:", "https:"].includes(url.protocol) ? [url.toString()] : [];
  } catch {
    return [];
  }
});

export const parseLast30DaysDiscovery = (stdout: string): Last30DaysDiscovery => {
  const payload = parseJsonObject(stdout);
  if (payload.kind !== "discovery" || !Array.isArray(payload.results)) {
    throw new Error("last30days 返回的不是 discovery 结果");
  }
  const topics = payload.results.flatMap<Last30DaysDiscoveryTopic>((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const row = value as Record<string, unknown>;
    const topic = typeof row.topic === "string" ? row.topic.trim() : "";
    const evidenceUrls = httpUrls(row.evidence_urls);
    if (!topic || !evidenceUrls.length) return [];
    return [{
      rank: Math.max(1, Math.round(finiteNumber(row.rank, 1))),
      topic,
      whySpiking: typeof row.why_spiking === "string" ? row.why_spiking.trim() : "",
      momentum: row.momentum === "building" ? "building" : "new-this-week",
      velocityScore: finiteNumber(row.velocity_score),
      sources: stringList(row.sources),
      evidenceUrls,
      topComment: typeof row.top_comment === "string" && row.top_comment.trim()
        ? row.top_comment.trim()
        : undefined,
      corroborationCount: Math.max(0, Math.round(finiteNumber(row.corroboration_count))),
    }];
  });
  return {
    domain: typeof payload.domain === "string" ? payload.domain : "",
    generatedAt: typeof payload.generated_at === "string" ? payload.generated_at : new Date().toISOString(),
    windowDays: Math.max(1, Math.round(finiteNumber(payload.window_days, 30))),
    topics,
    warnings: stringList(payload.warnings),
    outcome: typeof payload.outcome === "string" ? payload.outcome : topics.length ? "ok" : "nothing-solid",
  };
};

export const discoverLast30Days = async (
  domain: string,
  options: AdapterOptions = {},
): Promise<Last30DaysDiscovery> => {
  const normalized = normalizedOptions(options);
  const status = await getLast30DaysStatus(normalized);
  if (!status.ready || !status.pythonPath) throw new Error(status.detail);
  const saveDir = path.join(workflowRoot, "last30days");
  await mkdir(saveDir, { recursive: true });
  const scriptPath = path.join(status.skillDir, "scripts", "last30days.py");
  const output = await normalized.runCommand(status.pythonPath, [
    scriptPath,
    `--discover=${domain.trim()}`,
    "--discover-shallow",
    "--lookback-days=30",
    "--emit=json",
    "--json-profile=agent",
    "--no-verify-freshness",
    "--save-dir",
    saveDir,
  ], {
    cwd: status.skillDir,
    env: normalized.env,
    timeoutMs: normalized.timeoutMs,
    signal: normalized.signal,
  });
  return parseLast30DaysDiscovery(output.stdout);
};
