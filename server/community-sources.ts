import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  discoverLast30Days,
  type Last30DaysDiscovery,
} from "./last30days-adapter.js";
import { collectGitHubSource } from "./github-community.js";
import { keywordTerms, sourceSupportsTopics } from "./source-routing.js";
import { topicLabels } from "./topics.js";
import type {
  CollectionRequest,
  CollectionTopicId,
  RawHorizonItem,
  SourceConfig,
} from "./types.js";

interface CommandOutput {
  stdout: string;
  stderr: string;
}

type CommandRunner = (
  command: string,
  args: string[],
  options: { timeoutMs: number; signal?: AbortSignal },
) => Promise<CommandOutput>;

interface CommunityCollectionOptions {
  now?: () => Date;
  runCommand?: CommandRunner;
  last30DaysDiscover?: (
    domain: string,
    options: { signal?: AbortSignal; timeoutMs?: number },
  ) => Promise<Last30DaysDiscovery>;
  githubCollect?: typeof collectGitHubSource;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface CommunityCollectionResult {
  items: RawHorizonItem[];
  failures: Record<string, string>;
}

const defaultRunCommand: CommandRunner = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
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
      finish(() => reject(new Error("知乎 CLI 采集已取消")));
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(() => reject(new Error("知乎 CLI 超时或尚未登录")));
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
      else reject(new Error(stderr.trim() || `知乎 CLI 退出码 ${code}`));
    }));
  });

const topicSearchTerms: Record<CollectionTopicId, string> = {
  ai: "人工智能 大模型 科技",
  technology: "科技 芯片 软件 网络安全",
  gaming: "游戏 新游 主机",
  esports: "电竞 赛事 战队",
  politics: "政策 治理 国际",
  business: "商业 公司 融资 财报",
  science: "科学 科研 航天 生物",
};

const searchQueryFor = (
  source: SourceConfig,
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "keywords">,
) => {
  const topicTerms = topicIds.length === 1 && topicIds[0] === "ai" && source.query?.trim()
    ? source.query.trim()
    : topicIds.map((topicId) => topicSearchTerms[topicId]).join(" ");
  return [...new Set([...topicTerms.split(/\s+/), ...keywordTerms(filters.keywords)])]
    .filter(Boolean)
    .slice(0, 10)
    .join(" ");
};

const parseJson = (stdout: string): unknown => {
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  try {
    return JSON.parse(trimmed);
  } catch {
    const starts = [trimmed.indexOf("["), trimmed.indexOf("{")].filter((index) => index >= 0);
    const start = starts.length ? Math.min(...starts) : -1;
    if (start < 0) throw new Error("知乎 CLI 没有返回 JSON");
    return JSON.parse(trimmed.slice(start));
  }
};

const rowsFrom = (value: unknown): Array<Record<string, unknown>> => {
  if (Array.isArray(value)) return value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  for (const key of ["items", "results", "data"]) {
    if (Array.isArray(record[key])) return rowsFrom(record[key]);
  }
  return [];
};

const zhihuUrl = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || (url.hostname !== "zhihu.com" && !url.hostname.endsWith(".zhihu.com"))) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
};

const nonNegativeNumber = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : undefined;
};

const rowToItem = (
  row: Record<string, unknown>,
  source: SourceConfig,
  fetchedAt: string,
): RawHorizonItem | undefined => {
  const title = typeof row.title === "string" ? row.title.trim() : "";
  const url = zhihuUrl(row.url);
  if (!title || !url) return undefined;
  const author = typeof row.author === "string" ? row.author.trim() : undefined;
  const type = typeof row.type === "string" ? row.type.trim() : undefined;
  const score = nonNegativeNumber(row.votes ?? row.heat);
  const comments = nonNegativeNumber(row.answers ?? row.comments);
  return {
    id: `zhihu:${createHash("sha1").update(url).digest("hex").slice(0, 16)}`,
    source_type: "zhihu",
    title,
    url,
    content: [type ? `知乎${type}` : "知乎讨论", author ? `作者：${author}` : "", "仅作社区热点线索，成稿前必须交叉核验。"]
      .filter(Boolean)
      .join("；"),
    author,
    fetched_at: fetchedAt,
    metadata: {
      feed_name: source.name,
      score,
      comment_count: comments,
      discussion_url: url,
      discovery_only: true,
      source_role: "community",
    },
  };
};

