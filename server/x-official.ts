import type { RawHorizonItem, SourceConfig } from "./types.js";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";

const xRecentSearchEndpoint = "https://api.x.com/2/tweets/search/recent";
const maximumXResponseBytes = 2 * 1024 * 1024;

interface XPost {
  id: string;
  author_id?: string;
  created_at?: string;
  text: string;
  public_metrics?: {
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
  };
  entities?: { urls?: Array<{ expanded_url?: string }> };
  referenced_tweets?: Array<{ id: string; type: "replied_to" | "quoted" | "retweeted" }>;
}

interface XUser {
  id: string;
  username: string;
  name: string;
  verified?: boolean;
}

export interface XRecentSearchResponse {
  data?: XPost[];
  includes?: { users?: XUser[] };
  meta?: { newest_id?: string; next_token?: string; result_count?: number };
}

export interface XRecentSearchClient {
  searchRecent(input: {
    accounts: string[];
    sinceId?: string;
    signal?: AbortSignal;
  }): Promise<XRecentSearchResponse>;
}

type XFetcher = (url: string | URL, init: RequestInit) => Promise<Response>;

export const createXApiClient = (dependencies: {
  getBearerToken: () => Promise<string>;
  fetcher?: XFetcher;
}): XRecentSearchClient => ({
  async searchRecent(input) {
    const accounts = input.accounts.filter((account) => /^[A-Za-z0-9_]{1,15}$/u.test(account));
    if (!accounts.length) throw new Error("X 来源没有配置有效的官方账号");
    const query = `(${accounts.map((account) => `from:${account}`).join(" OR ")}) -is:retweet -is:reply`;
    if (query.length > 512) throw new Error("X 官方账号组合超过查询长度限制，请拆成多个来源");
    const endpoint = new URL(xRecentSearchEndpoint);
    endpoint.searchParams.set("query", query);
    endpoint.searchParams.set("max_results", "100");
    endpoint.searchParams.set("sort_order", "recency");
    endpoint.searchParams.set("tweet.fields", "author_id,created_at,entities,public_metrics,referenced_tweets");
    endpoint.searchParams.set("expansions", "author_id");
    endpoint.searchParams.set("user.fields", "id,name,username,verified");
    if (input.sinceId && /^\d+$/u.test(input.sinceId)) endpoint.searchParams.set("since_id", input.sinceId);
    const bearerToken = (await dependencies.getBearerToken()).trim();
    if (!bearerToken) throw new Error("尚未配置 X API Bearer Token");
    const timeoutSignal = AbortSignal.timeout(20_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    const response = await (dependencies.fetcher ?? ((url, init) => fetchRemote(url, init, 0)))(endpoint, {
      method: "GET",
      redirect: "error",
      signal,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${bearerToken}`,
        "user-agent": "AI-News-Desk/0.2 (X official source)",
      },
    });
    const payload = JSON.parse((await readResponseBuffer(response, maximumXResponseBytes)).toString("utf8") || "{}") as XRecentSearchResponse & {
      title?: string;
      detail?: string;
      errors?: Array<{ detail?: string; message?: string }>;
    };
    if (!response.ok) {
      if (response.status === 429) {
        const resetAt = Number(response.headers.get("x-rate-limit-reset"));
        const suffix = Number.isFinite(resetAt)
          ? `，预计 ${new Date(resetAt * 1_000).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })} 后恢复`
          : "";
        throw new Error(`X API 已限流${suffix}`);
      }
      const detail = payload.detail || payload.errors?.[0]?.detail || payload.errors?.[0]?.message || payload.title;
      throw new Error(`X API 返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 240)}` : ""}`);
    }
    return payload;
  },
});

