import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { RawHorizonItem, SourceConfig, SourceRoute } from "./types.js";
import { deepseekOfficialUpdatesUrl, geminiOfficialChangelogUrl, maximumOfficialUpdateBytes,
  parseDeepSeekOfficialUpdates, parseGeminiOfficialChangelog, claudeOfficialFeedUrl, parseClaudeOfficialFeed } from "./official-update-index.js";

/** Keep connector and health probes on the same allowlisted protocols. */
export const officialIndexRoute = (format: SourceRoute["format"], url: string) => {
  if (!format) return undefined;
  const index = format === "qwen-json"
    ? { url: qwenOfficialIndexUrl, requestUrl: qwenOfficialIndexUrl, maxBytes: maximumOfficialIndexBytes, accept: "application/json", parse: parseQwenOfficialIndex }
    : format === "deepseek-updates"
      ? { url: deepseekOfficialUpdatesUrl, requestUrl: deepseekOfficialUpdatesUrl, maxBytes: maximumOfficialUpdateBytes, accept: "text/html", parse: parseDeepSeekOfficialUpdates }
      : format === "gemini-changelog"
        ? { url: geminiOfficialChangelogUrl, requestUrl: `${geminiOfficialChangelogUrl}?hl=en`, maxBytes: maximumOfficialUpdateBytes, accept: "text/html", parse: parseGeminiOfficialChangelog }
        : format === "claude-changelog"
          ? { url: claudeOfficialFeedUrl, requestUrl: claudeOfficialFeedUrl, maxBytes: maximumOfficialUpdateBytes, accept: "application/rss+xml", parse: parseClaudeOfficialFeed }
          : undefined;
  if (!index || url !== index.url) throw new Error("官方目录路线必须指向对应的官方公开目录");
  return index;
};

export const qwenOfficialIndexUrl = "https://qwen.ai/api/v2/article/retrieval?language=zh-CN&type=qwen_ai";
// The public index embeds article HTML. Keep its larger response allowance
// specific to this adapter instead of increasing every feed's limit.
export const maximumOfficialIndexBytes = 8 * 1024 * 1024;
const text = (value: unknown) => {
  if (typeof value !== "string") return "";
  const $ = load(value.replace(/<\/(?:p|div|li|h[1-6])>/giu, "$& "));
  $("script,style,nav,footer").remove();
  return $.text().replace(/\s+/gu, " ").trim();
};
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** First-party discovery data; the chosen article still requires a frozen package. */
export const parseQwenOfficialIndex = (content: string, source: SourceConfig, fetchedAt: string): RawHorizonItem[] => {
  const articles = record(record(JSON.parse(content)).data).articles;
  if (!Array.isArray(articles)) throw new Error("Qwen 官方目录格式已变化：缺少文章列表");
  const seen = new Set<string>();
  const items = articles.flatMap((entry): RawHorizonItem[] => {
    const article = record(entry);
    const extra = record(article.extra);
    const slug = typeof article.path === "string" ? article.path.trim() : "";
    const title = text(article.title);
    if (!/^[a-z0-9][a-z0-9._-]{0,199}$/iu.test(slug) || !title || seen.has(slug)) return [];
    seen.add(slug);
    const date = typeof extra.date === "string" ? Date.parse(extra.date) : NaN;
    return [{
      id: `rss:${createHash("sha1").update(`${source.id}:${slug}`).digest("hex").slice(0, 20)}`,
      source_type: "rss", title: title.slice(0, 500),
      url: `https://qwen.ai/blog?id=${encodeURIComponent(slug)}`,
      content: text(article.content || extra.introduction || extra.description).slice(0, 12_000) || undefined,
      author: text(extra.author).slice(0, 180) || undefined,
      published_at: Number.isFinite(date) ? new Date(date).toISOString() : undefined,
      fetched_at: fetchedAt,
      metadata: { source_id: source.id, feed_name: source.name, feed_url: qwenOfficialIndexUrl,
        source_role: source.role ?? "official", source_format: "official-json", category: source.category,
        collector: "portable-typescript" },
    }];
  });
  if (articles.length && !items.length) throw new Error("Qwen 官方目录没有可识别的文章链接，请检查页面结构");
  return items.sort((a, b) => (Date.parse(b.published_at ?? "") || 0) - (Date.parse(a.published_at ?? "") || 0)).slice(0, 100);
};
