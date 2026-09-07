import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { validateRemoteUrl } from "./remote-url.js";
import { workflowMediaRoot } from "./storage.js";
import type { SourceImage } from "./types.js";

const browserCandidates = process.platform === "darwin"
  ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
  ]
  : process.platform === "win32"
    ? [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    ]
    : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];

const browserExecutable = async () => {
  for (const candidate of browserCandidates) {
    if (await access(candidate).then(() => true).catch(() => false)) return candidate;
  }
  throw new Error("没有找到可用于网页截图的 Chrome/Chromium");
};

const safeOriginGuard = () => {
  const results = new Map<string, Promise<boolean>>();
  return async (rawUrl: string) => {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return false;
    }
    if (["data:", "blob:"].includes(url.protocol)) return true;
    if (!["http:", "https:"].includes(url.protocol)) return false;
    const key = url.origin;
    const pending = results.get(key) ?? validateRemoteUrl(url)
      .then(() => true)
      .catch(() => false);
    results.set(key, pending);
    return pending;
  };
};

export interface RenderedPageText {
  title?: string;
  url: string;
  text: string;
}

/**
 * Browser-rendered text is an on-demand fallback for publishers that reject
 * the bounded HTTP extractor. It is never used for bulk collection. Requests
 * remain behind the same public-network guard as rendered screenshots.
 */
export const extractRenderedPageText = async (
  rawUrl: string,
  maxLength = 12_000,
): Promise<RenderedPageText> => {
  const sourceUrl = (await validateRemoteUrl(rawUrl)).toString();
  const browser = await chromium.launch({
    executablePath: await browserExecutable(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-background-networking"],
  });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 1,
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const safeOrigin = safeOriginGuard();
  await page.route("**/*", async (route) => {
    if (await safeOrigin(route.request().url())) await route.continue();
    else await route.abort("blockedbyclient");
  });

  try {
    await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const finalUrl = (await validateRemoteUrl(page.url())).toString();
    await page.waitForTimeout(1_000);
    const result = await page.evaluate((limit) => {
      const root = document.querySelector("article, main, [role='main']") || document.body;
      const clone = root.cloneNode(true) as HTMLElement;
      clone.querySelectorAll([
        "script",
        "style",
        "nav",
        "footer",
        "aside",
        "form",
        "noscript",
        "svg",
        "button",
        "[role='navigation']",
        "[aria-hidden='true']",
      ].join(",")).forEach((element) => element.remove());
      const text = (clone.innerText || clone.textContent || "")
        .replace(/\u00a0/gu, " ")
        .replace(/[ \t]+/gu, " ")
        .replace(/\n{3,}/gu, "\n\n")
        .trim()
        .slice(0, limit);
      const title = (document.querySelector("h1")?.textContent || document.title || "")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 240);
      return { text, title: title || undefined };
    }, Math.max(500, Math.min(30_000, Math.floor(maxLength))));
    if (result.text.length < 80) throw new Error("渲染后的页面没有足够正文内容");
    return { ...result, url: finalUrl };
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};

const saveScreenshot = async (
  bytes: Buffer,
  draftId: string,
  index: number,
  sourceUrl: string,
  caption: string,
  width?: number,
  height?: number,
) => {
  const targetDirectory = path.join(workflowMediaRoot, draftId);
  await mkdir(targetDirectory, { recursive: true });
  const id = `page_shot_${createHash("sha256")
    .update(sourceUrl).update(bytes)
    .digest("hex")
    .slice(0, 12)}`;
  const fileName = `${id}.png`;
  const localPath = path.join(targetDirectory, fileName);
  const publicPath = `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`;
  await writeFile(localPath, bytes);
  return {
    id,
    url: publicPath,
    localPath,
    publicPath,
    caption,
    attribution: new URL(sourceUrl).hostname,
    sourceUrl,
    width,
    height,
    selected: index < 3,
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
    editorialPriority: 2,
    editorialOrigin: "article-screenshot",
    rights: "editorial-screenshot",
    evidenceNote: "自动渲染来源网页所得的评论性截图；发布前需确认引用范围并保留来源。",
    evidencePath: localPath,
  } satisfies SourceImage;
};

interface RenderedArticleFigure {
  bytes: Buffer;
  caption: string;
  kind: "image" | "chart" | "table";
  originalImageUrl?: string;
  width: number;
  height: number;
}

/** Crop the figure, including its legend/caption. Pure page seam for browser
 * regression tests; navigation and public-network validation stay with callers. */
export const captureArticleFigures = async (page: Page, options: { limit: number; chartsOnly?: boolean }): Promise<RenderedArticleFigure[]> => {
  const targets = await page.evaluate(({ chartsOnly }) => {
    const root = document.querySelector("article") || document.querySelector("main, [role='main']") || document.body;
    const seen = new Set<Element>();
    const results: Array<{ key: string; caption: string; kind: "image" | "chart" | "table"; originalImageUrl?: string }> = [];
    const noise = /logo|icon|avatar|emoji|tracking|spinner|sprite|favicon|badge|advert/i;
    for (const element of [...root.querySelectorAll("figure, table, svg, canvas, img, [data-chart], [role='img']")].slice(0, 240)) {
      if (element.closest("nav, footer, aside, [role='navigation'], [aria-label*='Related'], [class*='related-'], [class*='recommendation']")) continue;
      const target = element.closest("figure") || element;
      if (seen.has(target)) continue;
      const table = target.matches("table") || Boolean(target.querySelector("table"));
      const box = target.getBoundingClientRect();
      const chart = (target.matches("svg,canvas,[data-chart],[role='img']:not(img)") && box.width >= 320 && box.height >= 120)
        || [...target.querySelectorAll("svg,canvas,[data-chart]")].some((node) => { const rect = node.getBoundingClientRect(); return rect.width >= 320 && rect.height >= 120; });
      const img = target.matches("img") ? target as HTMLImageElement : target.querySelector("img");
      if (!table && !chart && (!img || chartsOnly)) continue;
      if (box.width < 320 || box.height < 120 || box.height > 2_400 || getComputedStyle(target).visibility === "hidden" || getComputedStyle(target).display === "none") continue;
      const alt = img?.alt || "";
      const src = img?.currentSrc || img?.src || "";
      if (!table && !chart && noise.test(`${alt} ${src} ${target.getAttribute("class") || ""}`)) continue;
      seen.add(target);
      const key = `figure-${results.length}`;
      target.setAttribute("data-desk-figure", key);
      const caption = (target.querySelector("figcaption, caption")?.textContent
        || target.getAttribute("aria-label") || img?.alt || target.querySelector("h2,h3,h4,svg title")?.textContent
        || (table ? "原文评测表格" : chart ? "原文能力图表" : "原文配图"))
        .replace(/\s+/g, " ").trim().slice(0, 240);
      results.push({ key, caption, kind: table ? "table" : chart ? "chart" : "image", originalImageUrl: /^https?:/.test(src) ? src : undefined });
    }
    return results;
  }, { chartsOnly: options.chartsOnly });
  const figures: RenderedArticleFigure[] = [];
  for (const target of targets) {
    if (figures.length >= Math.max(0, Math.min(12, options.limit))) break;
    const region = page.locator(`[data-desk-figure="${target.key}"]`);
    try {
      await region.scrollIntoViewIfNeeded({ timeout: 3_000 });
      await page.waitForTimeout(120);
      const bytes = await region.screenshot({ type: "png", animations: "disabled", timeout: 5_000 });
      if (bytes.length < 500) continue;
      figures.push({ ...target, bytes, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) });
    } catch { /* One lazy/removed figure must not discard the rest of the article. */ }
  }
  return figures;
};

