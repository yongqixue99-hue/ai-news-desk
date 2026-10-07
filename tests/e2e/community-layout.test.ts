import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";

test("community folds overview and sorting while preserving source failures, filtering and reader return", { timeout: 90_000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], {
    env: { ...process.env, AI_NEWS_DESK_PREVIEW_COMMUNITY: "1", AI_NEWS_DESK_DIST_ROOT: process.env.AI_NEWS_DESK_DIST_ROOT || path.resolve("dist") },
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let output = ""; child.stderr.on("data", data => { output += String(data); });
  const browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output)), 15000);
      child.stdout.on("data", data => { output += String(data); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: width!, height: height! } });
      const errors: string[] = [], writes: string[] = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      page.on("request", request => { if (!["GET", "HEAD"].includes(request.method())) writes.push(request.url()); });
      await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(`${origin}/#community`);
      await page.locator(".community-signal-main").first().waitFor();
      assert.equal(await page.locator(".community-header-stats").isVisible(), false);
      assert.equal(await page.locator(".community-sort-tabs").isVisible(), false);
      assert.equal(await page.locator(".community-signal-main").count(), 6);
      const first = await page.locator(".community-signal-list article").first().boundingBox();
      assert.ok(first && first.y < (width === 390 ? 340 : 290));
      const health = page.locator(".community-source-health");
      assert.match(await health.locator("summary").innerText(), /1 个来源需留意/u);
      await health.locator("summary").click();
      assert.equal(await health.locator(".community-source-state.error").isVisible(), true);
      assert.match(await health.locator(".community-source-state.error").innerText(), /读取失败/u);
      assert.match(await health.locator(".community-source-state.unknown").innerText(), /待读取/u);
      await health.getByRole("button", { name: "最新", exact: true }).click();
      assert.equal(await health.getByRole("button", { name: "最新", exact: true }).getAttribute("aria-pressed"), "true");
      await health.locator("summary").click();
      await page.locator(".community-topic-tabs").getByRole("button", { name: /^AI/u }).click();
      assert.equal(await page.locator(".community-signal-main").count(), 4);
      const selectedTitle = await page.locator(".community-signal-main strong").first().innerText();
      await Promise.all([
        page.waitForResponse(response => response.url().includes("/api/editorial-intakes/") && response.request().method() === "GET"),
        page.locator(".community-signal-main").first().click(),
      ]);
      await page.locator(".editorial-reader-recommendation").waitFor();
      await page.locator("#editorial-reader-title").waitFor();
      assert.equal(await page.locator("#editorial-reader-title").innerText(), selectedTitle);
      const reader = page.locator(".editorial-reader");
      assert.match(await reader.innerText(), /事实来源/u); assert.match(await reader.innerText(), /社区线索/u);
      assert.match(await reader.locator(".editorial-reader-evidence-grid section").last().innerText(), /48 积分 · 4 评论/u);
      assert.match(await reader.innerText(), /少于 5 条有效样本/u);
      assert.equal(await reader.getByRole("button", { name: /分析讨论/u }).isDisabled(), true);
      if (width === 390) {
        await page.getByRole("button", { name: "返回热点列表", exact: true }).click();
        assert.equal(await page.locator(".community-signal-main").first().isVisible(), true);
        assert.equal(await page.locator(".community-reader-slot").isVisible(), false);
      }
      await page.locator(".community-topic-tabs").getByRole("button", { name: "全部", exact: true }).click();
      assert.equal(await page.locator(".community-signal-main").count(), 6);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
      assert.deepEqual(errors, []); assert.deepEqual(writes, []); await page.close();
    }
  } finally {
    await browser.close();
    if (child.pid && process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } }
    else child.kill("SIGTERM"); child.stdout.destroy(); child.stderr.destroy();
  }
});
