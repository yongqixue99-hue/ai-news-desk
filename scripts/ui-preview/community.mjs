// Paired C3 screenshots: synthetic memory only, all external requests blocked.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { capturePreview } from "./shot.mjs";

const destination = process.argv[2];
if (!destination || !process.env.AI_NEWS_DESK_PREVIEW_BEFORE_DIST) throw new Error("community.mjs <output directory>, with BEFORE_DIST");
await mkdir(destination, { recursive: true });
const instant = "2026-10-07T12:00:00.000Z";
const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], {
  env: { ...process.env, AI_NEWS_DESK_PREVIEW_COMMUNITY: "1", AI_NEWS_DESK_PREVIEW_TIME: instant }, stdio: ["ignore", "pipe", "pipe"],
});
let output = "", browser;
try {
  const origin = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(output || "Fixture did not start")), 15000);
    child.stdout.on("data", chunk => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timer); resolve(match[0]); } });
    child.stderr.on("data", chunk => { output += chunk; });
    child.once("exit", code => { clearTimeout(timer); reject(new Error(`Fixture exited ${code}: ${output}`)); });
  });
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const measurements = [];
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 900 }, reducedMotion: "reduce", locale: "zh-CN", timezoneId: "Asia/Shanghai" });
    await context.addInitScript(value => { const NativeDate = Date; class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [value])); } static now() { return NativeDate.parse(value); } } globalThis.Date = FixedDate; }, instant);
    const page = await context.newPage(), errors = [], writes = [];
    page.on("pageerror", error => errors.push(String(error)));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url()); });
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    for (const version of ["before", "after"]) {
      await page.goto(`${origin}/${version === "before" ? "__before/" : ""}#community`, { waitUntil: "networkidle" });
      await page.locator(".community-signal-main").first().waitFor();
      await page.waitForTimeout(500);
      const first = await page.locator(".community-signal-list article").first().boundingBox();
      const overflow = await capturePreview(page, path.join(destination, `${version}-${width}.png`));
      const statsVisible = await page.locator(".community-header-stats").isVisible();
      const sortingVisible = await page.locator(".community-sort-tabs").isVisible();
      assert.equal(statsVisible, version === "before"); assert.equal(sortingVisible, version === "before");
      assert.equal(overflow, 0); assert.equal(await page.locator(".community-signal-main").count(), 6);
      assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      measurements.push({ version, width, height: width === 390 ? 844 : 900, firstCandidateTop: first.y, candidates: 6, statsVisible, sortingVisible, sourceIssues: 1, unknownSources: 1, overflow, consoleErrors: 0, writes: 0 });
      if (version === "after") {
        await page.locator(".community-source-health > summary").click();
        assert.equal(await page.locator(".community-source-state.error").isVisible(), true);
        assert.equal(await page.locator(".community-source-state.unknown").isVisible(), true);
        assert.equal(await capturePreview(page, path.join(destination, `expanded-${width}.png`)), 0);
        await page.locator(".community-source-health > summary").click();
        const title = await page.locator(".community-signal-main strong").first().innerText();
        await Promise.all([
          page.waitForResponse(response => response.url().includes("/api/editorial-intakes/") && response.request().method() === "GET"),
          page.locator(".community-signal-main").first().click(),
        ]);
        await page.locator(".editorial-reader-recommendation").waitFor();
        await page.locator("#editorial-reader-title").waitFor();
        assert.equal(await page.locator("#editorial-reader-title").innerText(), title);
        assert.equal(await page.locator(".editorial-reader").getByRole("button", { name: /分析讨论/u }).isDisabled(), true);
        assert.equal(await capturePreview(page, path.join(destination, `reader-${width}.png`)), 0);
        assert.deepEqual(errors, []); assert.deepEqual(writes, []);
      }
    }
    await context.close();
  }
  await writeFile(path.join(destination, "measurements.json"), JSON.stringify({ fixture: "6 fictional items; 3 fictional sources; no storage or providers", instant, measurements }, null, 2) + "\n");
  console.log(JSON.stringify(measurements));
} finally { if (browser) await browser.close(); child.kill("SIGTERM"); child.stdout.destroy(); child.stderr.destroy(); }
