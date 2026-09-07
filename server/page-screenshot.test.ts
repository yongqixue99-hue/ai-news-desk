import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright-core";
import { access } from "node:fs/promises";
import { captureArticleFigures } from "./page-screenshot.js";

test("rendered article capture keeps SVG legends and HTML benchmark tables, excluding site chrome", async (t) => {
  const executables = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"];
  const executablePath = (await Promise.all(executables.map(async (path) => await access(path).then(() => path).catch(() => undefined)))).find(Boolean);
  if (!executablePath) return t.skip("Chrome/Chromium is unavailable");
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent(`<style>figure{width:700px;margin:24px}svg{width:700px;height:280px}table{width:700px;height:240px;background:#eee}figcaption{padding:14px}</style>
      <nav><svg><rect width="700" height="280" fill="red"/></svg></nav>
      <main><article><h1>Model capability report</h1>
        <figure><svg role="img"><rect x="20" y="20" width="650" height="220" fill="#24747d"/><text x="40" y="80" fill="white">Model A 81% · Model B 72%</text></svg><figcaption>Reasoning benchmark · official evaluation</figcaption></figure>
        <figure><table><caption>Accuracy comparison</caption><tr><th>Model</th><th>Score</th></tr><tr><td>A</td><td>81%</td></tr></table><figcaption>Measured under the same settings</figcaption></figure>
      </article><aside><svg><rect width="700" height="280" fill="red"/></svg></aside></main>`);
    const figures = await captureArticleFigures(page, { limit: 8, chartsOnly: true });
    assert.equal(figures.length, 2);
    assert.deepEqual(figures.map((figure) => figure.kind), ["chart", "table"]);
    assert.match(figures[0]!.caption, /Reasoning benchmark/);
    assert.ok(figures[0]!.height > 280, "caption and legend stay inside the crop");
    assert.ok(figures.every((figure) => figure.bytes.length > 500));
  } finally { await browser.close(); }
});
