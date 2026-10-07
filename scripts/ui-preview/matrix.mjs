// Complete legacy CSS visual matrix, using the shared shot.mjs capture function.
// Only fixture.ts in-memory examples are served; no production proxy or database.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import sharp from "sharp";
import { capturePreview } from "./shot.mjs";

const [destination, baseline] = process.argv.slice(2);
if (!destination) throw new Error("matrix.mjs <output directory> [before directory]");
await mkdir(destination, { recursive: true });
const instant = "2026-10-07T12:00:00.000Z";
const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], { env: { ...process.env, AI_NEWS_DESK_PREVIEW_MATRIX: "1", AI_NEWS_DESK_PREVIEW_TIME: instant }, stdio: ["ignore", "pipe", "pipe"] });
let output = "";
const origin = await new Promise((resolve, reject) => {
  child.stdout.on("data", chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) resolve(match[0]); });
  child.stderr.on("data", chunk => { output += chunk; });
  child.once("exit", code => reject(new Error(`Fixture exited ${code}: ${output}`)));
});
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu", "--force-color-profile=srgb"] });
const pages = ["today", "aggregations", "community", "workbench", "drafts", "sources", "editorial-system", "runs", "schedule", "ai-settings"];
const cases = pages.map(hash => ({ name: hash, hash }));
cases.push(
  { name: "reader", hash: "today", action: async page => { await page.getByRole("button", { name: /^查看 隔离示例：Acme/ }).first().click(); await page.getByRole("dialog").waitFor(); } },
  ...["编辑", "对照", "预览"].map((mode, index) => ({ name: `draft-mode-${index}`, hash: "drafts", action: async page => { await page.getByTestId("draft-editor").waitFor(); await page.locator(".draft-view-switch").getByRole("button", { name: mode, exact: true }).click(); } })),
  { name: "notifications", hash: "today", action: async page => { if (await page.getByRole("button", { name: "更多功能", exact: true }).isVisible()) await page.getByRole("button", { name: "更多功能", exact: true }).click(); await page.getByRole("button", { name: /^打开通知中心/ }).last().click(); await page.getByRole("dialog", { name: "工作流动态" }).waitFor(); } },
  ...["模型与分工", "Skill 库", "图片素材库"].map((tab, index) => ({ name: `ai-tab-${index}`, hash: "ai-settings", action: page => page.getByRole("tab", { name: tab, exact: true }).click() })),
  ...["采集计划", "平台连接", "数据与迁移"].map((tab, index) => ({ name: `automation-tab-${index}`, hash: "schedule", action: page => page.getByRole("tab", { name: tab, exact: true }).click() })),
  ...["微信公众号", "知乎与百家号", "小黑盒"].map((platform, index) => ({ name: `platform-tab-${index}`, hash: "schedule", action: async page => { await page.getByRole("tab", { name: "平台连接", exact: true }).click(); await page.getByRole("navigation", { name: "选择连接平台" }).getByRole("button", { name: new RegExp(`^${platform}`) }).click(); } })),
);
const measurements = [];
try {
  for (const width of [1440, 390]) {
    for (const item of cases) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce", locale: "zh-CN", timezoneId: "Asia/Shanghai" });
      await context.addInitScript(value => { const NativeDate = Date; class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [value])); } static now() { return NativeDate.parse(value); } } globalThis.Date = FixedDate; }, instant);
      const page = await context.newPage();
      const errors = [];
      page.on("response", response => { if (response.status() >= 400) console.log(`http ${response.status()}: ${response.url()}`); });
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      // No external origin can be read, including an accidental platform request.
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(`${origin}/#${item.hash}`, { waitUntil: "networkidle" });
      console.log(`capture ${item.name}-${width}`);
      await page.locator(".page, .aggregation-page").first().waitFor();
      if (item.action) await item.action(page);
      await page.waitForTimeout(100);
      const name = `${item.name}-${width}.png`;
      const overflow = await capturePreview(page, path.join(destination, name), true);
      assert.deepEqual(errors, [], `${name}: ${errors.join(" | ")}`);
      if (baseline) {
        const before = await sharp(await readFile(path.join(baseline, name))).raw().toBuffer({ resolveWithObject: true });
        const after = await sharp(await readFile(path.join(destination, name))).raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual(after.info, before.info, `${name}: dimensions changed`);
        assert.equal(Buffer.compare(after.data, before.data), 0, `${name}: pixels changed`);
      }
      measurements.push({ name, overflow, consoleErrors: errors.length, pixelDifference: baseline ? 0 : undefined });
      await context.close();
    }
  }
  await writeFile(path.join(destination, "matrix.json"), JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify({ screenshots: measurements.length, compared: baseline ? measurements.length : 0, pixelDifferences: baseline ? 0 : undefined, consoleErrors: 0, measurements }));
} finally {
  await browser.close(); child.kill("SIGTERM");
}
