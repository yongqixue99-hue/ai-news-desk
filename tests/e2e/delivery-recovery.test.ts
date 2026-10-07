import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Page } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import { createDefaultState } from "../../server/defaults.js";
import { createBlankDraftInState } from "../../server/draft-library.js";

const isolated = async (run: (page: Page) => Promise<void>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-delivery-recovery-"));
  const state = createDefaultState(); state.settings.scheduleEnabled = false; state.settings.officialMonitorEnabled = false;
  state.sources.forEach(source => { source.enabled = false; source.selected = false; });
  for (const [id, title] of [["recovery-b", "草稿乙"], ["recovery-a", "草稿甲"]]) {
    Object.assign(createBlankDraftInState(state), { id, title, bodyHtml: "<p>本地隔离草稿，只验证界面状态与恢复。</p>" });
  }
  await writeFile(path.join(root, "state.json"), JSON.stringify(state));
  const port = await new Promise<number>((resolve, reject) => {
    const socket = net.createServer(); socket.once("error", reject);
    socket.listen(0, "127.0.0.1", () => { const port = (socket.address() as AddressInfo).port; socket.close(error => error ? reject(error) : resolve(port)); });
  });
  const origin = `http://127.0.0.1:${port}`; let output = "";
  const server = spawn(process.execPath, ["--import", "tsx", "server/start.ts"], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", AI_NEWS_DESK_PORT: String(port), AI_NEWS_DESK_WORKFLOW_ROOT: root }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
  server.stdout.on("data", value => output += String(value)); server.stderr.on("data", value => output += String(value));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    const deadline = Date.now() + 30_000;
    while (!(await fetch(`${origin}/api/health`).catch(() => undefined))?.ok) {
      assert.ok(Date.now() < deadline, output); await new Promise(resolve => setTimeout(resolve, 100));
    }
    browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/#drafts`);
    await page.getByRole("textbox", { name: "文章标题", exact: true }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "文章标题", exact: true }).inputValue(), "草稿甲");
    await run(page); assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server.exitCode === null && server.signalCode === null) {
      if (process.platform !== "win32" && server.pid) process.kill(-server.pid, "SIGTERM"); else server.kill("SIGTERM");
      await Promise.race([new Promise(resolve => server.once("exit", resolve)), new Promise(resolve => setTimeout(resolve, 3000))]);
    }
    if (process.platform !== "win32" && server.pid) {
      try { process.kill(-server.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    } else if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    server.stdout.destroy(); server.stderr.destroy(); await rm(root, { recursive: true, force: true });
  }
};
const openDelivery = async (page: Page) => {
  await page.getByRole("navigation", { name: "草稿辅助工具" }).getByRole("button", { name: "交付", exact: true }).click();
  await page.getByRole("tablist", { name: "常用发布平台" }).getByRole("tab", { name: /多平台/ }).click();
  return page.locator(".multi-delivery");
};
const batch = (status: string, detail: string) => ({ id: "recovery-batch", createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 600_000).toISOString(), draftUpdatedAt: "test", targets: [{ platform: "zhihu", revisionHash: "test", status, detail }] });

test("completed delivery remains visible when receipt history fails or account inspection is slow", { timeout: 60_000 }, () => isolated(async page => {
  const delivered = batch("reported", "隔离测试：草稿已交付"); let brokenHistory = true, release!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/drafts/recovery-a/delivery-batches", route => route.fulfill({ json: { batches: [delivered], platforms: [] } }));
  await page.route("**/api/drafts/recovery-a/delivery-connections", async route => { await slow; await route.fulfill({ json: [] }).catch(() => undefined); });
  await page.route("**/api/drafts/recovery-a/social-deliveries", route => brokenHistory ? route.fulfill({ status: 503, json: { error: "隔离测试：历史暂不可读" } }) : route.fulfill({ json: { receipts: [], revisions: {} } }));
  try {
    const panel = await openDelivery(page);
    await panel.getByText("隔离测试：草稿已交付", { exact: true }).waitFor({ timeout: 2000 });
    await panel.getByText(/历史回执暂时无法读取/).waitFor();
    brokenHistory = false;
    await panel.getByRole("button", { name: "刷新平台账号与回执", exact: true }).click();
    await panel.getByText(/历史回执暂时无法读取/).waitFor({ state: "hidden" });
    assert.equal(await panel.getByText("隔离测试：草稿已交付", { exact: true }).isVisible(), true);
  } finally { release(); }
}));

test("a progress response started before cancellation cannot revive the cancelled task", { timeout: 60_000 }, () => isolated(async page => {
  const waiting = batch("waiting-login", "隔离测试：等待登录"); let requests = 0, release!: () => void, reading!: () => void;
  const slow = new Promise<void>(resolve => { release = resolve; }), started = new Promise<void>(resolve => { reading = resolve; });
  await page.route("**/api/drafts/recovery-a/delivery-batches", async route => {
    requests++;
    if (requests === 2) { reading(); await slow; }
    await route.fulfill({ json: { batches: [waiting], platforms: [] } }).catch(() => undefined);
  });
  await page.route("**/delivery-batches/recovery-batch/cancel", route => route.fulfill({ json: batch("cancelled", "隔离测试：已取消") }));
  try {
    const panel = await openDelivery(page); await panel.getByText("隔离测试：等待登录", { exact: true }).waitFor();
    await started;
    const late = Promise.race([
      page.waitForResponse(response => response.url().endsWith("/delivery-batches")),
      page.waitForEvent("requestfailed", { predicate: request => request.url().endsWith("/delivery-batches") }),
    ]);
    await panel.getByRole("button", { name: "取消等待", exact: true }).click();
    await panel.getByText("隔离测试：已取消", { exact: true }).waitFor();
    release(); await late;
    await page.waitForTimeout(100);
    assert.equal(await panel.getByText("隔离测试：已取消", { exact: true }).isVisible(), true, "the older read must not replace the newer cancellation receipt");
    assert.equal(await panel.getByRole("button", { name: "取消等待", exact: true }).count(), 0);
  } finally { release(); }
}));

test("switching drafts clears the previous draft's unsent rework reasons and note", { timeout: 60_000 }, () => isolated(async page => {
  const tools = page.getByRole("navigation", { name: "草稿辅助工具" });
  await tools.getByRole("button", { name: "版本", exact: true }).click();
  const rework = page.locator(".edit-observation"); await rework.locator("summary").click();
  await rework.getByRole("checkbox", { name: "结构不顺", exact: true }).check();
  await rework.getByRole("spinbutton", { name: "人工编辑分钟数（未测量留空）", exact: true }).fill("12");
  await rework.getByRole("textbox", { name: "补充说明", exact: true }).fill("只属于草稿甲的备注");
  if (!(await page.getByRole("complementary", { name: "草稿库", exact: true }).isVisible())) await page.locator(".draft-library-trigger").click();
  await page.getByRole("complementary", { name: "草稿库", exact: true }).getByRole("button").filter({ hasText: "草稿乙" }).click();
  assert.equal(await page.getByRole("textbox", { name: "文章标题", exact: true }).inputValue(), "草稿乙");
  if (!(await rework.getByRole("checkbox", { name: "结构不顺", exact: true }).isVisible())) await rework.locator("summary").click();
  assert.equal(await rework.getByRole("checkbox", { name: "结构不顺", exact: true }).isChecked(), false);
  assert.equal(await rework.getByRole("textbox", { name: "补充说明", exact: true }).inputValue(), "");
  assert.equal(await rework.getByRole("spinbutton", { name: "人工编辑分钟数（未测量留空）", exact: true }).inputValue(), "");
}));
