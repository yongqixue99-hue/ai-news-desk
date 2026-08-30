import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const blockedHostnames = new Set(["localhost", "localhost.localdomain", "0.0.0.0", "::", "::1"]);
const redirectStatuses = new Set([301, 302, 303, 307, 308]);

const disallowedIpv4 = (address: string) => {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && (c === 0 || c === 2))
    || (a === 198 && (b === 18 || b === 19 || b === 51))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
};

const disallowedIpv6 = (address: string) => {
  const value = address.toLowerCase().split("%")[0];
  if (value === "::" || value === "::1") return true;
  if (value.startsWith("::ffff:")) {
    const mapped = value.slice("::ffff:".length);
    return isIP(mapped) === 4 ? disallowedIpv4(mapped) : true;
  }
  return value.startsWith("fc")
    || value.startsWith("fd")
    || /^fe[89ab]/.test(value)
    || value.startsWith("ff")
    || value.startsWith("2001:db8");
};

export const isDisallowedRemoteAddress = (address: string) => {
  const version = isIP(address);
  if (version === 4) return disallowedIpv4(address);
  if (version === 6) return disallowedIpv6(address);
  return true;
};

export const validateRemoteUrl = async (rawUrl: string | URL) => {
  const url = rawUrl instanceof URL ? new URL(rawUrl) : new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error("只允许读取 HTTP/HTTPS 地址");
  if (url.username || url.password) throw new Error("远程地址不能包含用户名或密码");
  const hostname = url.hostname.toLowerCase();
  if (blockedHostnames.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
    throw new Error("拒绝读取本机或局域网地址");
  }

  if (isIP(hostname)) {
    if (isDisallowedRemoteAddress(hostname)) throw new Error("拒绝读取私网、回环或保留地址");
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`无法解析远程地址：${hostname}`);
  }
  if (!addresses.length || addresses.some((entry) => isDisallowedRemoteAddress(entry.address))) {
    throw new Error("远程地址解析到了私网、回环或保留 IP");
  }
  return url;
};

export const fetchRemote = async (rawUrl: string | URL, init: RequestInit = {}, maxRedirects = 5) => {
  let current = await validateRemoteUrl(rawUrl);
  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (!redirectStatuses.has(response.status)) return response;
    const location = response.headers.get("location");
    if (!location) return response;
    if (redirects === maxRedirects) throw new Error("远程地址重定向次数过多");
    await response.body?.cancel().catch(() => undefined);
    current = await validateRemoteUrl(new URL(location, current));
  }
  throw new Error("远程地址重定向失败");
};

export const readResponseBuffer = async (response: Response, maximumBytes: number) => {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maximumBytes) throw new Error("远程响应超过允许大小");
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel().catch(() => undefined);
      throw new Error("远程响应超过允许大小");
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
};
