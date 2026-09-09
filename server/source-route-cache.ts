import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fetchRemote } from "./remote-url.js";
import type { RawHorizonItem } from "./types.js";

const maximumEntries = 64;
const maximumStorageBytes = 8 * 1024 * 1024;
const maximumEntryBytes = 2 * 1024 * 1024;
const maximumBackoffMs = 30 * 60_000;
const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const cacheFilename = "source-routes-v1.json";

export type SourceRouteReadErrorCode = "backoff" | "http" | "network" | "parse" | "size" | "invalid-not-modified" | "configuration";

/** Safe diagnostics only: upstream response bodies and exception text are never exposed. */
export class SourceRouteReadError extends Error {
  readonly code: SourceRouteReadErrorCode;
  readonly statusCode?: number;
  retryAt?: string;

  constructor(message: string, code: SourceRouteReadErrorCode, details: { statusCode?: number; retryAt?: string } = {}) {
    super(message);
    this.name = "SourceRouteReadError";
    this.code = code;
    this.statusCode = details.statusCode;
    this.retryAt = details.retryAt;
  }
}

export interface SourceRouteCacheStorage {
  read(): Promise<string | undefined>;
  write(content: string): Promise<void>;
}

export interface SourceRouteReadRequest {
  sourceId: string;
  url: string;
  format?: string;
  /** Bump when parser semantics or source provenance inputs change. */
  parserVersion?: string;
  /** Date/evidence enrichment must not borrow metadata from a redirected article. */
  samePageOnly?: boolean;
  init?: RequestInit;
  maxBytes: number;
  parse(content: string): RawHorizonItem[];
}

export interface SourceRouteReadResult {
  items: RawHorizonItem[];
  cacheStatus: "fresh" | "not-modified";
  /** Last HTTP 200 / 304 validation, never substituted for an event's publication date. */
  lastSuccessfulAt: string;
}

interface CacheEntry {
  key: string;
  items?: RawHorizonItem[];
  etag?: string;
  lastModified?: string;
  lastSuccessfulAt?: string;
  consecutiveFailures: number;
  retryAt?: string;
  lastUsedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const validTime = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const validHttpUrl = (value: unknown) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch { return false; }
};
const validItems = (value: unknown): value is RawHorizonItem[] => Array.isArray(value) && value.length <= 100 && value.every((entry) =>
  isRecord(entry)
  && [entry.id, entry.source_type, entry.title].every((field) => typeof field === "string" && field.length > 0)
  && validHttpUrl(entry.url)
  && [entry.content, entry.author, entry.published_at, entry.fetched_at].every((field) => field === undefined || typeof field === "string")
  && (entry.metadata === undefined || isRecord(entry.metadata)),
);
const safeValidator = (value: string | null | undefined, limit: number) =>
  value && value.length <= limit && !/[\u0000-\u001f\u007f\u0100-\uffff]/.test(value) ? value : undefined;
const isUserCancellation = (signal?: AbortSignal | null) => signal?.aborted && (signal.reason as { name?: string } | undefined)?.name !== "TimeoutError";

// Storage has no AbortSignal interface. Stop waiting without interrupting an atomic write.
const unlessCancelled = <T>(operation: Promise<T>, signal?: AbortSignal | null): Promise<T> => {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    operation.then((value) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else resolve(value);
    }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
};

