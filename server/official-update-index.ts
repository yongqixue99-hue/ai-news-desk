import { createHash } from "node:crypto";
import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { RawHorizonItem, SourceConfig } from "./types.js";

export const deepseekOfficialUpdatesUrl = "https://api-docs.deepseek.com/updates/";
export const geminiOfficialChangelogUrl = "https://ai.google.dev/gemini-api/docs/changelog";
export const claudeOfficialChangelogUrl = "https://platform.claude.com/docs/en/release-notes/overview";
export const claudeOfficialFeedUrl = "https://platform.claude.com/docs/en/release-notes/feed.xml";
export const maximumOfficialUpdateBytes = 4 * 1024 * 1024;
export type OfficialUpdateFormat = "deepseek-updates" | "gemini-changelog" | "claude-changelog";
const pageFor = (format: OfficialUpdateFormat) => format === "deepseek-updates" ? deepseekOfficialUpdatesUrl
  : format === "gemini-changelog" ? geminiOfficialChangelogUrl : claudeOfficialChangelogUrl;

const ignoredElements = "script,style,noscript,nav,footer,aside,header,form,iframe,button,[hidden],[aria-hidden='true'],.hash-link,devsite-actions";
const whitespace = (value: string) => value.replace(/[\u200b-\u200d\ufeff]/gu, "").replace(/\s+/gu, " ").trim();
const text = (nodes: Cheerio<AnyNode>) => {
  const clone = nodes.clone();
  clone.find(ignoredElements).remove();
  // Keep boundaries between list items and paragraphs without interpreting HTML.
  const $ = load(clone.toString().replace(/<\/(?:p|div|li|h[1-6]|tr)>/giu, "$& "));
  $(ignoredElements).remove();
  return whitespace($.text());
};

const utcDay = (year: number, month: number, day: number): string | undefined => {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
};

const dateFromHeading = (label: string, format: OfficialUpdateFormat): string | undefined => {
  if (format === "deepseek-updates") {
    const match = /^Date:\s*(20\d{2})-(\d{2})-(\d{2})$/u.exec(label);
    return match ? utcDay(Number(match[1]), Number(match[2]), Number(match[3])) : undefined;
  }
  const match = /^(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})$/u.exec(label);
  if (!match) return undefined;
  const month = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].indexOf(match[1]!) + 1;
  return utcDay(Number(match[3]), month, Number(match[2]));
};

const permalink = (heading: Cheerio<AnyNode>, pageUrl: string): string | undefined => {
  const id = heading.attr("id") ?? "";
  if (!/^[a-z0-9][a-z0-9_-]{0,199}$/iu.test(id)) return undefined;
  const expected = new URL(pageUrl);
  expected.hash = id;
  // Docusaurus exposes an explicit permalink. If present it must refer to
  // this exact section on this exact official page, never an imported URL.
  for (const link of heading.find("a.hash-link")) {
    const href = link.attribs?.href;
    if (!href) return undefined;
    try {
      if (new URL(href, pageUrl).href !== expected.href) return undefined;
    } catch { return undefined; }
  }
  return expected.href;
};

const documentRoot = (content: string, format: OfficialUpdateFormat): { $: CheerioAPI; root: Cheerio<AnyNode> } => {
  if (Buffer.byteLength(content, "utf8") > maximumOfficialUpdateBytes) throw new Error("官方更新页体积超过 4 MB 上限");
  const $ = load(content);
  // Remove active/irrelevant areas, but keep hash links until their target is checked.
  // Keep asides inside the selected event until the article reader resolves
  // explicitly referenced footnotes. Discovery excerpts still discard them.
  $("script,style,noscript,nav,footer,header,form,iframe,[hidden],[aria-hidden='true'],devsite-actions").remove();
  const selector = format === "deepseek-updates" ? "main article .theme-doc-markdown"
    : format === "claude-changelog" ? "main article .docs-prose" : "main article .devsite-article-body";
  const root = $(selector).first();
  if (!root.length) throw new Error("官方更新页结构已变化或返回了访问验证页：缺少正文容器");
  if (format === "gemini-changelog") {
    // Devsite can serve a translated representation at the same URL. A few
    // untranslated dates do not make that representation safe for this parser.
    const language = (root.closest("[lang]").attr("lang") ?? $("html").attr("lang") ?? "").trim();
    if (language && !/^en(?:[-_]|$)/iu.test(language)) {
      throw new Error("Gemini 官方更新页语言不是英文，请检查英文读取路线，不能沿用部分日期结果");
    }
  }
  return { $, root };
};

