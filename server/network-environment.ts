import { isIP } from "node:net";

const explicitProxyKeys = ["http_proxy", "HTTP_PROXY", "https_proxy", "HTTPS_PROXY"] as const;
const optedOut = (env: NodeJS.ProcessEnv) => env.NODE_USE_ENV_PROXY?.trim() === "0";

/** Empty explicit values also prevent silently substituting system settings. */
export const shouldReadSystemProxy = (env: NodeJS.ProcessEnv, platform: string) => platform === "darwin"
  && !optedOut(env) && !explicitProxyKeys.some((key) => env[key] !== undefined);

const rootScutilProperties = (output: string) => {
  const properties: Record<string, string> = {};
  let depth = 0;
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (depth === 1) {
      const match = /^(HTTPEnable|HTTPSEnable|HTTPProxy|HTTPSProxy|HTTPPort|HTTPSPort)\s*:\s*([^{}]+)$/u.exec(trimmed);
      if (match) properties[match[1]!] = match[2]!.trim();
    }
    depth += (trimmed.match(/\{/gu) ?? []).length - (trimmed.match(/\}/gu) ?? []).length;
  }
  return properties;
};

const systemProxyUrl = (host: string | undefined, port: string | undefined) => {
  if (!host || !port || !/^\d{1,5}$/u.test(port) || Number(port) < 1 || Number(port) > 65535) return undefined;
  const unbracketed = host.replace(/^\[([^\]]+)\]$/u, "$1");
  const family = isIP(unbracketed);
  if (!family && (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/iu.test(host) || host.includes(".."))) return undefined;
  // macOS's HTTPS proxy setting names the HTTP CONNECT proxy, not the
  // destination's TLS policy. Do not import SOCKS or proxy credentials here.
  const hostname = family === 6 ? `[${unbracketed}]` : host;
  return `http://${hostname}:${Number(port)}`;
};

/** A pure environment copy. No network settings, credentials or files are changed. */
export const resolveNetworkEnvironment = (env: NodeJS.ProcessEnv, platform: string, scutilOutput?: string): NodeJS.ProcessEnv => {
  const resolved = { ...env };
  if (shouldReadSystemProxy(env, platform) && scutilOutput) {
    const settings = rootScutilProperties(scutilOutput);
    if (settings.HTTPEnable === "1") {
      const proxy = systemProxyUrl(settings.HTTPProxy, settings.HTTPPort);
      if (proxy) resolved.HTTP_PROXY = proxy;
    }
    if (settings.HTTPSEnable === "1") {
      const proxy = systemProxyUrl(settings.HTTPSProxy, settings.HTTPSPort);
      if (proxy) resolved.HTTPS_PROXY = proxy;
    }
  }
  // Node gives lowercase proxy variables precedence. Add local exceptions
  // only to that effective value, preserving the user's other settings.
  const noProxyKey = env.no_proxy !== undefined ? "no_proxy" : "NO_PROXY";
  const entries = (env[noProxyKey] ?? "").split(",").map((entry) => entry.trim()).filter(Boolean);
  // Undici compares IPv6 URL hostnames including brackets; bare ::1 alone
  // does not bypass its proxy agent for http://[::1]:port.
  for (const hostname of ["localhost", "127.0.0.1", "::1", "[::1]"]) {
    if (!entries.some((entry) => entry.toLowerCase() === hostname)) entries.push(hostname);
  }
  resolved[noProxyKey] = entries.join(",");
  return resolved;
};

/** Pass this environment when spawning Node, before its proxy agent is created. */
export const prepareNetworkLaunch = (env: NodeJS.ProcessEnv, supportsEnvironmentProxy: boolean): { env: NodeJS.ProcessEnv; warning?: string } => {
  const childEnv = { ...env };
  const hasProxy = Boolean((env.http_proxy ?? env.HTTP_PROXY ?? "").trim() || (env.https_proxy ?? env.HTTPS_PROXY ?? "").trim());
  if (!hasProxy || optedOut(env)) return { env: childEnv };
  if (!supportsEnvironmentProxy) return { env: childEnv,
    warning: "已检测到代理配置；当前 Node 尚不支持原生环境代理，部分新闻源可能无法连接。请升级到 Node 22.21 或更新的 22.x。" };
  childEnv.NODE_USE_ENV_PROXY = "1";
  return { env: childEnv };
};
