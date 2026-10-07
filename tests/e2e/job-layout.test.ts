import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";

test("mobile task prompt leaves topic actions and navigation unobstructed", { timeout: 60_000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], {
    env: { ...process.env, AI_NEWS_DESK_PREVIEW_JOBS: "1", AI_NEWS_DESK_DIST_ROOT: process.env.AI_NEWS_DESK_DIST_ROOT || path.resolve("dist") },
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let output = "";
  child.stderr.on("data", data => { output += String(data); });
  const browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`fixture did not start: ${output}`)), 15_000);
      child.stdout.on("data", data => { output += String(data); const found = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (found) { clearTimeout(timer); resolve(found[0]); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`${origin}/#today`);
    const center = page.getByRole("complementary", { name: "后台任务中心" });
    const toggle = center.getByRole("button", { name: "1 个任务处理中" });
    await toggle.waitFor(); await page.locator(".radar-actions button").first().waitFor();
    await page.evaluate(() => { const action = document.querySelector(".radar-actions button")!;
      const rect = action.getBoundingClientRect(); window.scrollTo(0, window.scrollY + rect.top + rect.height / 2 - (innerHeight - 94)); });
    const geometry = await page.evaluate(() => {
      const bounds = document.querySelector(".product-job-toggle")!.getBoundingClientRect();
      const actions = [...document.querySelectorAll<HTMLElement>(".radar-actions button")];
      const overlaps = actions.filter(button => { const r = button.getBoundingClientRect(); return r.top < innerHeight - 64 && r.bottom > 0
        && r.left < bounds.right && r.right > bounds.left && r.top < bounds.bottom && r.bottom > bounds.top; });
      const navigation = document.querySelector(".main-sidebar")!.getBoundingClientRect();
      return { overlaps: overlaps.map(button => button.textContent), navigationOverlap: bounds.bottom > navigation.top && bounds.top < navigation.bottom,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    assert.deepEqual(geometry.overlaps, [], "task prompt must not cover visible topic buttons");
    assert.equal(geometry.navigationOverlap, false);
    assert.equal(geometry.overflow, 0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
    const panel = await center.locator(".product-job-panel").boundingBox();
    assert.ok(panel && panel.x >= 0 && panel.x + panel.width <= 390);
    await center.getByRole("button", { name: "刷新任务状态" }).click();
    await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await page.getByRole("button", { name: "更多功能" }).click();
    assert.equal(await page.getByRole("button", { name: "聚合资讯", exact: true }).isVisible(), true);
  } finally {
    await browser.close();
    if (child.pid && process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch { /* already exited */ } }
    else child.kill("SIGTERM");
    child.stdout.destroy(); child.stderr.destroy();
  }
});
