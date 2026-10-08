// Paired synthetic C2 screenshots. No storage, workers, model or platform calls.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";
import { capturePreview } from "./shot.mjs";

const [destination = "docs/design/optimization-2026-10-07/C2"] = process.argv.slice(2);
await mkdir(destination, { recursive: true });
const instant = "2026-10-07T12:00:00.000Z";
const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], {
  env: { ...process.env, AI_NEWS_DESK_PREVIEW_WORKBENCH: "1", AI_NEWS_DESK_PREVIEW_TIME: instant,
    AI_NEWS_DESK_PREVIEW_BEFORE_DIST: path.resolve(".artifacts/optimization/C2/before-dist"), AI_NEWS_DESK_DIST_ROOT: path.resolve(".artifacts/verify/dist") },
  stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
const origin = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error(output)), 15000);
  child.stderr.on("data", data => { output += String(data); });
  child.stdout.on("data", data => { output += String(data); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) { clearTimeout(timeout); resolve(match[0]); } });
  child.once("exit", () => { clearTimeout(timeout); reject(new Error(output)); });
});
const browser = await chromium.launch({ channel: "chrome", headless: true });
const measurements = [];
try {
  for (const [width, height] of [[1440, 900], [1280, 720], [390, 844]]) {
    for (const version of ["before", "after"]) {
      const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce", locale: "zh-CN", timezoneId: "Asia/Shanghai" });
      await context.addInitScript(value => {
        const NativeDate = Date;
        class FixedDate extends NativeDate { constructor(...args) { super(...(args.length ? args : [value])); } static now() { return NativeDate.parse(value); } }
        globalThis.Date = FixedDate;
      }, instant);
      const page = await context.newPage(), errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
      await page.goto(`${origin}/${version === "before" ? "__before/" : ""}#workbench`, { waitUntil: "networkidle" });
      await page.locator(".candidate-featured").waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.match(await page.locator(".candidate-featured").innerText(), /隔离示例/u);
      const measurement = await page.evaluate(() => {
        const visible = element => element && element.checkVisibility() && (!element.closest("details:not([open])") || Boolean(element.closest("summary")));
        const generate = [...document.querySelectorAll("button")].find(button => button.textContent.trim() === "生成 2 篇草稿" && visible(button));
        const action = generate?.getBoundingClientRect();
        const first = document.querySelector(".candidate-featured").getBoundingClientRect();
        return { firstCandidateTop: first.top, draftActionTop: action?.top, draftActionBottom: action?.bottom,
          draftActionVisible: Boolean(action && action.top >= 0 && action.bottom <= innerHeight),
          dateVisible: Boolean(visible(document.querySelector('input[aria-label="开始日期"]'))),
          candidates: document.querySelectorAll('[id^="candidate-"]').length,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      console.log(JSON.stringify({version,width,...measurement}));
      assert.equal(measurement.overflow, 0); assert.deepEqual(errors, []);
      if (version === "after") { assert.equal(measurement.draftActionVisible, true); assert.equal(measurement.dateVisible, false); }
      await capturePreview(page, path.join(destination, `${version}-${width}.png`));
      measurements.push({ version, width, height, ...measurement, consoleErrors: errors.length });
      if (version === "after" && width === 390) {
        await page.locator(".workbench-mobile-dock").getByRole("button", { name: /待写选题/u }).click();
        await capturePreview(page, path.join(destination, "after-390-selection.png"));
      }
      await context.close();
    }
  }
  await writeFile(path.join(destination, "measurements.json"), JSON.stringify(measurements, null, 2) + "\n");
  console.log(JSON.stringify(measurements));
} finally { await browser.close(); child.kill("SIGTERM"); child.stdout.destroy(); child.stderr.destroy(); }