interface OfficialUpdateSection {
  url: string;
  title: string;
  publishedAt: string;
  dateLabel: string;
  excerpt: string;
  html: string;
}

const readOfficialUpdateSections = (content: string, format: OfficialUpdateFormat): OfficialUpdateSection[] => {
  const { $, root } = documentRoot(content, format);
  const pageUrl = pageFor(format);
  const items: OfficialUpdateSection[] = [];
  const seen = new Set<string>();
  const headings = root.find(format === "claude-changelog" ? "h3" : "h2").toArray().map((element) => {
    const heading = $(element);
    const dateLabel = text(heading);
    return { heading, dateLabel, publishedAt: dateFromHeading(dateLabel, format) };
  });
  if (format === "gemini-changelog") {
    // Count only actual date headings or valid dates in Devsite's stable
    // MM-DD-YYYY section anchors. Generic API/guide headings and impossible
    // calendar dates are not evidence of a translated/malformed date section.
    const datedSections = headings.filter(({ heading, publishedAt }) => {
      if (publishedAt) return true;
      const anchor = /^(\d{2})-(\d{2})-(20\d{2})$/u.exec(heading.attr("id") ?? "");
      return Boolean(anchor && utcDay(Number(anchor[3]), Number(anchor[1]), Number(anchor[2])));
    });
    const recognized = datedSections.filter((section) => section.publishedAt).length;
    if (datedSections.length && recognized / datedSections.length < 0.8) {
      throw new Error(`Gemini 官方更新页日期标题格式已变化：仅识别 ${recognized}/${datedSections.length} 个日期段，不能把部分记录标记为读取成功`);
    }
  }

  const append = (heading: Cheerio<AnyNode>, title: string, body: Cheerio<AnyNode>, publishedAt: string, dateLabel: string) => {
    const url = permalink(heading, pageUrl);
    const excerpt = text(body).slice(0, 12_000);
    if (!url || seen.has(url) || !title || !excerpt) return;
    seen.add(url);
    const headingHtml = heading.clone();
    headingHtml.find("a.hash-link").remove();
    items.push({ url, title: title.slice(0, 500), publishedAt, dateLabel, excerpt,
      html: headingHtml.toString() + body.toString() });
  };

  // Both verified pages use sibling headings inside their article content.
  // A new h2 always starts a new date context; an invalid/missing date cannot
  // inherit a preceding section date or the whole page's modified timestamp.
  for (const { heading, dateLabel, publishedAt } of headings) {
    if (!publishedAt) continue;
    const section = heading.nextUntil(format === "claude-changelog" ? "h2,h3" : "h2");
    if (format === "deepseek-updates") {
      for (const event of section.filter("h3")) {
        const eventHeading = $(event);
        append(eventHeading, text(eventHeading), eventHeading.nextUntil("h2,h3"), publishedAt, dateLabel);
      }
    } else {
      // Gemini exposes only date anchors. Preserve one daily source section,
      // including all its changes, rather than inventing per-bullet permalinks.
      const lead = format === "claude-changelog" ? section.find("li").first() : section.find("strong").first();
      const title = lead.length ? text(lead) : text(section.filter("ul,ol,p").first()).split(/(?<=[.!?。！？])\s/u)[0] ?? "";
      append(heading, title, section, publishedAt, dateLabel);
    }
  }
  if (!items.length) throw new Error("官方更新页没有可识别的带日期更新，请检查日期、永久链接与页面结构");
  return items.sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt));
};

const parseOfficialUpdates = (content: string, source: SourceConfig, fetchedAt: string, format: OfficialUpdateFormat): RawHorizonItem[] => {
  const pageUrl = pageFor(format);
  return readOfficialUpdateSections(content, format).slice(0, 100).map((section) => ({
    id: `rss:${createHash("sha1").update(`${source.id}:${section.url}`).digest("hex").slice(0, 20)}`,
    source_type: "rss", title: section.title, url: section.url, content: section.excerpt,
    author: format === "deepseek-updates" ? "DeepSeek" : "Google", published_at: section.publishedAt, fetched_at: fetchedAt,
    metadata: {
      source_id: source.id, feed_name: source.name, feed_url: pageUrl,
      source_role: source.role ?? "official", category: source.category,
      source_format: format, event_identity_url: section.url,
      event_granularity: format === "deepseek-updates" ? "event" : "dated-section",
      original_date_text: section.dateLabel, date_precision: "day", date_basis: "section-heading", date_timezone: "unspecified",
      collector: "portable-typescript",
    },
  }));
};

/**
 * For known index pages, evidence must resolve to exactly one dated section.
 * Never let a missing/changed anchor fall back to the entire history page.
 */
