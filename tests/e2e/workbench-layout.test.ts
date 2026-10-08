import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";

test("workbench keeps dates optional, candidates readable and draft actions visible on desktop and mobile", { timeout: 90_000 }, async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], {
    env: { ...process.env, AI_NEWS_DESK_PREVIEW_WORKBENCH: "1", AI_NEWS_DESK_DIST_ROOT: process.env.AI_NEWS_DESK_DIST_ROOT || path.resolve("dist") },
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  let output = ""; child.stderr.on("data", data => { output += String(data); });
  const browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
  try {
    const origin = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(output)), 15_000);
      child.stdout.on("data", data => { output += String(data); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timer); resolve(match[0]); } });
      child.once("exit", () => { clearTimeout(timer); reject(new Error(output)); });
    });
    const bootstrap = await (await fetch(`${origin}/api/bootstrap`)).json() as { runs: Array<{ candidates: Array<{ id: string; sourceRole?: string }> }> };
    const candidateIds = bootstrap.runs[0]!.candidates.filter(candidate => candidate.sourceRole !== "community").map(candidate => candidate.id);
    assert.equal(candidateIds.length, 6);
    for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) {
      const page = await browser.newPage({ viewport: { width: width!, height: height! } });
      const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.route("**/*", route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
      await page.emulateMedia({ reducedMotion: "reduce" }); await page.goto(`${origin}/#workbench`);
      await page.locator(`#candidate-${candidateIds[0]}`).waitFor();
      assert.equal(await page.getByLabel("开始日期").isVisible(), false);
      await page.getByText("搜寻日期", { exact: false }).first().click();
      await page.getByLabel("开始日期").fill("2099-01-01");
      assert.equal(await page.getByRole("button", { name: "开始采集", exact: true }).isDisabled(), true);
      await page.getByLabel("开始日期").fill(await page.getByLabel("结束日期").inputValue());
      await page.locator(".collection-date-range summary").click();
      const first = await page.locator(`#candidate-${candidateIds[0]}`).boundingBox();
      assert.ok(first && first.y < (width === 390 ? 460 : 400), `first candidate must be on the first screen at ${width}`);
      const generate = page.getByRole("button", { name: "生成 2 篇草稿", exact: true });
      const action = await generate.boundingBox();
      assert.ok(action && action.y >= 0 && action.y + action.height <= height! - (width === 390 ? 64 : 0));
      assert.equal(await generate.isEnabled(), true);
      assert.equal(await page.locator('[id^="candidate-"]').count(), 6);
      assert.equal(await page.getByRole("link", { name: "查看原文：Acme releases Guide", exact: true }).getAttribute("href"), "https://example.com/ui-5");
      if (width === 390) {
        const dock = page.locator(".workbench-mobile-dock");
        const toggle = dock.getByRole("button", { name: /待写选题/u });
        await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        await page.getByRole("button", { name: "收起待写选题", exact: true }).click();
        assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "true");
        await page.getByRole("button", { name: "从待写移除：隔离示例：Acme 开放本地模型，先看使用条件", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "生成 1 篇草稿", exact: true }).isEnabled(), true);
        await toggle.click(); assert.equal(await toggle.getAttribute("aria-expanded"), "false");
        const last = page.getByRole("link", { name: "查看原文：Acme releases Guide", exact: true });
        await last.scrollIntoViewIfNeeded();
        const geometry = await last.evaluate(element => {
          const r = element.getBoundingClientRect(), d = document.querySelector(".workbench-mobile-dock")!.getBoundingClientRect();
          const nav = document.querySelector(".main-sidebar")!.getBoundingClientRect();
          return { covered: r.top < d.bottom && r.bottom > d.top, navOverlap: d.bottom > nav.top,
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
        });
        assert.equal(geometry.covered, false); assert.equal(geometry.navOverlap, false); assert.equal(geometry.overflow, 0);
        await page.getByRole("button", { name: "更多功能", exact: true }).click();
        assert.equal(await page.getByRole("button", { name: "聚合资讯", exact: true }).isVisible(), true);
      } else {
        await page.locator("h1").click(); await page.keyboard.press("/");
        assert.equal(await page.locator('input[type="search"]').evaluate(element => element === document.activeElement), true);
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0);
      assert.deepEqual(errors, []); await page.close();
    }
  } finally {
    await browser.close();
    if (child.pid && process.platform !== "win32") { try { process.kill(-child.pid, "SIGTERM"); } catch { /* exited */ } }
    else child.kill("SIGTERM"); child.stdout.destroy(); child.stderr.destroy();
  }
});
