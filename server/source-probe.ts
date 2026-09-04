import { fetchRemote, readResponseBuffer } from "./remote-url.js";
import { getLast30DaysStatus } from "./last30days-adapter.js";
import { googleNewsFeed, routedFeedsForSource, sourceTopicIds } from "./source-routing.js";
import { repositoriesForGitHubSource } from "./github-community.js";
import { getXBearerToken } from "./secrets.js";
import { accountsForXSource, createXApiClient, type XRecentSearchClient } from "./x-official.js";
import type { SourceConfig, SourceProbeResult } from "./types.js";

const MAXIMUM_PROBE_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8_000;
const HACKER_NEWS_TOP_STORIES = "https://hacker-news.firebaseio.com/v0/topstories.json";

type ProbeFetcher = (url: string | URL, init: RequestInit) => Promise<Response>;

export interface SourceProbeOptions {
  fetcher?: ProbeFetcher;
  last30DaysStatus?: typeof getLast30DaysStatus;
  now?: () => Date;
  timeoutMs?: number;
  xClient?: XRecentSearchClient;
}

export const applySourceProbeResult = (
  source: SourceConfig,
  result: SourceProbeResult,
) => {
  if (source.id !== result.sourceId) throw new Error("来源测试结果与目标来源不匹配");
  source.health = result.status;
  source.lastCheckedAt = result.checkedAt;
  source.lastSuccessfulAt = result.successfulAt;
  source.consecutiveFailures = result.consecutiveFailures;
  source.lastRawCount = result.itemCount;
  source.lastCandidateCount = undefined;
  source.lastHealthDetail = result.detail;
  return source;
};

const probeTargetFor = (source: SourceConfig) => {
  if (source.kind === "hackernews") return { url: HACKER_NEWS_TOP_STORIES, format: "json" as const };
  if (source.kind === "github") {
    const repository = repositoriesForGitHubSource(source)[0];
    if (!repository) throw new Error("GitHub 来源没有配置 owner/repository");
    return { url: `https://api.github.com/repos/${repository}/releases?per_page=1`, format: "json" as const };
  }
  if (source.kind === "google_news") {
    return { url: googleNewsFeed(source.query?.trim() || source.name), format: "feed" as const };
  }
  const routed = routedFeedsForSource(source, sourceTopicIds(source));
  const routedFeed = routed[0];
  // Site-scoped routes are collected through a news index, but that index is
  // infrastructure rather than the source itself. Probe the source's own page
  // so a temporary Google News outage does not falsely mark the publisher down.
  if (routedFeed?.url.includes("news.google.com/rss/search") && source.homepageUrl) {
    return { url: source.homepageUrl, format: "page" as const };
  }
  const feedUrl = routedFeed?.url ?? source.url;
  if (feedUrl) return { url: feedUrl, format: "feed" as const };
  if (source.homepageUrl) return { url: source.homepageUrl, format: "page" as const };
  throw new Error("新闻源没有可测试的采集地址或官网地址");
};

const countFeedItems = (content: string) =>
  (content.match(/<(?:item|entry|url)\b/gi) ?? []).length;

const countJsonItems = (content: string) => {
  try {
    const value = JSON.parse(content) as unknown;
    return Array.isArray(value) ? value.length : value && typeof value === "object" ? 1 : 0;
  } catch {
    return 0;
  }
};

