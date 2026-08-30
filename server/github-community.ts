import { createHash } from "node:crypto";
import { load } from "cheerio";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";
import type { RawHorizonItem, SourceConfig } from "./types.js";

interface GitHubRelease {
  id: number;
  name?: string | null;
  tag_name?: string;
  html_url?: string;
  body?: string | null;
  published_at?: string | null;
  author?: { login?: string } | null;
  draft?: boolean;
  prerelease?: boolean;
}

interface GitHubIssue {
  id: number;
  number: number;
  title?: string;
  html_url?: string;
  body?: string | null;
  created_at?: string;
  updated_at?: string;
  comments?: number;
  user?: { login?: string } | null;
  pull_request?: unknown;
  labels?: Array<{ name?: string }>;
}

export interface GitHubAdapterOptions {
  fetcher?: typeof fetchRemote;
  now?: () => Date;
  signal?: AbortSignal;
}

export const repositoriesForGitHubSource = (source: SourceConfig) => [...new Set(
  (source.query ?? "")
    .split(/[,，\n\s]+/u)
    .map((value) => value.trim())
    .filter((value) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value)),
)].slice(0, 8);

const compact = (value: string | null | undefined, limit = 900) => (value ?? "")
  .replace(/<[^>]+>/gu, " ")
  .replace(/\s+/gu, " ")
  .trim()
  .slice(0, limit);

const githubGet = async <T>(url: string, options: GitHubAdapterOptions): Promise<T> => {
  const response = await (options.fetcher ?? fetchRemote)(url, {
    signal: options.signal ?? AbortSignal.timeout(15_000),
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": "AI-News-Desk/0.1",
    },
  }, 2);
  if (!response.ok) throw new Error(`GitHub API 返回 HTTP ${response.status}`);
  const bytes = await readResponseBuffer(response, 2 * 1024 * 1024);
  return JSON.parse(bytes.toString("utf8")) as T;
};

const releaseItems = (releases: GitHubRelease[], repo: string, source: SourceConfig, fetchedAt: string) => releases
  .filter((release) => !release.draft && release.html_url && release.published_at)
  .slice(0, 5)
  .map((release) => ({
    id: `github-release:${release.id}`,
    source_type: "github",
    title: `${repo} ${release.name || release.tag_name || "发布新版本"}`,
    url: release.html_url!,
    content: [
      release.prerelease ? "预发布版本" : "正式 Release",
      compact(release.body),
    ].filter(Boolean).join("；"),
    author: release.author?.login,
    published_at: release.published_at!,
    fetched_at: fetchedAt,
    metadata: {
      feed_name: source.name,
      source_role: "official",
      github_repository: repo,
      github_kind: "release",
      discovery_only: false,
    },
  } satisfies RawHorizonItem));

const issueItems = (issues: GitHubIssue[], repo: string, source: SourceConfig, fetchedAt: string) => issues
  .filter((issue) => !issue.pull_request && issue.html_url && issue.title)
  .slice(0, 8)
  .map((issue) => ({
    id: `github-issue:${issue.id}`,
    source_type: "github",
    title: `${repo} #${issue.number} · ${issue.title}`,
    url: issue.html_url!,
    content: [compact(issue.body), issue.labels?.length ? `标签：${issue.labels.map((label) => label.name).filter(Boolean).join("、")}` : ""]
      .filter(Boolean)
      .join("；"),
    author: issue.user?.login,
    published_at: issue.created_at || issue.updated_at,
    fetched_at: fetchedAt,
    metadata: {
      feed_name: source.name,
      source_role: "community",
      github_repository: repo,
      github_kind: "issue",
      discussion_url: issue.html_url,
      comment_count: issue.comments,
      discovery_only: true,
    },
  } satisfies RawHorizonItem));

const discussionItems = async (repo: string, source: SourceConfig, fetchedAt: string, options: GitHubAdapterOptions) => {
  const url = `https://github.com/${repo}/discussions`;
  const response = await (options.fetcher ?? fetchRemote)(url, {
    signal: options.signal ?? AbortSignal.timeout(15_000),
    headers: { accept: "text/html", "user-agent": "AI-News-Desk/0.1" },
  }, 2);
  if (!response.ok) return [];
  const html = (await readResponseBuffer(response, 2 * 1024 * 1024)).toString("utf8");
  const $ = load(html);
  const seen = new Set<string>();
  const items: RawHorizonItem[] = [];
  $(`a[href^="/${repo}/discussions/"]`).each((_index, element) => {
    if (items.length >= 6) return false;
    const href = $(element).attr("href")?.split("#")[0];
    const title = compact($(element).text(), 240);
    if (!href || !title || !/^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/discussions\/\d+$/u.test(href) || seen.has(href)) return;
    seen.add(href);
    const container = $(element).closest("article, li, .Box-row, [data-testid]");
    const publishedAt = container.find("relative-time").attr("datetime") || fetchedAt;
    const discussionUrl = `https://github.com${href}`;
    items.push({
      id: `github-discussion:${createHash("sha1").update(discussionUrl).digest("hex").slice(0, 16)}`,
      source_type: "github",
      title: `${repo} Discussion · ${title}`,
      url: discussionUrl,
      content: "GitHub Discussions 公开讨论线索；观点不能独立证明事实。",
      published_at: publishedAt,
      fetched_at: fetchedAt,
      metadata: {
        feed_name: source.name,
        source_role: "community",
        github_repository: repo,
        github_kind: "discussion",
        discussion_url: discussionUrl,
        discovery_only: true,
      },
    });
  });
  return items;
};

export const collectGitHubSource = async (
  source: SourceConfig,
  options: GitHubAdapterOptions = {},
): Promise<RawHorizonItem[]> => {
  const repositories = repositoriesForGitHubSource(source);
  if (!repositories.length) throw new Error("GitHub 来源没有配置 owner/repository 列表");
  const fetchedAt = (options.now ?? (() => new Date()))().toISOString();
  const items: RawHorizonItem[] = [];
  for (const repo of repositories) {
    const [releases, issues, discussions] = await Promise.all([
      githubGet<GitHubRelease[]>(`https://api.github.com/repos/${repo}/releases?per_page=5`, options).catch(() => []),
      githubGet<GitHubIssue[]>(`https://api.github.com/repos/${repo}/issues?state=open&sort=comments&direction=desc&per_page=10`, options).catch(() => []),
      discussionItems(repo, source, fetchedAt, options).catch(() => []),
    ]);
    items.push(...releaseItems(releases, repo, source, fetchedAt));
    items.push(...issueItems(issues, repo, source, fetchedAt));
    items.push(...discussions);
  }
  if (!items.length) throw new Error("GitHub 没有返回 Release、Issue 或 Discussion");
  return items;
};
