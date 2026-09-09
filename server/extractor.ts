import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import sharp from "sharp";
import { fetchRemote, readResponseBuffer, validateRemoteUrl } from "./remote-url.js";
import { workflowMediaRoot } from "./storage.js";
import { extractOfficialUpdateSection } from "./official-update-index.js";
import { hasOfficialUpdateAnchor } from "./official-update-url.js";
import { boundArticleBlocks, extractArticleStructure } from "./article-structure.js";
import { readQwenArticleSource, type QwenArticleSource } from "./qwen-article-source.js";
import type { ExtractedPage, SourceImage } from "./types.js";

const imageNoise = /logo|icon|avatar|emoji|tracking|pixel|spinner|loading|sprite|favicon|author|profile|badge|button/i;

export const extractArticleBlocks = (html: string): NonNullable<ExtractedPage["blocks"]> => extractArticleStructure(html).blocks;

const absoluteUrl = (raw: string | undefined, base: URL) => {
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return undefined;
  try {
    const url = new URL(raw, base);
    return ["https:", "http:"].includes(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

const srcFromSet = (srcset?: string) => {
  if (!srcset) return undefined;
  const candidates = srcset
    .split(",")
    .map((entry) => { const [url, descriptor] = entry.trim().split(/\s+/); return { url, size: Number.parseFloat(descriptor ?? "1") || 1 }; })
    .filter((entry) => entry.url && !entry.url.startsWith("data:"))
    .sort((a, b) => b.size - a.size);
  return candidates[0]?.url;
};

const normalizedText = (value: string) => value.replace(/\s+/g, " ").trim();

const moduleImagePattern = /(?:https?:)?\/\/[^\s"'`\\)]+?\.(?:png|jpe?g|webp|avif|gif)(?:\?[^\s"'`\\)]*)?|(?:\.\.\/|\.\/|\/)[^\s"'`\\)]+?\.(?:png|jpe?g|webp|avif|gif)(?:\?[^\s"'`\\)]*)?/gi;

/**
 * Client-rendered editorial pages often ship article image URLs only inside
 * their page-specific JavaScript module. Keep this parser deliberately small:
 * it accepts direct raster asset URLs, rejects obvious UI chrome, and leaves
 * downloading/content-type validation to the existing remote-image boundary.
 */
export const extractImageUrlsFromModuleSource = (source: string, moduleUrl: URL) => {
  const normalized = source
    .replace(/\\u002f/gi, "/")
    .replace(/\\\//g, "/");
  const seen = new Set<string>();
  const urls: string[] = [];
  for (const match of normalized.matchAll(moduleImagePattern)) {
    const raw = match[0];
    const url = absoluteUrl(raw, moduleUrl);
    if (!url || imageNoise.test(url) || seen.has(url)) continue;
    seen.add(url);
    urls.push(url);
  }
  return urls;
};

const decodeModuleText = (value: string) => value
  .replace(/\\u\{([0-9a-f]+)\}/giu, (_match, point: string) => {
    try {
      return String.fromCodePoint(Number.parseInt(point, 16));
    } catch {
      return "";
    }
  })
  .replace(/\\u([0-9a-f]{4})/giu, (_match, point: string) => String.fromCharCode(Number.parseInt(point, 16)))
  .replace(/\\x([0-9a-f]{2})/giu, (_match, point: string) => String.fromCharCode(Number.parseInt(point, 16)))
  .replace(/\\([\\`'"nrt])/gu, (_match, escaped: string) => ({
    "\\": "\\",
    "`": "`",
    "'": "'",
    '"': '"',
    n: "\n",
    r: "\r",
    t: "\t",
  })[escaped] ?? escaped);

const templateLiteralsFrom = (payload: string) => {
  const values: string[] = [];
  for (let index = 0; index < payload.length; index += 1) {
    if (payload[index] !== "`") continue;
    let raw = "";
    let cursor = index + 1;
    for (; cursor < payload.length; cursor += 1) {
      const character = payload[cursor]!;
      if (character === "\\" && cursor + 1 < payload.length) {
        raw += character + payload[cursor + 1]!;
        cursor += 1;
        continue;
      }
      if (character === "`") break;
      raw += character;
    }
    const prefix = payload.slice(Math.max(0, index - 36), index);
    // Nested JSX props are metadata, not visible article copy. The `children`
    // prop itself deliberately remains eligible.
    if (!/(?:href|src|className|target|rel|id|key|style|title)\s*:\s*$/u.test(prefix)) {
      values.push(decodeModuleText(raw));
    }
    index = cursor;
  }
  return values;
};

const matchingObjectEnd = (source: string, start: number) => {
  let depth = 0;
  let quote: "`" | "'" | '"' | undefined;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === "`" || character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}" && --depth === 0) return index;
  }
  return -1;
};

export interface ModuleArticleContent {
  title?: string;
  blocks: NonNullable<ExtractedPage["blocks"]>;
  extractionWarnings?: string[];
  textTruncated?: boolean;
}

/**
 * Reads the literal text from Vite/MDX-style JSX modules without evaluating
 * remote JavaScript. This covers client-only article shells such as z.ai,
 * where both the prose and the charts live in the page module.
 */
export const extractArticleFromModuleSource = (source: string): ModuleArticleContent => {
  const blocks: NonNullable<ExtractedPage["blocks"]> = [];
  const componentPattern = /\(\s*0\s*,\s*[\w$]+\.jsx(?:s)?\s*\)\(\s*[\w$]+\.(h2|h3|p|blockquote|li)\s*,\s*\{\s*children\s*:/gu;
  for (const match of source.matchAll(componentPattern)) {
    const objectStart = source.lastIndexOf("{", (match.index ?? 0) + match[0].length);
    if (objectStart < 0) continue;
    const objectEnd = matchingObjectEnd(source, objectStart);
    if (objectEnd < 0) continue;
    const payloadStart = (match.index ?? 0) + match[0].length;
    const text = normalizedText(templateLiteralsFrom(source.slice(payloadStart, objectEnd)).join(""));
    if (text.length < 2 || blocks.at(-1)?.text === text) continue;
    const tag = match[1];
    blocks.push({
      kind: tag === "h2" || tag === "h3"
        ? "heading"
        : tag === "blockquote"
          ? "quote"
          : tag === "li"
            ? "list-item"
            : "paragraph",
      text,
    });
  }
  const renderSource = source.slice(Math.max(0, source.lastIndexOf("createRoot")));
  const titleMatch = renderSource.match(/\btitle\s*:\s*`((?:\\.|[^`]){2,240})`/u);
  const title = titleMatch ? normalizedText(decodeModuleText(titleMatch[1]!)) : undefined;
  const bounded = boundArticleBlocks(blocks);
  return { title, blocks: bounded.blocks, extractionWarnings: bounded.extractionWarnings, textTruncated: bounded.textTruncated };
};

const moduleFallbackForClientShell = async (
  moduleUrls: string[],
  pageUrl: URL,
  imageLimit: number,
) => {
  const images: string[] = [];
  const blocks: NonNullable<ExtractedPage["blocks"]> = [];
  const extractionWarnings: string[] = [];
  let textTruncated = false;
  let title: string | undefined;
  for (const moduleUrl of moduleUrls.slice(0, 3)) {
    try {
      const response = await fetchRemote(moduleUrl, {
        signal: AbortSignal.timeout(10_000),
        headers: {
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 AI-News-Desk/0.1",
          accept: "text/javascript,application/javascript,*/*;q=0.1",
          referer: pageUrl.toString(),
        },
      });
      if (!response.ok) continue;
      const contentType = response.headers.get("content-type") ?? "";
      if (!/(?:java|ecma)script|text\/plain/i.test(contentType)) continue;
      const source = (await readResponseBuffer(response, 2_000_000)).toString("utf8");
      if (imageLimit > 0) {
        images.push(...extractImageUrlsFromModuleSource(source, new URL(response.url || moduleUrl)));
      }
      const article = extractArticleFromModuleSource(source);
      title ??= article.title;
      blocks.push(...article.blocks);
      extractionWarnings.push(...article.extractionWarnings ?? []);
      textTruncated ||= article.textTruncated ?? false;
      if (images.length >= imageLimit && blocks.length >= 3 && title) break;
    } catch {
      // Module probing is a best-effort fallback. A failed asset must not make
      // an otherwise readable article fail extraction.
    }
  }
  const seenBlocks = new Set<string>();
  const bounded = boundArticleBlocks(blocks.filter((block) => {
    const key = `${block.kind}:${block.text}`;
    if (seenBlocks.has(key)) return false;
    seenBlocks.add(key);
    return true;
  }));
  return {
    images: [...new Set(images)].slice(0, Math.max(0, imageLimit)),
    title,
    blocks: bounded.blocks,
    text: bounded.text,
    extractionWarnings: [...new Set([...extractionWarnings, ...bounded.extractionWarnings])],
    textTruncated: textTruncated || bounded.textTruncated,
  };
};

interface ArticleImageCandidate {
  url?: string;
  caption?: string;
  attribution?: string;
  width?: number;
  height?: number;
  priority: number;
}

export const extractArticleImageCandidates = (html: string, pageUrl: string): ArticleImageCandidate[] => {
  const $ = cheerio.load(html);
  const base = new URL(pageUrl);
  const images: ArticleImageCandidate[] = [];
  $("nav, footer, aside, form, [role='navigation'], [aria-label*='Related'], [class*='related-'], [class*='recommendation'], [class*='author-'], [class*='authorBio'], [class*='byline'], [class*='most-read'], [class*='MostRead']").remove();
  const root = $("article").first().length ? $("article").first() : $("main, [role='main']").first().length ? $("main, [role='main']").first() : $("body");
  // These are typography fragments in an inaccessible animated heading, not article figures.
  root.find('[aria-hidden="true"] [data-letter-index]').remove();
  root.find("img").each((index, element) => {
    const node = $(element);
    const pictureSets = node.closest("picture").find("source").map((_i, source) => $(source).attr("srcset") || $(source).attr("data-srcset") || "").get().join(",");
    let deferredUrl: string | undefined;
    try {
      const loading = JSON.parse(node.attr("data-loading") || "null") as { desktop?: unknown; mobile?: unknown } | null;
      deferredUrl = typeof loading?.desktop === "string" ? loading.desktop
        : typeof loading?.mobile === "string" ? loading.mobile : undefined;
    } catch { /* Treat publisher metadata as data only; malformed JSON falls back to ordinary image attributes. */ }
    const url = [srcFromSet(pictureSets), srcFromSet(node.attr("srcset") || node.attr("data-srcset")),
      deferredUrl, node.attr("data-src"), node.attr("data-original"), node.attr("src")]
      .map((raw) => absoluteUrl(raw, base)).find(Boolean);
    if (!url || imageNoise.test(`${url} ${node.attr("class") ?? ""} ${node.attr("alt") ?? ""}`)) return;
    const width = Number(node.attr("width")) || undefined;
    const height = Number(node.attr("height")) || undefined;
    if (width && height && (width < 320 || height < 120)) return;
    const figure = node.closest("figure");
    images.push({ url, width, height,
      caption: normalizedText(figure.find("figcaption").text() || node.attr("alt") || ""),
      attribution: normalizedText(figure.find(".credit, [class*='credit'], [class*='caption']").text() || ""),
      priority: 120 - Math.min(index, 16),
    });
  });
  return images;
};

export const fetchArticleDocument = (url: URL, options: { fetcher?: typeof fetchRemote; language?: string } = {}) =>
  (options.fetcher ?? fetchRemote)(url, {
    signal: AbortSignal.timeout(18_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      ...(options.language ? { "accept-language": options.language } : {}),
    },
  });

export type ExtractPageOptions = {
  /** Test seam only; production callers use the fail-closed URL validator. */
  validateUrl?: (rawUrl: string | URL) => Promise<URL>;
  /** Test seam only; production callers use the fixed official Qwen index. */
  readQwenArticle?: (rawUrl: string) => Promise<QwenArticleSource | undefined>;
};

export const extractPage = async (
  rawUrl: string,
  imageLimit = 8,
  options: ExtractPageOptions = {},
): Promise<ExtractedPage> => {
  const requestedUrl = await (options.validateUrl ?? validateRemoteUrl)(rawUrl);
  const qwenArticle = await (options.readQwenArticle ?? readQwenArticleSource)(requestedUrl.toString());
  if (qwenArticle) {
    const articleUrl = new URL(qwenArticle.canonicalUrl);
    const page = await extractPageContent(qwenArticle.html, articleUrl, articleUrl, imageLimit);
    return { ...page, url: qwenArticle.canonicalUrl, canonicalUrl: qwenArticle.canonicalUrl,
      title: qwenArticle.title, author: qwenArticle.author, publishedAt: qwenArticle.publishedAt };
  }
  const fetchUrl = new URL(requestedUrl);
  const geminiUpdate = fetchUrl.origin === "https://ai.google.dev" && /^\/gemini-api\/docs\/changelog\/?$/u.test(fetchUrl.pathname);
  if (geminiUpdate) fetchUrl.searchParams.set("hl", "en");
  const response = await fetchArticleDocument(fetchUrl, { language: geminiUpdate ? "en-US,en;q=0.9" : undefined });
  if (!response.ok) throw new Error(`页面读取失败：HTTP ${response.status}`);
  const finalUrl = new URL(response.url || requestedUrl.toString());
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("xml")) {
    throw new Error(`不支持的页面类型：${contentType || "unknown"}`);
  }
  const html = (await readResponseBuffer(response, 4_000_000)).toString("utf8");
  return extractPageContent(html, finalUrl, requestedUrl, imageLimit);
};

/** Parse a fetched page; official history pages must resolve to one dated event. */
export const extractPageContent = async (content: string, finalUrl: URL, requestedUrl = finalUrl, imageLimit = 8): Promise<ExtractedPage> => {
  if (hasOfficialUpdateAnchor(requestedUrl)
    && (requestedUrl.origin !== finalUrl.origin || requestedUrl.pathname.replace(/\/$/u, "") !== finalUrl.pathname.replace(/\/$/u, ""))) {
    throw new Error("官方更新永久链接重定向到其他页面，无法确认事件正文");
  }
  const section = extractOfficialUpdateSection(content, requestedUrl.toString());
  const html = section ? `<article>${section.html}</article>` : content;
  const $ = cheerio.load(html);
  const canonicalUrl = section ? requestedUrl.toString() :
    absoluteUrl($("link[rel='canonical']").attr("href"), finalUrl) ?? finalUrl.toString();
  let title = section?.title ?? normalizedText(
    $("meta[property='og:title']").attr("content") || $("title").text() || "",
  );
  const publishedValue =
    $("meta[property='article:published_time']").attr("content")
    || $("meta[name='date']").attr("content")
    || $("meta[name='pub_date']").attr("content")
    || $("time[datetime]").first().attr("datetime");
  const publishedDate = publishedValue ? new Date(publishedValue) : undefined;
  const publishedAt = section?.publishedAt ?? (publishedDate && Number.isFinite(publishedDate.getTime())
    ? publishedDate.toISOString()
    : undefined);

  const moduleUrls = $("script[type='module'][src]")
    .map((_index, element) => absoluteUrl($(element).attr("src"), finalUrl))
    .get()
    .filter((value): value is string => Boolean(value))
    .filter((value) => new URL(value).origin === finalUrl.origin);

  const structure = extractArticleStructure(html, canonicalUrl);
  let blocks = structure.blocks;
  let text = structure.text;
  let textTruncated = structure.textTruncated;
  const extractionWarnings = [...structure.extractionWarnings];

  const imageCandidates: ArticleImageCandidate[] = [];

  const pushMeta = (selector: string, priority: number) => {
    const url = absoluteUrl($(selector).attr("content"), finalUrl);
    if (url) imageCandidates.push({ url, priority });
  };
  pushMeta("meta[property='og:image']", 100);
  pushMeta("meta[name='twitter:image']", 90);

  const articleImages = extractArticleImageCandidates(html, finalUrl.toString());
  const articleImageCount = articleImages.length;
  imageCandidates.push(...articleImages);

  if (moduleUrls.length && (articleImageCount === 0 || blocks.length === 0 || text.length < 80 || !title)) {
    const moduleFallback = await moduleFallbackForClientShell(moduleUrls, finalUrl, imageLimit);
    title ||= moduleFallback.title || "";
    if (text.length < 80 && moduleFallback.blocks.length) {
      blocks = moduleFallback.blocks;
      text = moduleFallback.text;
      textTruncated ||= moduleFallback.textTruncated;
      extractionWarnings.push(...moduleFallback.extractionWarnings);
      extractionWarnings.push("正文通过客户端模块的有限结构提取恢复，未解析的动态内容仍需核对。");
    }
    moduleFallback.images.forEach((url, index) => {
      imageCandidates.push({
        url,
        caption: `原文图表 ${index + 1}`,
        attribution: finalUrl.hostname,
        priority: 80 - Math.min(index, 30),
      });
    });
  }

  const seen = new Set<string>();
  const images = imageCandidates
    .sort((left, right) => right.priority - left.priority)
    .filter((image) => {
      if (!image.url || seen.has(image.url)) return false;
      seen.add(image.url);
      return true;
    })
    .slice(0, imageLimit)
    .map<SourceImage>((image, index) => ({
      id: createHash("sha1").update(image.url ?? `${index}`).digest("hex").slice(0, 12),
      url: image.url!,
      caption: image.caption || (index === 0 ? title : "来源页面配图"),
      attribution: image.attribution || new URL(canonicalUrl).hostname,
      sourceUrl: canonicalUrl,
      width: image.width,
      height: image.height,
      selected: index < 3,
      rights: "check-required",
    }));

  return { url: section ? requestedUrl.toString() : finalUrl.toString(), canonicalUrl, title, publishedAt, text, blocks, images,
    extractionWarnings, textTruncated };
};

export const downloadSourceImage = async (
  image: SourceImage,
  draftId: string,
  options: { mediaRoot?: string } = {},
) => {
  const response = await fetchRemote(image.url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AI-News-Desk/0.1",
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
      referer: image.sourceUrl,
    },
  });
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (contentType && !contentType.startsWith("image/") && contentType !== "application/octet-stream") {
    throw new Error("来源地址没有返回图片");
  }
  let bytes = await readResponseBuffer(response, 8 * 1024 * 1024);
  // Several publisher CDNs serve genuine raster files as octet-stream. Trust
  // a bounded decoder, never a URL extension or a permissive response header.
  const decoder = sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" });
  const metadata = await decoder.metadata();
  if (!metadata.width || !metadata.height || !["jpeg", "png", "webp", "gif", "heif"].includes(metadata.format ?? "")) {
    throw new Error("来源文件不是支持的位图图片");
  }
  await decoder.clone().resize(1, 1).toBuffer();
  const converted = metadata.format === "heif";
  if (converted) bytes = await decoder.clone().png().toBuffer();
  const extension = converted ? ".png" : metadata.format === "jpeg" ? ".jpg" : `.${metadata.format}`;
  const targetDirectory = path.join(options.mediaRoot ?? workflowMediaRoot, draftId);
  await mkdir(targetDirectory, { recursive: true });
  const fileName = `${image.id}${extension}`;
  const localPath = path.join(targetDirectory, fileName);
  await writeFile(localPath, bytes);
  return {
    ...image,
    width: metadata.width,
    height: metadata.height,
    ...(converted ? { modificationNote: [image.modificationNote, "将原始 AVIF/HEIF 位图转换为 PNG 以兼容编辑与交付"].filter(Boolean).join("；") } : {}),
    localPath,
    publicPath: `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`,
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
  } satisfies SourceImage;
};