/**
 * Renders real article figures and benchmark tables. A blocked/empty page
 * returns no material; a site header or challenge screen is never a source image.
 */
export const captureRenderedPageImages = async (
  rawUrl: string,
  draftId: string,
  requestedLimit = 3,
  options: { chartsOnly?: boolean } = {},
): Promise<SourceImage[]> => {
  const sourceUrl = (await validateRemoteUrl(rawUrl)).toString();
  const limit = Math.max(0, Math.min(12, Math.floor(requestedLimit)));
  if (!limit) return [];
  const browser = await chromium.launch({
    executablePath: await browserExecutable(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-background-networking"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1.5,
    javaScriptEnabled: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  const safeOrigin = safeOriginGuard();
  await page.route("**/*", async (route) => {
    if (await safeOrigin(route.request().url())) await route.continue();
    else await route.abort("blockedbyclient");
  });

  try {
    const response = await page.goto(sourceUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    if (!response?.ok()) throw new Error(`来源网页截图失败：HTTP ${response?.status() ?? "unknown"}`);
    const finalUrl = (await validateRemoteUrl(page.url())).toString();
    await page.waitForTimeout(800);
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let offset = 0; offset < Math.min(scrollHeight, 5_000); offset += 900) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), offset);
      await page.waitForTimeout(180);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

    const figures = await captureArticleFigures(page, { limit, ...options });
    const images: SourceImage[] = [];
    for (const figure of figures) {
      const image = await saveScreenshot(figure.bytes, draftId, images.length, finalUrl, figure.caption, figure.width, figure.height);
      images.push({ ...image, captureKind: figure.kind, originalImageUrl: figure.originalImageUrl });
    }
    return images;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};
