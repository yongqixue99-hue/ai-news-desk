// Full-resolution screenshot of one page of the read-only preview.
// Usage: node scripts/ui-preview/shot.mjs <page-hash> <name> [width] [height] [full] [script-to-run-before-capture]
// Output: .artifacts/ui-preview/shots/<name>.png (ignored by Git; these show local data).
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const [hash, name, width = "1440", height = "900", full = "", script = ""] = process.argv.slice(2);
if (!hash || !name) { console.error("usage: shot.mjs <page-hash> <name> [width] [height] [full] [script]"); process.exit(1); }
const origin = process.env.AI_NEWS_DESK_PREVIEW_ORIGIN || "http://127.0.0.1:4399";
const shots = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.artifacts/ui-preview/shots");
await mkdir(shots, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) }, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (message) => { if (message.type() === "error") errors.push(message.text().slice(0, 200)); });
page.on("pageerror", (error) => errors.push(String(error).slice(0, 200)));
await page.goto(`${origin}/#${hash}`, { waitUntil: "networkidle", timeout: 30_000 }).catch(() => {});
await page.waitForTimeout(1_200);
if (script) { await page.evaluate(script).catch((error) => errors.push(`script: ${error}`)); await page.waitForTimeout(900); }
await page.screenshot({ path: path.join(shots, `${name}.png`), fullPage: full === "full" });
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
console.log(name, "horizontal overflow", overflow, errors.length ? `errors: ${errors.join(" | ")}` : "no console errors");
await browser.close();