export const probeSource = async (
  source: SourceConfig,
  options: SourceProbeOptions = {},
): Promise<SourceProbeResult> => {
  const checkedAt = (options.now ?? (() => new Date()))().toISOString();
  const previousSuccess = source.lastSuccessfulAt;
  const previousFailures = source.consecutiveFailures ?? 0;
  if (source.kind === "last30days") {
    try {
      const status = await (options.last30DaysStatus ?? getLast30DaysStatus)();
      const statusKind = status.ready ? "healthy" : status.setupComplete ? "error" : "warning";
      return {
        sourceId: source.id,
        status: statusKind,
        checkedAt,
        successfulAt: status.ready ? checkedAt : previousSuccess,
        consecutiveFailures: statusKind === "error" ? previousFailures + 1 : status.ready ? 0 : previousFailures,
        itemCount: 0,
        detail: status.detail,
        targetUrl: status.skillDir,
      };
    } catch (error) {
      return {
        sourceId: source.id,
        status: "error",
        checkedAt,
        successfulAt: previousSuccess,
        consecutiveFailures: previousFailures + 1,
        itemCount: 0,
        detail: `last30days 状态检查失败：${error instanceof Error ? error.message : String(error)}`,
        targetUrl: "",
      };
    }
  }
  if (source.kind === "x") {
    const targetUrl = "https://api.x.com/2/tweets/search/recent";
    try {
      const accounts = accountsForXSource(source);
      if (!accounts.length) throw new Error("X 来源没有配置有效的官方账号");
      const response = await (options.xClient ?? createXApiClient({ getBearerToken: getXBearerToken })).searchRecent({
        accounts,
        sinceId: source.cursor,
      });
      return {
        sourceId: source.id,
        status: "healthy",
        checkedAt,
        successfulAt: checkedAt,
        consecutiveFailures: 0,
        itemCount: response.data?.length ?? 0,
        detail: `X API 连接正常，正在监控 ${accounts.length} 个官方账号`,
        targetUrl,
        httpStatus: 200,
      };
    } catch (error) {
      return {
        sourceId: source.id,
        status: "error",
        checkedAt,
        successfulAt: previousSuccess,
        consecutiveFailures: previousFailures + 1,
        itemCount: 0,
        detail: error instanceof Error ? error.message : String(error),
        targetUrl,
      };
    }
  }
  let targetUrl = source.url ?? source.homepageUrl ?? "";
  try {
    const target = probeTargetFor(source);
    targetUrl = target.url;
    const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const fetcher = options.fetcher ?? ((url, init) => fetchRemote(url, init, 3));
    const response = await fetcher(target.url, {
      method: "GET",
      headers: {
        accept: target.format === "json"
          ? "application/json"
          : target.format === "feed"
            ? "application/atom+xml, application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5"
            : "text/html, */*;q=0.5",
        "user-agent": "AI-News-Desk-Source-Probe/1.0",
      },
      signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        sourceId: source.id,
        status: "error",
        checkedAt,
        successfulAt: previousSuccess,
        consecutiveFailures: previousFailures + 1,
        itemCount: 0,
        detail: `来源返回 HTTP ${response.status}`,
        targetUrl,
        httpStatus: response.status,
      };
    }
    if (target.format === "page") {
      await response.body?.cancel().catch(() => undefined);
      return {
        sourceId: source.id,
        status: "healthy",
        checkedAt,
        successfulAt: checkedAt,
        consecutiveFailures: 0,
        itemCount: 1,
        detail: "官网可访问",
        targetUrl,
        httpStatus: response.status,
      };
    }
    const content = (await readResponseBuffer(response, MAXIMUM_PROBE_BYTES)).toString("utf8");
    const isSitemap = target.format === "feed" && /<urlset\b/iu.test(content);
    const itemCount = target.format === "feed"
      ? countFeedItems(content)
      : target.format === "json"
        ? countJsonItems(content)
        : 1;
    if (itemCount === 0) {
      return {
        sourceId: source.id,
        status: "warning",
        checkedAt,
        successfulAt: previousSuccess,
        consecutiveFailures: previousFailures + 1,
        itemCount: 0,
        detail: target.format === "feed"
          ? isSitemap ? "Sitemap 可访问，但没有发现网址条目" : "RSS 可访问，但没有发现条目"
          : "来源可访问，但响应内容为空",
        targetUrl,
        httpStatus: response.status,
      };
    }
    return {
      sourceId: source.id,
      status: "healthy",
      checkedAt,
      successfulAt: checkedAt,
      consecutiveFailures: 0,
      itemCount,
      detail: target.format === "feed"
        ? isSitemap
          ? `Sitemap 可访问，读取到 ${itemCount} 个网址条目`
          : `RSS 可访问，读取到 ${itemCount} 个条目`
        : target.format === "json"
          ? `接口可访问，读取到 ${itemCount} 条记录`
          : "官网可访问",
      targetUrl,
      httpStatus: response.status,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      sourceId: source.id,
      status: "error",
      checkedAt,
      successfulAt: previousSuccess,
      consecutiveFailures: previousFailures + 1,
      itemCount: 0,
      detail: message.includes("timeout") || message.includes("aborted")
        ? "来源测试超时"
        : `来源测试失败：${message}`,
      targetUrl,
    };
  }
};