const communityEvidencePriority = (value: string) => {
  try {
    const url = new URL(value);
    const hostname = url.hostname.replace(/^www\./u, "");
    if (hostname === "news.ycombinator.com" && url.pathname === "/item") return 100;
    if (hostname === "reddit.com" || hostname.endsWith(".reddit.com")) return 100;
    if (["x.com", "twitter.com", "threads.net", "bsky.app"].includes(hostname)) return 95;
    if (["youtube.com", "youtu.be", "tiktok.com"].includes(hostname)) return 85;
    if (hostname === "github.com" && /\/(?:issues|discussions)\//u.test(url.pathname)) return 80;
    return 10;
  } catch {
    return 0;
  }
};

const bestEvidenceUrl = (urls: string[]) => urls
  .map((url, index) => ({ url, index, priority: communityEvidencePriority(url) }))
  .sort((left, right) => right.priority - left.priority || left.index - right.index)[0]?.url;

const last30DaysDomainFor = (
  source: SourceConfig,
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "keywords">,
) => {
  const explicitTerms = keywordTerms(filters.keywords);
  if (explicitTerms.length) return explicitTerms.join(" ");
  return source.query?.trim() || topicLabels(topicIds).join(" ") || "AI 科技";
};

const last30DaysItems = (
  discovery: Last30DaysDiscovery,
  source: SourceConfig,
  fetchedAt: string,
): RawHorizonItem[] => discovery.topics.flatMap((topic) => {
  const url = bestEvidenceUrl(topic.evidenceUrls);
  if (!url) return [];
  const topComment = topic.topComment?.replace(/\s+/gu, " ").trim();
  const content = [
    topic.whySpiking ? `为什么正在升温：${topic.whySpiking}` : "",
    topComment ? `社区原句：${topComment}` : "",
    topic.sources.length ? `发现于：${topic.sources.join("、")}` : "",
    "这是近 30 天社区趋势线索，事实与转载权限需要在发布前单独核验。",
  ].filter(Boolean).join("\n");
  return [{
    id: `last30days:${createHash("sha1").update(`${topic.topic}:${url}`).digest("hex").slice(0, 16)}`,
    source_type: "last30days",
    title: topic.topic,
    url,
    content,
    published_at: discovery.generatedAt || fetchedAt,
    fetched_at: fetchedAt,
    metadata: {
      feed_name: source.name,
      discussion_url: url,
      discovery_only: true,
      source_role: "community",
      trend_window_days: discovery.windowDays,
      last30days_rank: topic.rank,
      last30days_momentum: topic.momentum,
      last30days_velocity: topic.velocityScore,
      corroboration_count: topic.corroborationCount,
      evidence_urls: topic.evidenceUrls,
      top_comment: topComment,
    },
  }];
});

export const collectCommunitySources = async (
  sources: SourceConfig[],
  topicIds: CollectionTopicId[],
  filters: Pick<CollectionRequest, "keywords"> = {},
  options: CommunityCollectionOptions = {},
): Promise<CommunityCollectionResult> => {
  const items: RawHorizonItem[] = [];
  const failures: Record<string, string> = {};
  const runCommand = options.runCommand ?? defaultRunCommand;
  for (const source of sources) {
    if (!source.enabled || !sourceSupportsTopics(source, topicIds)) continue;
    if (source.kind === "github") {
      try {
        items.push(...await (options.githubCollect ?? collectGitHubSource)(source, {
          now: options.now,
          signal: options.signal,
        }));
      } catch (error) {
        failures[source.id] = error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    if (source.kind === "last30days") {
      try {
        const discovery = await (options.last30DaysDiscover ?? discoverLast30Days)(
          last30DaysDomainFor(source, topicIds, filters),
          { signal: options.signal, timeoutMs: options.timeoutMs ?? 240_000 },
        );
        const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
        items.push(...last30DaysItems(discovery, source, fetchedAt));
        if (discovery.outcome !== "ok" && !discovery.topics.length) {
          failures[source.id] = "近 30 天没有达到可信阈值的社区趋势";
        }
      } catch (error) {
        failures[source.id] = error instanceof Error ? error.message : String(error);
      }
      continue;
    }
    if (source.kind !== "zhihu") continue;
    try {
      const query = searchQueryFor(source, topicIds, filters);
      const output = await runCommand("opencli", [
        "zhihu",
        "search",
        query,
        "--limit",
        "20",
        "--type",
        "all",
        "-f",
        "json",
        "--window",
        "background",
      ], {
        timeoutMs: options.timeoutMs ?? 15_000,
        signal: options.signal,
      });
      const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
      items.push(...rowsFrom(parseJson(output.stdout)).flatMap((row) => {
        const item = rowToItem(row, source, fetchedAt);
        return item ? [item] : [];
      }));
    } catch (error) {
      failures[source.id] = error instanceof Error ? error.message : String(error);
    }
  }
  return { items, failures };
};
