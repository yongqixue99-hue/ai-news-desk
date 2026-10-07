// C4 before/manual/cached screenshots. Every item and model is fictional.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { capturePreview } from "./shot.mjs";

const destination = process.argv[2], instant = "2026-10-07T12:00:00.000Z";
if (!destination || !process.env.AI_NEWS_DESK_PREVIEW_BEFORE_DIST) throw new Error("aggregation-titles.mjs <output directory>, with BEFORE_DIST");
await mkdir(destination, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true }), measurements = [];
try {
  for (const width of [1440, 390]) {
    const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], { env: { ...process.env, AI_NEWS_DESK_PREVIEW_TRANSLATIONS: "1", AI_NEWS_DESK_PREVIEW_TIME: instant }, stdio: ["ignore", "pipe", "pipe"] });
    let output = "", context;
    try {
      const origin = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error(output || "Fixture did not start")), 15000); child.stdout.on("data", chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timer); resolve(match[0]); } }); child.stderr.on("data", chunk => { output += chunk; }); child.once("exit", code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${output}`)); }); });
      context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce", locale: "zh-CN", timezoneId: "Asia/Shanghai" });
      await context.addInitScript(value => { const NativeDate = Date; class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [value])); } static now() { return NativeDate.parse(value); } } globalThis.Date = FixedDate; }, instant);
      const page = await context.newPage(), errors = [], writes = [];
      page.on("pageerror", error => errors.push(String(error))); page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) { assert.ok(request.url().endsWith("/api/aggregations/title-translations")); writes.push(request.postDataJSON().items); } });
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      const original = await (await page.request.get(origin + "/api/aggregations")).json(), raw = JSON.stringify(original);
      for (const version of ["before", "manual-ready"]) {
        await page.goto(`${origin}/${version === "before" ? "__before/" : ""}#aggregations`, { waitUntil: "networkidle" }); await page.locator(".aggregation-row").first().waitFor(); await page.waitForTimeout(500);
        assert.equal(await capturePreview(page, path.join(destination, `${version}-${width}.png`)), 0);
        assert.equal(await page.locator(".aggregation-row").count(), 40); assert.equal((await (await page.request.get(origin + "/api/preview/title-translation-metrics")).json()).calls, 0); assert.deepEqual(writes, []);
      }
      await page.getByRole("button", { name: "翻译本页标题", exact: true }).click(); await page.locator(".aggregation-machine-label").first().waitFor(); await page.waitForTimeout(500);
      assert.equal(await capturePreview(page, path.join(destination, `after-${width}.png`)), 0);
      assert.equal(await page.locator(".aggregation-machine-label").count(), 20); assert.equal(writes[0].length, 20);
      assert.match(await page.locator(".aggregation-original-title").first().innerText(), /Example model 0/u);
      await page.reload({ waitUntil: "networkidle" }); await page.locator(".aggregation-machine-label").first().waitFor(); await page.waitForTimeout(300);
      assert.equal(await capturePreview(page, path.join(destination, `cached-${width}.png`)), 0);
      const stats = await (await page.request.get(origin + "/api/preview/title-translation-metrics")).json();
      assert.equal(stats.calls, 1); assert.equal(new Set(stats.keys).size, 20); assert.equal(writes.length, 1);
      const after = JSON.stringify(await (await page.request.get(origin + "/api/aggregations")).json()); assert.equal(after, raw); assert.deepEqual(errors, []);
      measurements.push({ width, height: width === 390 ? 844 : 900, visible: 40, originalEnglish: 60, translated: 20, cacheAfterReload: 20, browsingModelCalls: 0, manualModelCalls: stats.calls, modelCallsAfterReload: stats.calls, manualBatchSizes: writes.map(batch => batch.length), originalViewSHA256: createHash("sha256").update(raw).digest("hex"), afterViewSHA256: createHash("sha256").update(after).digest("hex"), overflow: 0, consoleErrors: 0, realModelCalls: 0 });
    } finally { if (context) await context.close(); child.kill("SIGTERM"); child.stdout.destroy(); child.stderr.destroy(); }
  }
  await writeFile(path.join(destination, "measurements.json"), JSON.stringify({ fixture: "70 fictional entries, fake provider, in-memory cache; no database or outbound requests", instant, measurements }, null, 2) + "\n"); console.log(JSON.stringify(measurements));
} finally { await browser.close(); }
