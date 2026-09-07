import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import type { RawHorizonItem, SourceConfig } from "./types.js";
export { technicalArticlePolicy } from "./technical-article.js";

export const officialKnowledgeSources: SourceConfig[] = [
  { id: "openai-cookbook", name: "OpenAI Cookbook 官方实践", url: "https://developers.openai.com/cookbook", homepageUrl: "https://developers.openai.com/cookbook" },
  { id: "anthropic-engineering", name: "Anthropic 官方工程文章", url: "https://www.anthropic.com/engineering", homepageUrl: "https://www.anthropic.com/engineering" },
  { id: "claude-cookbook", name: "Claude Cookbook 官方实践", url: "https://platform.claude.com/cookbook", homepageUrl: "https://platform.claude.com/cookbook" },
].map(source => ({ ...source, kind: "documentation", enabled: true, selected: true, category: "AI", role: "official", discoveryOnly: false, topicIds: ["ai", "technology"], note: "技术候选库：保留原日期，优先忠实整理与原文图表，不按当天新闻处理。" }));

const clean = (value: string) => value.replace(/\s+/gu, " ").trim();

/** Read bounded first-party article links; no arbitrary links or embedded instructions are executed. */
export const parseKnowledgeIndex = (html: string, source: SourceConfig, fetchedAt: string): RawHorizonItem[] => {
  const base = new URL(source.url || source.homepageUrl || "");
  const prefix = base.hostname === "developers.openai.com" ? "/cookbook/examples/" : `${base.pathname.replace(/\/$/u, "")}/`;
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  const results: RawHorizonItem[] = [];
  const seen = new Set<string>();
  for (const node of $("a[href]").toArray()) {
    const link = $(node);
    let url: URL;
    try { url = new URL(link.attr("href") || "", base); } catch { continue; }
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.pathname === prefix || url.username || url.password) continue;
    url.hash = ""; url.search = "";
    if (seen.has(url.href)) continue;
    const title = clean(link.find("h2,h3,h4,h5").first().text() || link.attr("aria-label") || link.text());
    if (title.length < 5 || /^(?:read more|learn more|view all|下一页|了解更多)$/iu.test(title)) continue;
    const card = link.closest("article, li").length ? link.closest("article, li") : link;
    const rawDate = card.find("time[datetime]").first().attr("datetime");
    const date = rawDate ? Date.parse(rawDate) : NaN;
    const publishedAt = Number.isFinite(date) ? new Date(date).toISOString() : undefined;
    const summary = clean(card.find("p").first().text());
    seen.add(url.href);
    results.push({
      id: `documentation:${createHash("sha1").update(url.href).digest("hex").slice(0, 20)}`,
      source_type: "documentation", title: title.slice(0, 300), url: url.href,
      content: summary || title, published_at: publishedAt, fetched_at: fetchedAt,
      metadata: { source_id: source.id, feed_name: source.name, source_role: source.role || "official", content_kind: "technical", index_url: base.href, publication_date_known: Boolean(publishedAt) },
    });
    if (results.length >= 18) break;
  }
  return results;
};