const fileStorage = (directory: string): SourceRouteCacheStorage => ({
  async read() {
    const file = join(directory, cacheFilename);
    // Do not read through an unexpected symlink or deserialize an unbounded file.
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > maximumStorageBytes) return undefined;
    return readFile(file, "utf8");
  },
  async write(content) {
    await mkdir(directory, { recursive: true });
    const temporary = join(directory, `.source-routes-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, content, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await rename(temporary, join(directory, cacheFilename));
    } finally { await unlink(temporary).catch(() => undefined); }
  },
});

interface QueueEntry {
  resolve(release: () => void): void;
  reject(reason: unknown): void;
  signal?: AbortSignal | null;
  abort(): void;
}

const createHostLimiter = () => {
  const hosts = new Map<string, { active: number; queue: QueueEntry[] }>();
  return (hostname: string, signal?: AbortSignal | null): Promise<() => void> => {
    signal?.throwIfAborted();
    const host = hosts.get(hostname) ?? { active: 0, queue: [] };
    hosts.set(hostname, host);
    const grant = () => {
      host.active += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        host.active -= 1;
        while (host.queue.length && host.active < 2) {
          const next = host.queue.shift()!;
          next.signal?.removeEventListener("abort", next.abort);
          if (next.signal?.aborted) next.reject(next.signal.reason);
          else next.resolve(grant());
        }
        if (!host.active && !host.queue.length) hosts.delete(hostname);
      };
    };
    if (host.active < 2) return Promise.resolve(grant());
    return new Promise((resolve, reject) => {
      const entry: QueueEntry = {
        resolve, reject, signal,
        abort() {
          const index = host.queue.indexOf(entry);
          if (index >= 0) host.queue.splice(index, 1);
          signal?.removeEventListener("abort", entry.abort);
          reject(signal?.reason);
        },
      };
      host.queue.push(entry);
      signal?.addEventListener("abort", entry.abort, { once: true });
      if (signal?.aborted) entry.abort();
    });
  };
};

const readBody = async (response: Response, maxBytes: number, signal?: AbortSignal | null) => {
  if (Number(response.headers.get("content-length") || 0) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SourceRouteReadError("来源响应超过允许大小", "size");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    signal?.throwIfAborted();
    while (true) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new SourceRouteReadError("来源响应超过允许大小", "size");
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    signal?.removeEventListener("abort", abort);
    reader.releaseLock();
  }
};

export const createSourceRouteReader = (options: {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
  cacheDirectory?: string;
  storage?: SourceRouteCacheStorage;
  now?: () => Date | string | number;
} = {}) => {
  const fetcher = options.fetcher ?? ((url: string, init: RequestInit) => fetchRemote(url, init, 3));
  const storage = options.storage ?? (options.cacheDirectory ? fileStorage(options.cacheDirectory) : undefined);
  const entries = new Map<string, CacheEntry>();
  const sizes = new Map<string, number>();
  const acquire = createHostLimiter();
  const now = () => new Date(options.now?.() ?? Date.now()).getTime();
  let totalBytes = 0;
  let initialized: Promise<void> | undefined;
  let writing = Promise.resolve();

  const remove = (key: string) => {
    totalBytes -= sizes.get(key) ?? 0;
    sizes.delete(key);
    entries.delete(key);
  };
  const put = (entry: CacheEntry) => {
    remove(entry.key);
    const bytes = Buffer.byteLength(JSON.stringify(entry), "utf8");
    if (bytes > maximumEntryBytes) return;
    // Map insertion order is the LRU order; dates are diagnostic, not eviction authority.
    entries.set(entry.key, entry);
    sizes.set(entry.key, bytes);
    totalBytes += bytes;
    while (entries.size > maximumEntries || totalBytes + 1024 > maximumStorageBytes) remove(entries.keys().next().value!);
  };
  const initialize = () => initialized ??= (async () => {
    if (!storage) return;
    try {
      const content = await storage.read();
      if (!content || Buffer.byteLength(content, "utf8") > maximumStorageBytes) return;
      const document: unknown = JSON.parse(content);
      if (!isRecord(document) || document.schema !== 1 || !Array.isArray(document.entries) || document.entries.length > maximumEntries) return;
      for (const value of document.entries) {
        if (!isRecord(value) || typeof value.key !== "string" || !/^[a-f0-9]{64}$/.test(value.key)
          || !Number.isInteger(value.consecutiveFailures) || Number(value.consecutiveFailures) < 0 || Number(value.consecutiveFailures) > 20
          || typeof value.lastUsedAt !== "number" || !Number.isFinite(value.lastUsedAt)
          || (value.items !== undefined && (!validItems(value.items) || !validTime(value.lastSuccessfulAt)))
          || (value.retryAt !== undefined && !validTime(value.retryAt))) continue;
        const entry: CacheEntry = {
          key: value.key, consecutiveFailures: Number(value.consecutiveFailures), lastUsedAt: value.lastUsedAt,
          ...(value.items !== undefined ? { items: value.items as RawHorizonItem[], lastSuccessfulAt: value.lastSuccessfulAt as string } : {}),
          etag: typeof value.etag === "string" ? safeValidator(value.etag, 1024) : undefined,
          lastModified: typeof value.lastModified === "string" ? safeValidator(value.lastModified, 128) : undefined,
          ...(validTime(value.retryAt) && Date.parse(value.retryAt) <= now() + maximumBackoffMs ? { retryAt: value.retryAt } : {}),
        };
        put(entry);
      }
    } catch { /* Cache absence, corruption, or I/O failure must not disable network collection. */ }
  })();
  const persist = () => {
    if (!storage) return Promise.resolve();
    writing = writing.then(async () => {
      const content = JSON.stringify({ schema: 1, entries: [...entries.values()] });
      if (Buffer.byteLength(content, "utf8") <= maximumStorageBytes) await storage.write(content);
    }).catch(() => undefined);
    return writing;
  };

  const read = async (request: SourceRouteReadRequest): Promise<SourceRouteReadResult> => {
    const signal = request.init?.signal;
    signal?.throwIfAborted();
    if (!validHttpUrl(request.url) || (request.init?.method ?? "GET").toUpperCase() !== "GET" || request.init?.body
      || !Number.isInteger(request.maxBytes) || request.maxBytes < 1 || request.maxBytes > maximumStorageBytes) {
      throw new SourceRouteReadError("来源缓存仅支持有界的 HTTP/HTTPS GET 读取", "configuration");
    }
    const headers = new Headers(request.init?.headers);
    // Callers cannot accidentally condition a request against a different cached representation.
    headers.delete("if-none-match");
    headers.delete("if-modified-since");
    const key = createHash("sha256").update(JSON.stringify([
      request.sourceId, request.url, request.format ?? "feed", request.parserVersion ?? "v1", Boolean(request.samePageOnly), [...headers.entries()],
    ])).digest("hex");
    await unlessCancelled(initialize(), signal);
    signal?.throwIfAborted();
    const release = await acquire(new URL(request.url).hostname, signal);
    try {
      let cached = entries.get(key);
      if (cached?.retryAt && Date.parse(cached.retryAt) > now()) {
        throw new SourceRouteReadError(`来源暂缓重试，下次可读取时间：${cached.retryAt}`, "backoff", { retryAt: cached.retryAt });
      }
      if (cached?.items && cached.etag) headers.set("if-none-match", cached.etag);
      if (cached?.items && cached.lastModified) headers.set("if-modified-since", cached.lastModified);
      let retryAfter: string | null = null;
      try {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          signal?.throwIfAborted();
          let response: Response;
          try { response = await fetcher(request.url, { ...request.init, headers, signal }); }
          catch (error) {
            if (isUserCancellation(signal)) throw signal!.reason;
            throw new SourceRouteReadError("来源连接失败，请稍后重试", "network");
          }
          if (signal?.aborted) {
            await response.body?.cancel().catch(() => undefined);
            signal.throwIfAborted();
          }
          if (request.samePageOnly && response.url) {
            const expected = new URL(request.url);
            const actual = new URL(response.url);
            if (expected.origin !== actual.origin || expected.pathname.replace(/\/$/u, "") !== actual.pathname.replace(/\/$/u, "")
              || expected.search !== actual.search) {
              await response.body?.cancel().catch(() => undefined);
              throw new SourceRouteReadError("来源跳转到了其他页面，不能沿用其发布时间或正文", "parse");
            }
          }
          const noStore = /(?:^|,)\s*no-store(?:\s|,|$)/i.test(response.headers.get("cache-control") ?? "")
            || (response.headers.get("vary") ?? "").split(",").some((field) => field.trim() === "*");
          if (response.status === 304) {
            await response.body?.cancel().catch(() => undefined);
            if (cached?.items && (headers.has("if-none-match") || headers.has("if-modified-since"))) {
              const at = new Date(now()).toISOString();
              const items = structuredClone(cached.items).map((entry) => ({ ...entry, fetched_at: at }));
              if (noStore) remove(key);
              else put({ ...cached, items, lastSuccessfulAt: at, lastUsedAt: now(), consecutiveFailures: 0, retryAt: undefined,
                etag: safeValidator(response.headers.get("etag"), 1024) ?? cached.etag,
                lastModified: safeValidator(response.headers.get("last-modified"), 128) ?? cached.lastModified });
              await unlessCancelled(persist(), signal);
              return { items: structuredClone(items), cacheStatus: "not-modified", lastSuccessfulAt: at };
            }
            headers.delete("if-none-match");
            headers.delete("if-modified-since");
            if (attempt === 0) continue;
            throw new SourceRouteReadError("来源返回未修改，但没有可验证的缓存；无条件重读仍未返回正文", "invalid-not-modified", { statusCode: 304 });
          }
          if (!response.ok) {
            retryAfter = response.headers.get("retry-after");
            await response.body?.cancel().catch(() => undefined);
            throw new SourceRouteReadError(`来源返回 HTTP ${response.status}`, "http", { statusCode: response.status });
          }
          let content: string;
          try { content = await readBody(response, request.maxBytes, signal); }
          catch (error) {
            if (isUserCancellation(signal)) throw signal!.reason;
            if (error instanceof SourceRouteReadError) throw error;
            throw new SourceRouteReadError("来源正文读取中断，请稍后重试", "network");
          }
          let items: RawHorizonItem[];
          try {
            const parsed = request.parse(content);
            if (!validItems(parsed)) throw new Error("Invalid records");
            items = JSON.parse(JSON.stringify(parsed)) as RawHorizonItem[];
          } catch { throw new SourceRouteReadError("来源内容解析失败，本次内容未写入缓存", "parse"); }
          signal?.throwIfAborted();
          const at = new Date(now()).toISOString();
          if (noStore) remove(key);
          else put({ key, items, lastSuccessfulAt: at, lastUsedAt: now(), consecutiveFailures: 0,
            etag: safeValidator(response.headers.get("etag"), 1024),
            lastModified: safeValidator(response.headers.get("last-modified"), 128) });
          await unlessCancelled(persist(), signal);
          return { items: structuredClone(items), cacheStatus: "fresh", lastSuccessfulAt: at };
        }
        throw new SourceRouteReadError("来源读取未完成", "network");
      } catch (error) {
        if (isUserCancellation(signal)) throw signal!.reason;
        const failure = error instanceof SourceRouteReadError ? error : new SourceRouteReadError("来源读取超时，请稍后重试", "network");
        if (failure.code === "network" || (failure.statusCode !== undefined && transientStatuses.has(failure.statusCode))) {
          cached = entries.get(key);
          const consecutiveFailures = Math.min(20, (cached?.consecutiveFailures ?? 0) + 1);
          let delay = Math.min(maximumBackoffMs, 30_000 * 2 ** (consecutiveFailures - 1));
          if (retryAfter && [429, 503].includes(failure.statusCode ?? 0)) {
            const requested = /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) * 1000 : Date.parse(retryAfter) - now();
            if (Number.isFinite(requested)) delay = Math.max(0, Math.min(maximumBackoffMs, requested));
          }
          failure.retryAt = new Date(now() + delay).toISOString();
          put({ ...cached, key, consecutiveFailures, retryAt: failure.retryAt, lastUsedAt: now() });
          await unlessCancelled(persist(), signal).catch(() => undefined);
        }
        throw failure;
      }
    } finally { release(); }
  };
  return { read };
};

export type SourceRouteReader = ReturnType<typeof createSourceRouteReader>;