export const extractOfficialUpdateSection = (content: string, eventUrl: string): { title: string; publishedAt: string; html: string } | undefined => {
  let url: URL;
  try { url = new URL(eventUrl); } catch { return undefined; }
  const format: OfficialUpdateFormat | undefined =
    url.origin === "https://api-docs.deepseek.com" && /^\/updates\/?$/u.test(url.pathname) ? "deepseek-updates"
      : url.origin === "https://ai.google.dev" && /^\/gemini-api\/docs\/changelog\/?$/u.test(url.pathname) ? "gemini-changelog"
        : url.origin === "https://platform.claude.com" && url.pathname === "/docs/en/release-notes/overview" ? "claude-changelog" : undefined;
  if (!format) return undefined;
  if (url.username || url.password || url.search || !/^#[a-z0-9][a-z0-9_-]{0,199}$/iu.test(url.hash)) {
    throw new Error("官方更新条目缺少有效永久链接，请选择具体更新日期或事件");
  }
  const pageUrl = pageFor(format);
  const section = readOfficialUpdateSections(content, format).find((entry) => entry.url === pageUrl + url.hash);
  if (!section) throw new Error("官方更新条目不存在或缺少原始日期，不能把整页历史作为本条新闻证据");
  return { title: section.title, publishedAt: section.publishedAt, html: section.html };
};

/** Discovery excerpts only: article generation still requires a frozen ContentPackage. */
export const parseDeepSeekOfficialUpdates = (content: string, source: SourceConfig, fetchedAt: string): RawHorizonItem[] =>
  parseOfficialUpdates(content, source, fetchedAt, "deepseek-updates");

export const parseGeminiOfficialChangelog = (content: string, source: SourceConfig, fetchedAt: string): RawHorizonItem[] =>
  parseOfficialUpdates(content, source, fetchedAt, "gemini-changelog");

/** The publisher's RSS carries dated sections; keep the calendar precision
 * and use the original lead instead of the generic "release notes" title. */
export const parseClaudeOfficialFeed = (content: string, source: SourceConfig, fetchedAt: string): RawHorizonItem[] => {
  if (Buffer.byteLength(content, "utf8") > maximumOfficialUpdateBytes) throw new Error("官方订阅体积超过 4 MB 上限");
  const $ = load(content, { xmlMode: true });
  const items: RawHorizonItem[] = [];
  const seen = new Set<string>();
  for (const element of $("rss > channel > item").toArray().slice(0, 200)) {
    const entry = $(element);
    const originalTitle = entry.children("title").text().trim();
    const dateLabel = originalTitle.match(/(?:—|–|-)\s*((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2})$/u)?.[1];
    const publishedAt = dateLabel && dateFromHeading(dateLabel, "claude-changelog");
    const declaredAt = Date.parse(entry.children("pubDate").text());
    const url = entry.children("link").text().trim();
    const expected = dateLabel ? `${claudeOfficialChangelogUrl}#${dateLabel.toLowerCase().replace(/,/gu, "").replace(/\s+/gu, "-")}` : "";
    if (!publishedAt || !Number.isFinite(declaredAt) || new Date(declaredAt).toISOString().slice(0, 10) !== publishedAt.slice(0, 10)
      || url !== expected || seen.has(url)) continue;
    const body = load(entry.children("description").text());
    body(ignoredElements).remove();
    const excerpt = text(body.root()).slice(0, 12_000);
    const lead = text(body("li").first().length ? body("li").first() : body.root());
    const title = (lead.split(/(?<=[.!?。！？])\s/u)[0] ?? "").slice(0, 500);
    if (!title || !excerpt) continue;
    seen.add(url);
    items.push({ id: `rss:${createHash("sha1").update(`${source.id}:${url}`).digest("hex").slice(0, 20)}`,
      source_type: "rss", title, url, content: excerpt, author: "Anthropic", published_at: publishedAt, fetched_at: fetchedAt,
      metadata: { source_id: source.id, source_role: source.role ?? "official", feed_name: source.name,
        feed_url: claudeOfficialFeedUrl, feed_original_title: originalTitle, source_format: "claude-changelog",
        event_identity_url: url, event_granularity: "dated-section", category: source.category,
        original_date_text: dateLabel, date_precision: "day", date_basis: "official-feed", date_timezone: "unspecified",
        collector: "portable-typescript" } });
    if (items.length === 100) break;
  }
  if (!items.length) throw new Error("Claude 官方订阅没有可核对的日期条目，请检查订阅格式、日期及原文链接");
  return items;
};