export const accountsForXSource = (source: Pick<SourceConfig, "query">) => {
  const seen = new Set<string>();
  return (source.query ?? "")
    .split(/[\s,，;；]+/u)
    .map((account) => account.replace(/^@/u, "").trim())
    .filter((account) => /^[A-Za-z0-9_]{1,15}$/u.test(account))
    .filter((account) => {
      const normalized = account.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 20);
};

export const applyXSourceCursors = (
  sources: SourceConfig[],
  cursors: Readonly<Record<string, string>>,
) => {
  for (const source of sources) {
    const next = cursors[source.id];
    if (source.kind !== "x" || !next || !/^\d+$/u.test(next)) continue;
    if (!source.cursor || !/^\d+$/u.test(source.cursor) || BigInt(next) > BigInt(source.cursor)) {
      source.cursor = next;
    }
  }
  return sources;
};

const postTitle = (text: string) => {
  const firstLine = text.split(/\r?\n/u).map((line) => line.trim()).find(Boolean) ?? "X 官方动态";
  return firstLine.length > 180 ? `${firstLine.slice(0, 177)}…` : firstLine;
};

const firstExternalUrl = (post: XPost) => post.entities?.urls?.flatMap((entity) => {
  if (!entity.expanded_url) return [];
  try {
    const url = new URL(entity.expanded_url);
    if (!/^https?:$/u.test(url.protocol) || /(^|\.)(x\.com|twitter\.com|t\.co)$/iu.test(url.hostname)) return [];
    url.hash = "";
    return [url.toString()];
  } catch {
    return [];
  }
})[0];

const itemsForResponse = (
  source: SourceConfig,
  accounts: string[],
  response: XRecentSearchResponse,
  fetchedAt: string,
) => {
  const allowed = new Set(accounts.map((account) => account.toLowerCase()));
  const users = new Map((response.includes?.users ?? []).map((user) => [user.id, user]));
  return (response.data ?? []).flatMap((post): RawHorizonItem[] => {
    const user = post.author_id ? users.get(post.author_id) : undefined;
    const isReplyOrRetweet = post.referenced_tweets?.some(
      (reference) => reference.type === "replied_to" || reference.type === "retweeted",
    );
    if (isReplyOrRetweet || !user || !allowed.has(user.username.toLowerCase()) || !post.id || !post.text.trim()) return [];
    const metrics = post.public_metrics ?? {};
    const canonicalUrl = firstExternalUrl(post);
    return [{
      id: `x:${post.id}`,
      source_type: "x",
      title: postTitle(post.text),
      url: `https://x.com/${user.username}/status/${post.id}`,
      content: post.text.trim().slice(0, 12_000),
      author: `@${user.username}`,
      published_at: post.created_at,
      fetched_at: fetchedAt,
      metadata: {
        feed_name: source.name,
        source_id: source.id,
        source_role: "official",
        is_official_account: true,
        x_username: user.username,
        x_user_name: user.name,
        x_verified: Boolean(user.verified),
        like_count: metrics.like_count ?? 0,
        reply_count: metrics.reply_count ?? 0,
        retweet_count: metrics.retweet_count ?? 0,
        quote_count: metrics.quote_count ?? 0,
        collector: "x-api-v2",
        ...(canonicalUrl ? { canonical_url: canonicalUrl } : {}),
      },
    }];
  });
};

export const collectXOfficialSources = async (
  sources: SourceConfig[],
  options: {
    client: XRecentSearchClient;
    signal?: AbortSignal;
    now?: () => Date;
  },
) => {
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const items: RawHorizonItem[] = [];
  const failures: Record<string, string> = {};
  const cursors: Record<string, string> = {};
  for (const source of sources) {
    try {
      const accounts = accountsForXSource(source);
      if (!accounts.length) throw new Error("X 来源没有配置有效的官方账号");
      const response = await options.client.searchRecent({
        accounts,
        sinceId: source.cursor,
        signal: options.signal,
      });
      items.push(...itemsForResponse(source, accounts, response, fetchedAt));
      if (response.meta?.newest_id) cursors[source.id] = response.meta.newest_id;
    } catch (error) {
      failures[source.id] = error instanceof Error ? error.message : String(error);
    }
  }
  return { items, failures, cursors };
};
