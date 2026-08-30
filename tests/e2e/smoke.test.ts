import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForHealth = async (url: string, output: () => string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/health`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`isolated server did not become healthy\n${output()}`);
};

test("production build opens the primary Windows browser routes", { timeout: 60_000 }, async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "ai-news-desk-e2e-"));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let serverOutput = "";
  const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      AI_NEWS_DESK_PORT: String(port),
      AI_NEWS_DESK_WORKFLOW_ROOT: workflowRoot,
      NO_COLOR: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  server.stdout.on("data", (chunk) => (serverOutput += String(chunk)));
  server.stderr.on("data", (chunk) => (serverOutput += String(chunk)));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForHealth(origin, () => serverOutput);
    browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
    const page = await browser.newPage();
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    for (const [route, heading] of [
      ["today", "今日编辑台"],
      ["workbench", "新闻工作台"],
      ["drafts", "文章草稿"],
    ] as const) {
      await page.goto(`${origin}/#${route}`, { waitUntil: "networkidle" });
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    server.kill();
    await new Promise<void>((resolve) => {
      if (server.exitCode !== null) resolve();
      else {
        server.once("exit", () => resolve());
        setTimeout(resolve, 5_000).unref();
      }
    });
    await rm(workflowRoot, { recursive: true, force: true });
  }
});
