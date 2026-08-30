import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as cheerio from "cheerio";
import { fetchRemote, readResponseBuffer, validateRemoteUrl } from "./remote-url.js";
import { workflowMediaRoot } from "./storage.js";
import type { ExtractedPage, SourceImage } from "./types.js";

const imageNoise = /logo|icon|avatar|emoji|tracking|pixel|spinner|loading|sprite|favicon|author|profile|badge|button/i;

const absoluteUrl = (raw: string | undefined, base: URL) => {
  if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) return undefined;
  try {
    return new URL(raw, base).toString();
  } catch {
    return undefined;
  }
};

const srcFromSet = (srcset?: string) => {
  if (!srcset) return undefined;
  const candidates = srcset
    .split(",")
    .map((entry) => entry.trim().split(/\s+/)[0])
    .filter(Boolean);
  return candidates.at(-1);
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
      text: text.slice(0, 8_000),
    });
  }
  const renderSource = source.slice(Math.max(0, source.lastIndexOf("createRoot")));
  const titleMatch = renderSource.match(/\btitle\s*:\s*`((?:\\.|[^`]){2,240})`/u);
  const title = titleMatch ? normalizedText(decodeModuleText(titleMatch[1]!)) : undefined;
  return { title, blocks: blocks.slice(0, 120) };
};

const moduleFallbackForClientShell = async (
  moduleUrls: string[],
  pageUrl: URL,
  imageLimit: number,
) => {
  const images: string[] = [];
  const blocks: NonNullable<ExtractedPage["blocks"]> = [];
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
      if (images.length >= imageLimit && blocks.length >= 3 && title) break;
    } catch {
      // Module probing is a best-effort fallback. A failed asset must not make
      // an otherwise readable article fail extraction.
    }
  }
  const seenBlocks = new Set<string>();
  return {
    images: [...new Set(images)].slice(0, Math.max(0, imageLimit)),
    title,
    blocks: blocks.filter((block) => {
      const key = `${block.kind}:${block.text}`;
      if (seenBlocks.has(key)) return false;
      seenBlocks.add(key);
      return true;
    }).slice(0, 120),
  };
};

export const extractPage = async (rawUrl: string, imageLimit = 8): Promise<ExtractedPage> => {
  const requestedUrl = await validateRemoteUrl(rawUrl);
  const response = await fetchRemote(requestedUrl, {
    signal: AbortSignal.timeout(18_000),
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 AI-News-Desk/0.1",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) throw new Error(`页面读取失败：HTTP ${response.status}`);
  const finalUrl = new URL(response.url || requestedUrl.toString());
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("xml")) {
    throw new Error(`不支持的页面类型：${contentType || "unknown"}`);
  }
  const html = (await readResponseBuffer(response, 4_000_000)).toString("utf8");
  const $ = cheerio.load(html);
  const canonicalUrl =
    absoluteUrl($("link[rel='canonical']").attr("href"), finalUrl) ?? finalUrl.toString();
  let title = normalizedText(
    $("meta[property='og:title']").attr("content") || $("title").text() || "",
  );
  const publishedValue =
    $("meta[property='article:published_time']").attr("content")
    || $("meta[name='date']").attr("content")
    || $("meta[name='pub_date']").attr("content")
    || $("time[datetime]").first().attr("datetime");
  const publishedDate = publishedValue ? new Date(publishedValue) : undefined;
  const publishedAt = publishedDate && Number.isFinite(publishedDate.getTime())
    ? publishedDate.toISOString()
    : undefined;

  const moduleUrls = $("script[type='module'][src]")
    .map((_index, element) => absoluteUrl($(element).attr("src"), finalUrl))
    .get()
    .filter((value): value is string => Boolean(value))
    .filter((value) => new URL(value).origin === finalUrl.origin);

  $("script, style, nav, footer, aside, form, noscript, svg").remove();
  const articleRoot = $("article").first().length
    ? $("article").first()
    : $("main").first().length
      ? $("main").first()
      : $("body");
  const blocks: NonNullable<ExtractedPage["blocks"]> = [];
  articleRoot.find("h2, h3, p, blockquote, li").each((_index, element) => {
    const node = $(element);
    const tagName = element.tagName?.toLowerCase();
    // A paragraph inside a quote/list item is already represented by its
    // parent block. Keeping both would duplicate source text in verbatim mode.
    if (tagName === "p" && node.parents("blockquote, li").length) return;
    if (tagName === "li" && node.parents("li").length) return;
    const blockText = normalizedText(node.text());
    if (blockText.length < 2 || blocks.at(-1)?.text === blockText) return;
    blocks.push({
      kind: tagName === "h2" || tagName === "h3"
        ? "heading"
        : tagName === "blockquote"
          ? "quote"
          : tagName === "li"
            ? "list-item"
            : "paragraph",
      text: blockText.slice(0, 8_000),
    });
  });
  let text = normalizedText(articleRoot.text()).slice(0, 30_000);

  const imageCandidates: Array<{
    url?: string;
    caption?: string;
    attribution?: string;
    width?: number;
    height?: number;
    priority: number;
  }> = [];

  const pushMeta = (selector: string, priority: number) => {
    const url = absoluteUrl($(selector).attr("content"), finalUrl);
    if (url) imageCandidates.push({ url, priority });
  };
  pushMeta("meta[property='og:image']", 100);
  pushMeta("meta[name='twitter:image']", 90);

  let articleImageCount = 0;
  $("article figure img, main figure img, article img, main img").each((index, element) => {
    const node = $(element);
    const raw =
      srcFromSet(node.attr("srcset") || node.attr("data-srcset")) ||
      node.attr("src") ||
      node.attr("data-src") ||
      node.attr("data-original");
    const url = absoluteUrl(raw, finalUrl);
    if (!url || imageNoise.test(`${url} ${node.attr("class") ?? ""} ${node.attr("alt") ?? ""}`)) return;
    const width = Number(node.attr("width")) || undefined;
    const height = Number(node.attr("height")) || undefined;
    if (width && height && (width < 320 || height < 180)) return;
    const figure = node.closest("figure");
    const caption = normalizedText(figure.find("figcaption").text() || node.attr("alt") || "");
    const attribution = normalizedText(
      figure.find(".credit, [class*='credit'], [class*='caption']").text() || "",
    );
    imageCandidates.push({
      url,
      caption,
      attribution,
      width,
      height,
      priority: 70 - Math.min(index, 30),
    });
    articleImageCount += 1;
  });

  if (moduleUrls.length && (articleImageCount === 0 || blocks.length === 0 || text.length < 80 || !title)) {
    const moduleFallback = await moduleFallbackForClientShell(moduleUrls, finalUrl, imageLimit);
    title ||= moduleFallback.title || "";
    if (!blocks.length && moduleFallback.blocks.length) blocks.push(...moduleFallback.blocks);
    if (text.length < 80 && moduleFallback.blocks.length) {
      text = normalizedText(moduleFallback.blocks.map((block) => block.text).join(" ")).slice(0, 30_000);
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

  return { url: finalUrl.toString(), canonicalUrl, title, publishedAt, text, blocks, images };
};

const extensionFor = (contentType: string, url: string) => {
  if (contentType.includes("png")) return ".png";
  if (contentType.includes("webp")) return ".webp";
  if (contentType.includes("gif")) return ".gif";
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return ".jpg";
  const extension = path.extname(new URL(url).pathname).toLowerCase();
  return [".png", ".webp", ".gif", ".jpg", ".jpeg"].includes(extension)
    ? extension
    : ".jpg";
};

export const downloadSourceImage = async (image: SourceImage, draftId: string) => {
  const response = await fetchRemote(image.url, {
    signal: AbortSignal.timeout(20_000),
    headers: {
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AI-News-Desk/0.1",
      accept: "image/avif,image/webp,image/png,image/jpeg,image/*",
      referer: image.sourceUrl,
    },
  });
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) throw new Error("来源地址没有返回图片");
  const bytes = await readResponseBuffer(response, 8 * 1024 * 1024);
  const targetDirectory = path.join(workflowMediaRoot, draftId);
  await mkdir(targetDirectory, { recursive: true });
  const extension = extensionFor(contentType, response.url || image.url);
  const fileName = `${image.id}${extension}`;
  const localPath = path.join(targetDirectory, fileName);
  await writeFile(localPath, bytes);
  return {
    ...image,
    localPath,
    publicPath: `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`,
  } satisfies SourceImage;
};
