import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import { createDefaultState } from "../../server/defaults.js";

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

const waitForExit = (
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (exited: boolean) => {
      if (timer) clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
  });
};

const stopProcessTree = async (child: ReturnType<typeof spawn>) => {
  const pid = child.pid;
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== "win32" && pid) process.kill(-pid, "SIGTERM");
    else child.kill("SIGTERM");
  }

  await waitForExit(child, 3_000);

  // `tsx` starts an esbuild service. On Linux it can outlive the direct child,
  // so kill the detached process group as a final cleanup step.
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  } else if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  await waitForExit(child, 2_000);
  child.stdout?.destroy();
  child.stderr?.destroy();
};



test("multi-platform setup and per-target failures stay truthful on desktop and mobile", { timeout: 120_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'newsdesk-delivery-'));
  const state = createDefaultState(); state.settings.scheduleEnabled = false; state.settings.officialMonitorEnabled = false;
  state.sources.forEach(source => { source.enabled = false; source.selected = false; });
  const now = new Date().toISOString();
  state.drafts = [{ id: 'delivery-ui', runId: 'r', candidateId: 'c', createdAt: now, updatedAt: now, status: 'ready', title: '多平台测试文章', paragraphs: ['这是测试正文。'], bodyHtml: '<p>这是测试正文。</p>', take: '', images: [], factClaims: [], uncertainties: [], sources: [], community: '', topics: [], provenance: { originalUrl: 'https://example.com', generatedBy: 'test' } }];
  await writeFile(path.join(root, 'state.json'), JSON.stringify(state));
  const port = await freePort(), origin = `http://127.0.0.1:${port}`; let output = '';
  const server = spawn(process.execPath, ['--import', 'tsx', 'server/start.ts'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production', AI_NEWS_DESK_PORT: String(port), AI_NEWS_DESK_WORKFLOW_ROOT: root }, stdio: ['ignore','pipe','pipe'], detached: process.platform !== 'win32' });
  server.stdout.on('data', chunk => output += String(chunk)); server.stderr.on('data', chunk => output += String(chunk));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForHealth(origin, () => output);
    const response = await fetch(`${origin}/api/delivery/social/status`); const status = await response.json();
    assert.equal(status.connected, false); assert.equal(status.settings.tokenConfigured, false);
    assert.equal(status.accounts.find((item: {id: string}) => item.id === 'toutiao').available, false);
    const rejected = await fetch(`${origin}/api/drafts/delivery-ui/social-deliveries`, { method: 'POST', headers: {'content-type':'application/json'}, body: JSON.stringify({ platform: 'toutiao' }) });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /尚未接通/);
    const invalidSettings = await fetch(`${origin}/api/delivery/social/settings`, { method: 'PATCH', headers: {'content-type':'application/json'}, body: JSON.stringify({ extensionId: 'bad', enabled: true }) });
    assert.equal(invalidSettings.status, 400); assert.match((await invalidSettings.json()).error, /扩展 ID/);
    browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const shots = path.resolve('.artifacts/multiplatform/browser'); await mkdir(shots, { recursive: true });
    await page.goto(`${origin}/#schedule`);
    await page.getByRole('tab', { name: '采集计划', exact: true }).waitFor();
    assert.equal(await page.getByRole('heading', { name: '连接多平台同步助手' }).isVisible(), false);
    await page.getByRole('tab', { name: '平台连接', exact: true }).click();
    await page.getByRole('button', { name: '知乎与百家号 多平台同步助手', exact: true }).click();
    await page.getByRole('heading', { name: '连接多平台同步助手' }).waitFor();
    await page.locator('#social-delivery-settings').scrollIntoViewIfNeeded();
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await page.locator('#social-delivery-settings').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(shots, `settings-${width}.png`) });
    }
    await page.setViewportSize({width:1440,height:1000});
    await page.goto(`${origin}/#drafts`);
    await page.getByRole('textbox', {name:'文章标题'}).waitFor();
    assert.equal(await page.getByRole('textbox', {name:'文章标题'}).inputValue(), '多平台测试文章');
    await page.getByRole('navigation', { name: '草稿辅助工具' }).getByRole('button', {name:'交付',exact:true}).click();
    await page.getByText('选择这篇文章的投递平台', {exact:true}).waitFor();
    const panel = page.locator('.multi-delivery');
    await panel.getByRole('checkbox', {name:/知乎/}).check();
    assert.equal(await panel.getByRole('checkbox', {name:/今日头条/}).isDisabled(), true);
    await page.getByRole('button', {name:'一键投递所选 2 个平台'}).click();
    await panel.getByRole('status').getByText('请先到设置填写 AppSecret 并测试草稿接口').waitFor();
    await panel.getByRole('status').getByText(/当前同步助手未提供此平台|请先连接文章同步助手|尚未连接文章同步助手/).waitFor();
    assert.equal((await (await fetch(`${origin}/api/drafts/delivery-ui/social-deliveries`)).json()).receipts.length, 0);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 }); await panel.scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(shots, `delivery-${width}.png`) });
    }
    assert.equal(await page.getByRole('complementary', { name: '草稿库', exact: true }).isVisible(), false, 'resizing to mobile must keep the active delivery panel unobstructed');
    await panel.getByRole('link', { name: '连接设置', exact: true }).click();
    await page.getByRole('heading', { name: '连接多平台同步助手', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '平台连接', exact: true }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await stopProcessTree(server); await rm(root, { recursive: true, force: true }); }
});
