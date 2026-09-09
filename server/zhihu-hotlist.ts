import { execFile } from "node:child_process";
import { promisify } from "node:util";

export interface ZhihuHotItem {
  id: string;
  title: string;
  url: string;
  rank: number;
  heat?: string;
  answers?: number;
}

export interface ZhihuHotSnapshot {
  items: ZhihuHotItem[];
  capturedAt?: string;
  attemptedAt: string;
  retryAt: string;
  error?: string;
}

export interface ZhihuHotView {
  status: "ready" | "stale" | "unavailable" | "unread";
  items: ZhihuHotItem[];
  capturedAt?: string;
  retryAt?: string;
  error?: string;
}

const freshForMs = 15 * 60_000;
const cooldownMs = 60_000;
const execute = promisify(execFile);
class ConnectionUnavailable extends Error {}

export const readZhihuHotCommand = async (): Promise<string> => {
  // The daemon status contains no credentials. Only fail early on an explicit
  // disconnected state; an absent daemon can still be started by the CLI.
  const status = await fetch("http://127.0.0.1:19825/status", {
    headers: { "X-OpenCLI": "1" }, signal: AbortSignal.timeout(1_500),
  }).then(async (response) => response.ok ? response.json() as Promise<{ ok?: boolean; extensionConnected?: boolean; profileRequired?: boolean }> : undefined)
    .catch(() => undefined);
  if (status?.ok && status.extensionConnected === false) {
    throw new ConnectionUnavailable(status.profileRequired
      ? "OpenCLI 需要先选择一个浏览器配置，再重试读取。"
      : "OpenCLI 浏览器扩展未连接。请在 Chrome 中启用扩展并打开已登录的知乎，再重试读取。");
  }
  const { stdout } = await execute("opencli", ["zhihu", "hot", "--limit", "50", "-f", "json", "--window", "background"], {
    timeout: 20_000, maxBuffer: 1024 * 1024, windowsHide: true,
  });
  return stdout;
};

export const parseZhihuHotlist = (stdout: string): ZhihuHotItem[] => {
  if (Buffer.byteLength(stdout) > 1024 * 1024) throw new Error("榜单响应过大");
  const raw: unknown = JSON.parse(stdout.trim());
  if (!Array.isArray(raw) || raw.length > 50) throw new Error("榜单格式不可识别");
  const seenIds = new Set<string>();
  const seenRanks = new Set<number>();
  const items: ZhihuHotItem[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const title = typeof row.title === "string" ? row.title.trim().slice(0, 600) : "";
    let url: URL;
    try { url = new URL(row.url); } catch { continue; }
    const match = url.pathname.match(/^\/question\/(\d+)\/?$/u);
    if (!title || url.protocol !== "https:" || url.hostname !== "www.zhihu.com" || url.port || url.username || url.password || !match) continue;
    if (!Number.isInteger(row.rank) || row.rank < 1 || row.rank > 50 || seenIds.has(match[1]) || seenRanks.has(row.rank)) continue;
    seenIds.add(match[1]); seenRanks.add(row.rank);
    items.push({ id: match[1], title, url: `https://www.zhihu.com/question/${match[1]}`, rank: row.rank,
      heat: typeof row.heat === "string" ? row.heat.trim().slice(0, 60) : undefined,
      answers: Number.isSafeInteger(row.answers) && row.answers >= 0 ? row.answers : undefined });
  }
  // OpenCLI 1.8.6 also returns [] for some authentication/API failures.
  // Until that ambiguity is resolved, never report a verified empty hotlist.
  if (!items.length) throw new ConnectionUnavailable("未取得可核验的榜单，可能需要登录或稍后重试；不能确认当前热榜为空。");
  return items.sort((left, right) => left.rank - right.rank);
};

interface HotlistDependencies {
  load: () => Promise<ZhihuHotSnapshot | undefined>;
  save: (snapshot: ZhihuHotSnapshot) => Promise<void>;
  run?: () => Promise<string>;
  now?: () => number;
}

/** SourceDesk adapter: bounded read, durable last-good cache and failure isolation. */
export const createZhihuHotlist = ({ load, save, run = readZhihuHotCommand, now = Date.now }: HotlistDependencies) => {
  let inFlight: Promise<ZhihuHotView> | undefined;
  const view = (snapshot?: ZhihuHotSnapshot): ZhihuHotView => ({
    status: !snapshot ? "unread" : !snapshot.items.length ? "unavailable"
      : snapshot.error || !snapshot.capturedAt || now() - Date.parse(snapshot.capturedAt) > freshForMs ? "stale" : "ready",
    items: snapshot?.items ?? [], capturedAt: snapshot?.capturedAt,
    error: snapshot?.error, retryAt: snapshot?.retryAt,
  });
  const read = async () => view(await load());
  const refresh = (): Promise<ZhihuHotView> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const previous = await load();
      if (previous && Date.parse(previous.retryAt) > now()) return view(previous);
      const attemptedAt = new Date(now()).toISOString();
      let snapshot: ZhihuHotSnapshot;
      try {
        const items = parseZhihuHotlist(await run());
        snapshot = { items, capturedAt: new Date(now()).toISOString(), attemptedAt, retryAt: new Date(now() + cooldownMs).toISOString() };
      } catch (error) {
        snapshot = { items: previous?.items ?? [], capturedAt: previous?.capturedAt, attemptedAt,
          retryAt: new Date(now() + cooldownMs).toISOString(), error: error instanceof ConnectionUnavailable ? error.message
            : "知乎热榜暂时未能读取。请检查 OpenCLI 连接与知乎登录后重试。" };
      }
      await save(snapshot);
      return view(snapshot);
    })().finally(() => { inFlight = undefined; });
    return inFlight;
  };
  return { read, refresh };
};
