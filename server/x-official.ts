import type {
  RawHorizonItem,
  SourceConfig,
  XAccountClass,
  XAccountIdentity,
} from "./types.js";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";

const xRecentSearchEndpoint = "https://api.x.com/2/tweets/search/recent";
const maximumXResponseBytes = 2 * 1024 * 1024;
const maximumXSearchPages = 50;

export type XAccountKind = XAccountClass;
export type XAccountPriority = "critical" | "core" | "observer";
export type XEvidenceRole = "canonical_link_pointer" | "first_party_statement" | "discovery_only";
export type XPostKind = "announcement" | "preview" | "api_update" | "correction" | "commentary";

export interface XAccountPolicy {
  username: string;
  role: "official" | "research" | "discovery";
  kind: XAccountKind;
  priority: XAccountPriority;
  vendor?: string;
}

export interface XAccountObservation {
  userId: string;
  username: string;
  role: XAccountPolicy["role"];
  kind: XAccountKind;
  priority: XAccountPriority;
  vendor?: string;
  observedAt: string;
}

const reviewedXAccounts: XAccountPolicy[] = [
  { username: "OpenAI", role: "official", kind: "vendor_official", priority: "critical", vendor: "OpenAI" },
  { username: "OpenAIDevs", role: "official", kind: "developer_official", priority: "critical", vendor: "OpenAI" },
  { username: "AnthropicAI", role: "official", kind: "vendor_official", priority: "critical", vendor: "Anthropic" },
  { username: "claudeai", role: "official", kind: "product_official", priority: "critical", vendor: "Anthropic" },
  { username: "GoogleDeepMind", role: "official", kind: "vendor_official", priority: "critical", vendor: "Google DeepMind" },
  { username: "GoogleAI", role: "official", kind: "vendor_official", priority: "critical", vendor: "Google" },
  { username: "GeminiApp", role: "official", kind: "product_official", priority: "critical", vendor: "Google Gemini" },
  { username: "GoogleAIStudio", role: "official", kind: "developer_official", priority: "critical", vendor: "Google Gemini" },
  { username: "deepseek_ai", role: "official", kind: "vendor_official", priority: "critical", vendor: "DeepSeek" },
  { username: "Alibaba_Qwen", role: "official", kind: "vendor_official", priority: "critical", vendor: "Qwen" },
  { username: "alibaba_cloud", role: "official", kind: "platform_official", priority: "core", vendor: "Alibaba Cloud" },
  { username: "xai", role: "official", kind: "vendor_official", priority: "critical", vendor: "xAI" },
  { username: "AIatMeta", role: "official", kind: "vendor_official", priority: "core", vendor: "Meta AI" },
  { username: "MistralAI", role: "official", kind: "vendor_official", priority: "core", vendor: "Mistral AI" },
  { username: "cohere", role: "official", kind: "vendor_official", priority: "core", vendor: "Cohere" },
  { username: "MicrosoftAI", role: "official", kind: "vendor_official", priority: "core", vendor: "Microsoft AI" },
  { username: "NVIDIAAI", role: "official", kind: "vendor_official", priority: "core", vendor: "NVIDIA" },
  { username: "huggingface", role: "research", kind: "research_platform", priority: "observer", vendor: "Hugging Face" },
  { username: "perplexity_ai", role: "official", kind: "product_official", priority: "core", vendor: "Perplexity" },
  { username: "sama", role: "discovery", kind: "official_executive", priority: "critical", vendor: "OpenAI" },
  { username: "gdb", role: "discovery", kind: "official_executive", priority: "core", vendor: "OpenAI" },
  { username: "demishassabis", role: "discovery", kind: "official_executive", priority: "critical", vendor: "Google DeepMind" },
  { username: "ArtificialAnlys", role: "research", kind: "research_platform", priority: "observer", vendor: "Artificial Analysis" },
];

const reviewedXAccountMap = new Map(reviewedXAccounts.map((account) => [account.username.toLocaleLowerCase(), account]));

export const xAccountPolicyFor = (value: string): XAccountPolicy => {
  const username = value.replace(/^@/u, "").trim();
  const reviewed = reviewedXAccountMap.get(username.toLocaleLowerCase());
  return reviewed ? { ...reviewed } : {
    username,
    role: "discovery",
    kind: "unreviewed",
    priority: "observer",
  };
};

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
  attachments?: { media_keys?: string[] };
  referenced_tweets?: Array<{ id: string; type: "replied_to" | "quoted" | "retweeted" }>;
}

