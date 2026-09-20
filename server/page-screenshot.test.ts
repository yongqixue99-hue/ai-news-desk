import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { chromium } from "playwright-core";
import { access } from "node:fs/promises";
import { captureArticleFigures } from "./page-screenshot.js";

async function launchTestBrowser(t: TestContext) {
  const executables = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"];
  const executablePath = (await Promise.all(executables.map(async (path) => await access(path).then(() => path).catch(() => undefined)))).find(Boolean);
  if (!executablePath) {
    assert.ok(!process.env.CI, "CI must provide Chrome/Chromium for article capture tests");
    t.skip("Chrome/Chromium is unavailable");
    return;
  }
  return chromium.launch({ executablePath, headless: true });
}

test("rendered article capture keeps SVG legends and HTML benchmark tables, excluding site chrome", async (t) => {
  const browser = await launchTestBrowser(t);
  if (!browser) return;
  t.diagnostic(`Browser: ${browser.version()}; platform: ${process.platform}`);
  try {
    // Every capture must pass; these are repetitions to expose flakes, not retries.
    for (let attempt = 0; attempt < (process.env.CI ? 5 : 1); attempt += 1) {
      const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
      await page.setContent(`<style>figure{width:700px;margin:24px}svg{width:700px;height:280px}table{width:700px;height:240px;background:#eee}figcaption{padding:14px}</style>
      <nav><svg><rect width="700" height="280" fill="red"/></svg></nav>
      <main><article><h1>Model capability report</h1>
        <figure><svg role="img"><rect x="20" y="20" width="650" height="220" fill="#24747d"/><text x="40" y="80" fill="white">Model A 81% · Model B 72%</text></svg><figcaption>Reasoning benchmark · official evaluation</figcaption></figure>
        <figure><table><caption>Accuracy comparison</caption><tr><th>Model</th><th>Score</th></tr><tr><td>A</td><td>81%</td></tr></table><figcaption>Measured under the same settings</figcaption></figure>
      </article><aside><svg><rect width="700" height="280" fill="red"/></svg></aside></main>`);
      const figures = await captureArticleFigures(page, { limit: 8, chartsOnly: true, onCaptureFailure: message => t.diagnostic(message) });
      assert.equal(figures.length, 2);
      assert.deepEqual(figures.map((figure) => figure.kind), ["chart", "table"]);
      assert.match(figures[0]!.caption, /Reasoning benchmark/);
      assert.ok(figures[0]!.height > 280, "caption and legend stay inside the crop");
      assert.ok(figures.every((figure) => figure.bytes.length > 500));
      await page.close();
    }
  } finally { await browser.close(); }
});

test("a delayed browser render does not silently discard a valid article figure", async (t) => {
  const browser = await launchTestBrowser(t);
  if (!browser) return;
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    await page.setContent('<article><figure style="width:700px"><svg width="700" height="280"><rect width="700" height="280" fill="#24747d"/></svg><figcaption>Official benchmark</figcaption></figure></article>');
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setVirtualTimePolicy', { policy: 'pause' });
    // Reproduce the Windows failure at the real browser seam: layout is valid,
    // but animation frames arrive after the old three-second pre-scroll deadline.
    const resume = new Promise<void>((resolve, reject) => {
      setTimeout(() => { session.send('Emulation.setVirtualTimePolicy', { policy: 'advance' }).then(() => resolve(), reject); }, 4_000);
    });
    const [figures] = await Promise.all([
      captureArticleFigures(page, { limit: 1, chartsOnly: true, onCaptureFailure: message => t.diagnostic(message) }),
      resume,
    ]);
    assert.equal(figures.length, 1, 'a delayed frame must not become a missing source image');
    assert.equal(figures[0]!.caption, 'Official benchmark');
    assert.ok(figures[0]!.bytes.length > 500);
  } finally { await browser.close(); }
});
