import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import { createDefaultState } from "../../server/defaults.js";

test("link and screenshot materials enter the writer without generation and survive saving", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-reference-ui-"));
  const state = createDefaultState();
  state.settings.scheduleEnabled = false; state.settings.officialMonitorEnabled = false;
  state.sources.forEach(source => { source.enabled = false; source.selected = false; });
  state.drafts = []; state.runs = [];
  await writeFile(path.join(root, "state.json"), JSON.stringify(state));
  const port = await new Promise<number>(resolve => { const socket = net.createServer(); socket.listen(0, "127.0.0.1", () => { const port = (socket.address() as net.AddressInfo).port; socket.close(() => resolve(port)); }); });
  const origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ["--import", "tsx", "server/start.ts"], { env: { ...process.env, NODE_ENV: "production", AI_NEWS_DESK_PORT: String(port), AI_NEWS_DESK_WORKFLOW_ROOT: root }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  let output = ""; server.stdout.on("data", data => output += data); server.stderr.on("data", data => output += data);
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const deadline = Date.now() + 30_000;
    while (!(await fetch(`${origin}/api/health`).catch(() => undefined))?.ok) { if (Date.now() > deadline) throw new Error(output); await new Promise(resolve => setTimeout(resolve, 150)); }
    browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const requests: string[] = [], errors: string[] = [];
    page.on("request", request => { if (request.method() === "POST") requests.push(new URL(request.url()).pathname); });
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/references/read", route => route.fulfill({ json: { title: "隔离示例：原始来源", text: "这是仅供阅读的原文，不能混进发布正文。", author: "示例作者", readStatus: "read" } }));
    await page.goto(origin);
    await page.getByRole("button", { name: "写一篇", exact: true }).click();
    await page.getByRole("button", { name: /粘贴链接或截图/u }).click();
    await page.getByRole("region", { name: "写作资料" }).waitFor();
    assert.ok(page.url().endsWith("#drafts"));
    await page.getByLabel("链接或资料文字", { exact: true }).fill("https://example.com/reference");
    await page.getByRole("button", { name: "加入资料", exact: true }).click();
    await page.getByText("隔离示例：原始来源", { exact: true }).waitFor();
    await page.getByLabel("链接或资料文字", { exact: true }).fill("https://example.com/reference");
    await page.getByRole("button", { name: "加入资料", exact: true }).click();
    assert.equal(await page.getByText("隔离示例：原始来源", { exact: true }).count(), 1);
    await page.getByLabel("链接或资料文字", { exact: true }).fill("这句私人备注不要发布");
    await page.getByRole("button", { name: "加入资料", exact: true }).click();
    await page.getByLabel("选择资料截图", { exact: true }).setInputFiles({ name: "资料截图.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6YcAAAAASUVORK5CYII=", "base64") });
    await page.getByRole("img", { name: "资料截图.png" }).waitFor();
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await page.waitForFunction(async () => { const state = await (await fetch("/api/bootstrap")).json(); return state.drafts[0]?.references?.length === 3; });
    const saved = (await (await fetch(`${origin}/api/bootstrap`)).json()).drafts[0];
    assert.equal(saved.bodyHtml, "");
    assert.deepEqual(saved.sources, []);
    assert.equal(saved.references[2].kind, "screenshot");
    assert.equal(saved.provenance.contentPackageId, undefined);
    assert.equal(requests.some(url => /intake-review|generate|completions|briefing/u.test(url)), false);
    await page.reload();
    await page.getByRole("button", { name: "资料", exact: true }).click();
    await page.getByText("隔离示例：原始来源", { exact: true }).waitFor();
    // A slow source reader must merge into the latest edit, never restore an older article.
    let releaseRead!: () => void;
    const pendingRead = new Promise<void>(resolve => { releaseRead = resolve; });
    await page.unroute("**/references/read");
    await page.route("**/references/read", async route => {
      await pendingRead;
      await route.fulfill({ json: { title: "迟到的原文", text: "参考资料", readStatus: "read" } });
    });
    await page.getByLabel("链接或资料文字", { exact: true }).fill("https://example.com/slow");
    await page.getByRole("button", { name: "加入资料", exact: true }).click();
    await page.getByLabel("文章标题", { exact: true }).fill("读取期间修改的标题");
    const prose = page.getByLabel("连续文章编辑器", { exact: true }).first();
    await prose.fill("读取期间写下的正文。");
    releaseRead();
    await page.getByText("迟到的原文", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("文章标题", { exact: true }).inputValue(), "读取期间修改的标题");
    assert.equal(await prose.innerText(), "读取期间写下的正文。");
    // Switching drawers must preserve the same editor instance and its undo history.
    await prose.press("End");
    await prose.press("Enter");
    await prose.pressSequentially("用于撤销的补充句。");
    const editorInstance = await prose.evaluate(element => { element.setAttribute("data-test-editor-instance", "retained"); return element.getAttribute("data-test-editor-instance"); });
    const tools = page.getByRole("navigation", { name: "草稿辅助工具" });
    for (let index = 0; index < 20; index++) await tools.getByRole("button", { name: index % 2 ? "资料" : "交付", exact: true }).click();
    assert.equal(await prose.getAttribute("data-test-editor-instance"), editorInstance);
    assert.match(await prose.innerText(), /读取期间写下的正文。[\s\S]*用于撤销的补充句。/u);
    await prose.press("ControlOrMeta+z");
    assert.doesNotMatch(await prose.innerText(), /用于撤销的补充句/u);
    assert.equal(await page.getByLabel("文章标题", { exact: true }).inputValue(), "读取期间修改的标题");
    if (await page.getByRole("button", { name: "关闭草稿库", exact: true }).isVisible()) await page.getByRole("button", { name: "关闭草稿库", exact: true }).click();
    await page.locator(".utility-drawer-scroll").evaluate(element => element.scrollTo(0, 0));
    if (process.env.AI_NEWS_DESK_WRITING_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.AI_NEWS_DESK_WRITING_SCREENSHOTS, "references-1440.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    if (process.env.AI_NEWS_DESK_WRITING_SCREENSHOTS) await page.screenshot({ path: path.join(process.env.AI_NEWS_DESK_WRITING_SCREENSHOTS, "references-390.png") });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server.pid && process.platform !== "win32") { try { process.kill(-server.pid, "SIGTERM"); } catch {} } else server.kill("SIGTERM");
    await new Promise<void>(resolve => { if (server.exitCode !== null || server.signalCode !== null) resolve(); else { const timer = setTimeout(resolve, 3000); timer.unref(); server.once("exit", () => { clearTimeout(timer); resolve(); }); } });
    if (server.pid && process.platform !== "win32") { try { process.kill(-server.pid, "SIGKILL"); } catch {} }
    server.stdout.destroy(); server.stderr.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