interface XUser {
  id: string;
  username: string;
  name: string;
  verified?: boolean;
}

interface XMedia {
  media_key: string;
  type: "photo" | "video" | "animated_gif" | string;
  url?: string;
  preview_image_url?: string;
  width?: number;
  height?: number;
  alt_text?: string;
}

export interface XRecentSearchResponse {
  data?: XPost[];
  includes?: { users?: XUser[]; media?: XMedia[] };
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
    const baseEndpoint = new URL(xRecentSearchEndpoint);
    baseEndpoint.searchParams.set("query", query);
    baseEndpoint.searchParams.set("max_results", "100");
    baseEndpoint.searchParams.set("sort_order", "recency");
    baseEndpoint.searchParams.set("tweet.fields", "author_id,created_at,entities,public_metrics,referenced_tweets,attachments");
    baseEndpoint.searchParams.set("expansions", "author_id,attachments.media_keys");
    baseEndpoint.searchParams.set("user.fields", "id,name,username,verified");
    baseEndpoint.searchParams.set("media.fields", "media_key,type,url,preview_image_url,width,height,alt_text");
    if (input.sinceId && /^\d+$/u.test(input.sinceId)) baseEndpoint.searchParams.set("since_id", input.sinceId);
    const bearerToken = (await dependencies.getBearerToken()).trim();
    if (!bearerToken) throw new Error("尚未配置 X API Bearer Token");
    const timeoutSignal = AbortSignal.timeout(45_000);
    const signal = input.signal ? AbortSignal.any([input.signal, timeoutSignal]) : timeoutSignal;
    const fetcher = dependencies.fetcher ?? ((url, init) => fetchRemote(url, init, 0));
    const posts = new Map<string, XPost>();
    const users = new Map<string, XUser>();
    const media = new Map<string, XMedia>();
    const seenPageTokens = new Set<string>();
    let nextToken: string | undefined;
    let newestId: string | undefined;
    let pageCount = 0;
    do {
      if (pageCount >= maximumXSearchPages) {
        throw new Error(`X 补抓超过 ${maximumXSearchPages * 100} 条安全上限；未推进游标，请缩短恢复窗口后重试`);
      }
      const endpoint = new URL(baseEndpoint);
      if (nextToken) endpoint.searchParams.set("next_token", nextToken);
      const response = await fetcher(endpoint, {
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
      pageCount += 1;
      newestId ??= payload.meta?.newest_id;
      for (const post of payload.data ?? []) posts.set(post.id, post);
      for (const user of payload.includes?.users ?? []) users.set(user.id, user);
      for (const item of payload.includes?.media ?? []) media.set(item.media_key, item);
      const followingToken = payload.meta?.next_token;
      if (followingToken && seenPageTokens.has(followingToken)) {
        throw new Error("X API 返回了重复分页游标；未推进来源游标，请稍后重试");
      }
      if (followingToken) seenPageTokens.add(followingToken);
      nextToken = followingToken;
    } while (nextToken);

    return {
      data: [...posts.values()],
      includes: {
        users: [...users.values()],
        media: [...media.values()],
      },
      meta: {
        newest_id: newestId,
        result_count: posts.size,
      },
    };
  },
});

