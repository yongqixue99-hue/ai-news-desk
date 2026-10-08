import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";

test("late cache reads cannot erase a manual translation and late translation results cannot replace another platform", { timeout: 90_000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], { env: { ...process.env, AI_NEWS_DESK_PREVIEW_TRANSLATIONS: "1", AI_NEWS_DESK_DIST_ROOT: process.env.AI_NEWS_DESK_DIST_ROOT || path.resolve("dist") }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let output = ""; child.stderr.on("data", data => { output += String(data); });
  const browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
  try {
    const origin = await new Promise<string>((resolve, reject) => { const timer = setTimeout(() => reject(new Error(output)), 15000); child.stdout.on("data", data => { output += String(data); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timer); resolve(match[0]); } }); child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); }); });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    let releaseCache!: () => void;
    const cacheGate = new Promise<void>(resolve => { releaseCache = resolve; });
    await page.route("**/*", async route => {
      if (!route.request().url().startsWith(origin)) { await route.abort(); return; }
      if (route.request().url().endsWith("/api/aggregations/title-translations") && route.request().method() === "GET") { await cacheGate; await route.fulfill({ json: [] }); return; }
      await route.continue();
    });
    await page.goto(`${origin}/#aggregations`); await page.locator(".aggregation-row").first().waitFor();
    await page.getByRole("button", { name: "翻译本页标题", exact: true }).click();
    await page.locator(".aggregation-machine-label").first().waitFor(); assert.equal(await page.locator(".aggregation-machine-label").count(), 20);
    const oldCache = page.waitForResponse(response => response.url().endsWith("/api/aggregations/title-translations") && response.request().method() === "GET");
    releaseCache(); await oldCache; await page.waitForTimeout(150);
    assert.equal(await page.locator(".aggregation-machine-label").count(), 20, "a stale empty cache response cannot erase the new manual result");
    await page.close();

    const next = await browser.newPage({ viewport: { width: 390, height: 844 } });
    let releasePost!: () => void, fetched!: () => void;
    const postGate = new Promise<void>(resolve => { releasePost = resolve; }), postFetched = new Promise<void>(resolve => { fetched = resolve; });
    await next.route("**/*", async route => {
      if (!route.request().url().startsWith(origin)) { await route.abort(); return; }
      if (route.request().url().endsWith("/api/aggregations/title-translations") && route.request().method() === "POST") {
        const response = await route.fetch(); fetched(); await postGate; await route.fulfill({ response }); return;
      }
      await route.continue();
    });
    await next.goto(`${origin}/#aggregations`); await next.locator(".aggregation-machine-label").first().waitFor();
    await next.getByRole("button", { name: "翻译本页标题", exact: true }).click(); await postFetched;
    await next.getByRole("button", { name: "隔离平台 B 读取正常", exact: true }).click();
    assert.equal(await next.locator(".aggregation-row").count(), 10); assert.equal(await next.locator(".aggregation-machine-label").count(), 0);
    const latePost = next.waitForResponse(response => response.url().endsWith("/api/aggregations/title-translations") && response.request().method() === "POST");
    releasePost(); await latePost; await next.getByRole("button", { name: "翻译本页标题", exact: true }).waitFor(); await next.waitForTimeout(100);
    assert.equal(await next.locator(".aggregation-machine-label").count(), 0);
    assert.equal(await next.locator(".aggregation-row h2").first().innerText(), "Example model 40");
    assert.equal(await next.getByText("20 条标题已翻译", { exact: true }).count(), 0);
    assert.equal(await next.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
    await next.close();
  } finally { await browser.close(); if (child.pid && process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } } else child.kill("SIGTERM"); child.stdout.destroy(); child.stderr.destroy(); }
});
