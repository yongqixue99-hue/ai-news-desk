import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
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

const screenshotNoise = /logo|icon|avatar|emoji|tracking|pixel|spinner|loading|sprite|favicon|author|profile|badge|button|advert|banner/i;

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
  const id = `page_shot_${createHash("sha1")
    .update(`${sourceUrl}:${index}:${bytes.byteLength}`)
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
    selected: true,
    rights: "editorial-screenshot",
    evidenceNote: "自动渲染来源网页所得的评论性截图；发布前需确认引用范围并保留来源。",
    evidencePath: localPath,
  } satisfies SourceImage;
};

/**
 * Renders a source page only when direct image extraction was insufficient.
 * Prefer screenshots of meaningful article images; fall back to one visible
 * article viewport so a private draft never silently becomes text-only.
 */
export const captureRenderedPageImages = async (
  rawUrl: string,
  draftId: string,
  requestedLimit = 3,
): Promise<SourceImage[]> => {
  const sourceUrl = (await validateRemoteUrl(rawUrl)).toString();
  const limit = Math.max(0, Math.min(4, Math.floor(requestedLimit)));
  if (!limit) return [];
  const browser = await chromium.launch({
    executablePath: await browserExecutable(),
    headless: true,
    args: ["--disable-dev-shm-usage", "--disable-background-networking"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
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
    await page.waitForTimeout(800);
    const scrollHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    for (let offset = 0; offset < Math.min(scrollHeight, 5_000); offset += 900) {
      await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), offset);
      await page.waitForTimeout(180);
    }
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

    const locator = page.locator("article img, main img, [role='main'] img, body img");
    const count = Math.min(80, await locator.count());
    const images: SourceImage[] = [];
    for (let index = 0; index < count && images.length < limit; index += 1) {
      const image = locator.nth(index);
      if (!await image.isVisible().catch(() => false)) continue;
      const metadata = await image.evaluate((element) => ({
        alt: element.getAttribute("alt") || "",
        src: element.getAttribute("currentSrc") || element.getAttribute("src") || "",
        className: element.getAttribute("class") || "",
      })).catch(() => ({ alt: "", src: "", className: "" }));
      if (screenshotNoise.test(`${metadata.alt} ${metadata.src} ${metadata.className}`)) continue;
      const box = await image.boundingBox();
      if (!box || box.width < 320 || box.height < 180) continue;
      await image.scrollIntoViewIfNeeded().catch(() => undefined);
      await page.waitForTimeout(120);
      const bytes = await image.screenshot({ type: "png", animations: "disabled" }).catch(() => undefined);
      if (!bytes || bytes.byteLength < 4_000) continue;
      const caption = metadata.alt.trim().slice(0, 180) || `来源网页截图 ${images.length + 1}`;
      images.push(await saveScreenshot(
        bytes,
        draftId,
        images.length,
        finalUrl,
        caption,
        Math.round(box.width),
        Math.round(box.height),
      ));
    }

    if (!images.length) {
      await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
      const article = page.locator("article, main, [role='main']").first();
      if (await article.count()) {
        const box = await article.boundingBox().catch(() => undefined);
        if (box) await page.evaluate((top) => window.scrollTo({ top, behavior: "instant" }), Math.max(0, box.y));
      }
      await page.waitForTimeout(150);
      const bytes = await page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
      images.push(await saveScreenshot(
        bytes,
        draftId,
        0,
        finalUrl,
        "来源网页首屏截图",
        1440,
        960,
      ));
    }
    return images;
  } finally {
    await context.close().catch(() => undefined);
    await browser.close().catch(() => undefined);
  }
};