export const accountsForXSource = (source: Pick<SourceConfig, "query" | "xAccounts">) => {
  const seen = new Set<string>();
  return (source.query ?? "")
    .split(/[\s,，;；]+/u)
    .map((account) => account.replace(/^@/u, "").trim())
    .filter((account) => /^[A-Za-z0-9_]{1,15}$/u.test(account))
    .map((account) => {
      const normalized = account.toLocaleLowerCase();
      const registered = source.xAccounts?.find((identity) =>
        identity.username.toLocaleLowerCase() === normalized
        || identity.usernameHistory.some((username) => username.toLocaleLowerCase() === normalized));
      return registered && registered.status !== "identity-conflict" ? registered.username : account;
    })
    .filter((account) => {
      const normalized = account.toLowerCase();
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    })
    .slice(0, 30);
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

export const applyXAccountObservations = (
  sources: SourceConfig[],
  observations: Readonly<Record<string, XAccountObservation[]>>,
) => {
  for (const source of sources) {
    if (source.kind !== "x") continue;
    const incoming = observations[source.id] ?? [];
    if (!incoming.length) continue;
    const registry = (source.xAccounts ?? []).map((identity) => ({
      ...identity,
      usernameHistory: [...identity.usernameHistory],
    }));
    for (const observation of incoming) {
      const byId = registry.find((identity) => identity.userId === observation.userId);
      if (byId) {
        const changed = byId.username.toLocaleLowerCase() !== observation.username.toLocaleLowerCase();
        byId.usernameHistory = [...new Set([...byId.usernameHistory, byId.username, observation.username])];
        byId.username = observation.username;
        byId.role = observation.role;
        byId.accountKind = observation.kind;
        byId.priority = observation.priority;
        byId.vendor = observation.vendor;
        byId.policyReviewed = observation.kind !== "unreviewed";
        byId.lastSeenAt = observation.observedAt;
        byId.status = changed ? "handle-changed" : byId.status === "handle-changed" ? "handle-changed" : "observed";
        continue;
      }
      const normalized = observation.username.toLocaleLowerCase();
      const conflicts = registry.filter((identity) =>
        identity.username.toLocaleLowerCase() === normalized
        || identity.usernameHistory.some((username) => username.toLocaleLowerCase() === normalized));
      for (const conflict of conflicts) conflict.status = "identity-conflict";
      registry.push({
        userId: observation.userId,
        username: observation.username,
        usernameHistory: [observation.username],
        role: observation.role,
        accountKind: observation.kind,
        priority: observation.priority,
        vendor: observation.vendor,
        policyReviewed: observation.kind !== "unreviewed",
        firstSeenAt: observation.observedAt,
        lastSeenAt: observation.observedAt,
        status: conflicts.length ? "identity-conflict" : "observed",
      } satisfies XAccountIdentity);
    }
    source.xAccounts = registry.slice(0, 100);
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

const xEvidenceRoleFor = (policy: XAccountPolicy, canonicalUrl: string | undefined): XEvidenceRole => {
  if (policy.role !== "official") return "discovery_only";
  return canonicalUrl ? "canonical_link_pointer" : "first_party_statement";
};

const xPostKindFor = (text: string): XPostKind => {
  if (/(?:\b(?:correction|corrected|erratum|retract(?:ed|ion)?)\b|更正|纠正|撤回)/iu.test(text)) return "correction";
  if (/(?:\b(?:coming soon|upcoming|prepare|preparing|preview|on the way)\b|\b(?:launch|releas)\w*\b[^.\n]{0,80}\bsoon\b|即将|预告|准备发布)/iu.test(text)) return "preview";
  if (/(?:\b(?:api|sdk|changelog|deprecat(?:e|ed|ion)|endpoint)\b|接口|开发者|弃用)/iu.test(text)) return "api_update";
  if (/(?:\b(?:releas(?:e|ed|es|ing)|launch(?:ed|es|ing)?|announce(?:d|s|ing)?|introduc(?:e|ed|es|ing))\b|发布|推出|上线|宣布)/iu.test(text)) return "announcement";
  return "commentary";
};

const accountPolicyForUser = (source: SourceConfig, user: XUser): XAccountPolicy => {
  const registered = source.xAccounts?.find((identity) => identity.userId === user.id);
  return registered ? {
    username: user.username,
    role: registered.role,
    kind: registered.accountKind,
    priority: registered.priority,
    vendor: registered.vendor,
  } : xAccountPolicyFor(user.username);
};

const validateXAccountIdentities = (
  source: SourceConfig,
  accounts: string[],
  response: XRecentSearchResponse,
) => {
  if (!source.xAccounts?.length) return;
  const allowedHandles = new Set(accounts.map((account) => account.toLocaleLowerCase()));
  const authorIds = new Set((response.data ?? []).map((post) => post.author_id).filter(Boolean));
  for (const user of response.includes?.users ?? []) {
    if (!authorIds.has(user.id)) continue;
    const byId = source.xAccounts.find((identity) => identity.userId === user.id);
    if (byId?.status === "identity-conflict") {
      throw new Error(`X 账号 @${user.username} 的稳定用户 ID 存在身份冲突，已停止采集并等待人工复核`);
    }
    if (!allowedHandles.has(user.username.toLocaleLowerCase())) continue;
    const normalized = user.username.toLocaleLowerCase();
    const byHandle = source.xAccounts.find((identity) =>
      identity.username.toLocaleLowerCase() === normalized
      || identity.usernameHistory.some((username) => username.toLocaleLowerCase() === normalized));
    if (byHandle && byHandle.userId !== user.id) {
      throw new Error(`X 账号 @${user.username} 的用户 ID 与已登记身份不一致，已停止采集并等待人工复核`);
    }
  }
};

const accountObservationsForResponse = (
  source: SourceConfig,
  accounts: string[],
  response: XRecentSearchResponse,
  observedAt: string,
): XAccountObservation[] => {
  const allowedHandles = new Set(accounts.map((account) => account.toLocaleLowerCase()));
  const authorIds = new Set((response.data ?? []).map((post) => post.author_id).filter(Boolean));
  return (response.includes?.users ?? []).flatMap((user) => {
    if (!authorIds.has(user.id)) return [];
    const registered = source.xAccounts?.some((identity) => identity.userId === user.id);
    if (!registered && !allowedHandles.has(user.username.toLocaleLowerCase())) return [];
    const policy = accountPolicyForUser(source, user);
    return [{
      userId: user.id,
      username: user.username,
      role: policy.role,
      kind: policy.kind,
      priority: policy.priority,
      vendor: policy.vendor,
      observedAt,
    }];
  });
};

const safeMediaUrl = (value: string | undefined) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return /^https?:$/u.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const mediaForPost = (post: XPost, mediaByKey: ReadonlyMap<string, XMedia>) => {
  const seen = new Set<string>();
  return (post.attachments?.media_keys ?? []).flatMap((mediaKey) => {
    if (seen.has(mediaKey)) return [];
    seen.add(mediaKey);
    const media = mediaByKey.get(mediaKey);
    if (!media) return [];
    const url = safeMediaUrl(media.type === "photo"
      ? media.url ?? media.preview_image_url
      : media.preview_image_url);
    if (!url) return [];
    return [{
      media_key: media.media_key,
      kind: media.type === "photo" ? "photo" : "preview",
      url,
      width: media.width,
      height: media.height,
      alt_text: media.alt_text?.trim().slice(0, 180),
    }];
  });
};

const itemsForResponse = (
  source: SourceConfig,
  accounts: string[],
  response: XRecentSearchResponse,
  fetchedAt: string,
) => {
  const allowed = new Set(accounts.map((account) => account.toLowerCase()));
  const allowedIds = new Set(source.xAccounts?.map((identity) => identity.userId) ?? []);
  const users = new Map((response.includes?.users ?? []).map((user) => [user.id, user]));
  const mediaByKey = new Map((response.includes?.media ?? []).map((media) => [media.media_key, media]));
  return (response.data ?? []).flatMap((post): RawHorizonItem[] => {
    const user = post.author_id ? users.get(post.author_id) : undefined;
    const isReplyOrRetweet = post.referenced_tweets?.some(
      (reference) => reference.type === "replied_to" || reference.type === "retweeted",
    );
    if (
      isReplyOrRetweet
      || !user
      || (!allowed.has(user.username.toLowerCase()) && !allowedIds.has(user.id))
      || !post.id
      || !post.text.trim()
    ) return [];
    const metrics = post.public_metrics ?? {};
    const accountPolicy = accountPolicyForUser(source, user);
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
        source_role: accountPolicy.role,
        is_official_account: accountPolicy.role === "official",
        x_user_id: user.id,
        x_handle_at_capture: user.username,
        x_account_kind: accountPolicy.kind,
        x_account_priority: accountPolicy.priority,
        x_account_vendor: accountPolicy.vendor,
        x_account_reviewed: accountPolicy.kind !== "unreviewed",
        x_evidence_role: xEvidenceRoleFor(accountPolicy, canonicalUrl),
        x_post_kind: xPostKindFor(post.text),
        x_username: user.username,
        x_user_name: user.name,
        x_verified: Boolean(user.verified),
        like_count: metrics.like_count ?? 0,
        reply_count: metrics.reply_count ?? 0,
        retweet_count: metrics.retweet_count ?? 0,
        quote_count: metrics.quote_count ?? 0,
        x_media: mediaForPost(post, mediaByKey),
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
  const accountObservations: Record<string, XAccountObservation[]> = {};
  for (const source of sources) {
    try {
      const accounts = accountsForXSource(source);
      if (!accounts.length) throw new Error("X 来源没有配置有效的官方账号");
      const response = await options.client.searchRecent({
        accounts,
        sinceId: source.cursor,
        signal: options.signal,
      });
      validateXAccountIdentities(source, accounts, response);
      items.push(...itemsForResponse(source, accounts, response, fetchedAt));
      accountObservations[source.id] = accountObservationsForResponse(source, accounts, response, fetchedAt);
      if (response.meta?.newest_id) cursors[source.id] = response.meta.newest_id;
    } catch (error) {
      failures[source.id] = error instanceof Error ? error.message : String(error);
    }
  }
  return { items, failures, cursors, accountObservations };
};
