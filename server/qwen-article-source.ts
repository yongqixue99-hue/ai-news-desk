import { load } from "cheerio";
import { maximumOfficialIndexBytes, qwenOfficialIndexUrl } from "./official-news-index.js";
import { fetchRemote, readResponseBuffer } from "./remote-url.js";

export interface QwenArticleSource {
  html: string;
  title: string;
  publishedAt?: string;
  author?: string;
  canonicalUrl: string;
}

type QwenSourceFetcher = (url: string, init: RequestInit) => Promise<Response>;

const qwenArticleIdentity = (rawUrl: string) => {
  try {
    const url = new URL(rawUrl);
    if (url.origin !== "https://qwen.ai" || url.pathname !== "/blog" || url.username || url.password) return undefined;
    if (url.searchParams.getAll("id").length !== 1
      || [...url.searchParams.keys()].some((key) => key !== "id" && !/^utm_[a-z0-9_]+$/iu.test(key))) return undefined;
    const slug = url.searchParams.get("id")!;
    if (!/^[a-z0-9][a-z0-9._-]{0,199}$/iu.test(slug)) return undefined;
    return { slug, canonicalUrl: `https://qwen.ai/blog?id=${encodeURIComponent(slug)}` };
  } catch { return undefined; }
};

const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown) => {
  if (typeof value !== "string") return "";
  const $ = load(value);
  $("script,style").remove();
  return $.root().text().replace(/\s+/gu, " ").trim();
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/gu, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

const publicationDate = (value: unknown) => {
  if (typeof value !== "string") return undefined;
  const raw = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/iu.test(raw)) return undefined;
  const day = raw.slice(0, 10);
  const midnight = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return undefined;
  const timestamp = Date.parse(raw.length === 10 ? `${raw}T00:00:00Z` : raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : undefined;
};

/** Select one article from the official index; the whole JSON is never source prose. */
export const parseQwenArticleSource = (content: string, rawUrl: string): QwenArticleSource | undefined => {
  const identity = qwenArticleIdentity(rawUrl);
  if (!identity) return undefined;
  if (Buffer.byteLength(content, "utf8") > maximumOfficialIndexBytes) throw new Error("Qwen 官方目录超过允许大小");
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new Error("Qwen 官方目录格式无效：不是 JSON"); }
  const articles = record(parsed) && record(parsed.data) ? parsed.data.articles : undefined;
  if (!Array.isArray(articles)) throw new Error("Qwen 官方目录格式已变化：缺少文章列表");
  const matched = articles.filter((entry): entry is Record<string, unknown> => record(entry)
    && typeof entry.path === "string" && entry.path.trim() === identity.slug);
  if (!matched.length) throw new Error("Qwen 官方目录未找到指定文章");
  if (matched.length !== 1) throw new Error("Qwen 官方目录中的指定文章 ID 不唯一");
  const article = matched[0];
  const title = text(article.title).slice(0, 500);
  if (!title) throw new Error("Qwen 原文缺少有效标题");
  if (typeof article.content !== "string" || !/<(?:article|section|div|p|h[1-6]|table|figure|img|svg|pre|ul|ol|blockquote)\b/iu.test(article.content)) {
    throw new Error("Qwen 原文正文不是可识别的 HTML");
  }
  const $ = load(article.content);
  const articleNodes = $("article");
  if (articleNodes.length > 1) throw new Error("Qwen 原文包含多个正文区域，无法确认文章范围");
  if (!articleNodes.length && /<(?:html|body)\b/iu.test(article.content)) throw new Error("Qwen 原文只有页面外壳，缺少文章正文区域");
  // Qwen currently embeds a complete legacy-site document. Ignore its head,
  // canonical, navigation and related articles; retain the selected article's
  // actual markup for the existing static article-structure parser to clean.
  const body = articleNodes.length ? articleNodes.first() : $("body");
  body.find("nav,footer,form,[role='navigation']").remove();
  const articleHtml = body.html() ?? "";
  const meaningful = body.clone();
  meaningful.find("script,style,noscript").remove();
  if (!meaningful.text().trim() && !meaningful.find("img,svg,table").length) throw new Error("Qwen 原文正文为空");
  const heading = body.find("h1").length ? "" : `<h1>${escapeHtml(title)}</h1>`;
  const extra = record(article.extra) ? article.extra : {};
  return {
    html: `<article data-source-url="${escapeHtml(identity.canonicalUrl)}">${heading}${articleHtml}</article>`,
    title,
    publishedAt: publicationDate(extra.date),
    author: text(extra.author).slice(0, 180) || undefined,
    canonicalUrl: identity.canonicalUrl,
  };
};

const defaultFetcher: QwenSourceFetcher = (url, init) => fetchRemote(url, init, 0);
interface SharedIndexRead {
  promise: Promise<string>;
  controller: AbortController;
  consumers: number;
  settled: boolean;
}
// Share only concurrent reads, scoped by the injected transport. No completed
// content or credentials are retained as an additional cache layer.
const inFlight = new WeakMap<QwenSourceFetcher, SharedIndexRead>();

const readIndex = async (fetcher: QwenSourceFetcher, controller: AbortController) => {
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(18_000)]);
  let response: Response | undefined;
  try {
    response = await fetcher(qwenOfficialIndexUrl, { signal, headers: {
      accept: "application/json", "user-agent": "AI-News-Desk/0.2 (Qwen article source)",
    } });
    signal.throwIfAborted();
    if (response.redirected || (response.status >= 300 && response.status < 400)
      || (response.url && response.url !== qwenOfficialIndexUrl)) throw new Error("Qwen 官方目录发生异常重定向");
    if (!response.ok) throw new Error(`Qwen 官方目录返回 HTTP ${response.status}`);
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (contentType && contentType !== "application/json" && !/^application\/[a-z0-9.+-]+\+json$/u.test(contentType)) throw new Error("Qwen 官方目录未返回 JSON 数据");
    const buffer = await readResponseBuffer(response, maximumOfficialIndexBytes);
    signal.throwIfAborted();
    return buffer.toString("utf8");
  } catch (error) {
    await response?.body?.cancel().catch(() => undefined);
    if (controller.signal.aborted) throw controller.signal.reason;
    if (signal.aborted) throw new Error("Qwen 官方文章目录读取超时");
    if (error instanceof Error && /^(?:Qwen 官方目录|远程响应超过允许大小)/u.test(error.message)) throw error;
    // Transport exceptions and remote content can contain sensitive or arbitrary text.
    throw new Error("Qwen 官方文章目录读取失败");
  }
};

const getSharedRead = (fetcher: QwenSourceFetcher) => {
  const current = inFlight.get(fetcher);
  if (current) return current;
  const controller = new AbortController();
  const entry: SharedIndexRead = { controller, consumers: 0, settled: false, promise: Promise.resolve("") };
  entry.promise = readIndex(fetcher, controller).finally(() => {
    entry.settled = true;
    if (inFlight.get(fetcher) === entry) inFlight.delete(fetcher);
  });
  inFlight.set(fetcher, entry);
  return entry;
};

const waitForIndex = (promise: Promise<string>, signal?: AbortSignal) => {
  if (!signal) return promise;
  return new Promise<string>((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((content) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else resolve(content);
    }, (error) => { signal.removeEventListener("abort", abort); reject(error); });
    if (signal.aborted) abort();
  });
};

/** Read only Qwen's public article index, without executing the SPA's remote JavaScript. */
export const readQwenArticleSource = async (rawUrl: string, options: {
  fetcher?: QwenSourceFetcher;
  signal?: AbortSignal;
} = {}): Promise<QwenArticleSource | undefined> => {
  if (!qwenArticleIdentity(rawUrl)) return undefined;
  options.signal?.throwIfAborted();
  const fetcher = options.fetcher ?? defaultFetcher;
  const entry = getSharedRead(fetcher);
  entry.consumers += 1;
  try {
    const content = await waitForIndex(entry.promise, options.signal);
    options.signal?.throwIfAborted();
    return parseQwenArticleSource(content, rawUrl);
  } finally {
    entry.consumers -= 1;
    if (!entry.consumers && !entry.settled) {
      if (inFlight.get(fetcher) === entry) inFlight.delete(fetcher);
      entry.controller.abort();
    }
  }
};
