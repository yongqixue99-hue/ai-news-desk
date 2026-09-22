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
import { createBlankDraftInState } from "../../server/draft-library.js";

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
  Object.assign(createBlankDraftInState(state), { id: 'delivery-ui', title: '多平台测试文章', bodyHtml: '<p>这是一篇独立测试稿，用于验证保存、发送和发送后继续编辑的完整流程。</p>', community: '数码硬件', topics: ['AI'] });
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
    const primaryTabs = page.getByRole('tablist', { name: '常用发布平台' });
    await primaryTabs.getByRole('tab', { name: /微信公众号/ }).waitFor();
    assert.equal(await page.getByRole('button', { name: '同步到公众号草稿箱', exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole('button', { name: '复制公众号排版', exact: true }).isVisible(), true);
    await page.locator('.wechat-primary').locator('summary').filter({ hasText: '作者与摘要' }).click();
    await page.getByRole('textbox', { name: '公众号作者', exact: true }).fill('测试作者');
    await page.getByRole('textbox', { name: '公众号摘要', exact: true }).fill('摘要保存后再切平台也不会丢失。');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    await page.getByRole('textbox', { name: '公众号作者', exact: true }).waitFor();
    // Poll persisted data rather than a delay: an autosave acknowledgement may still be in flight.
    await assert.doesNotReject(async () => {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        const saved = await (await fetch(`${origin}/api/drafts/delivery-ui`)).json();
        if (saved.wechatMetadata?.digest === '摘要保存后再切平台也不会丢失。') return;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('WeChat metadata was not persisted');
    });
    await primaryTabs.getByRole('tab', { name: /小黑盒/ }).click();
    assert.equal(await page.getByRole('button', { name: '填入小黑盒编辑器', exact: true }).isDisabled(), true);
    // First delivery must expose setup even though no fill receipt exists yet.
    assert.equal(await page.getByRole('textbox', { name: '关联社区', exact: true }).isVisible(), true);
    await page.locator('.publishing-prep > details > summary').filter({ hasText: '发送形式' }).click();
    assert.equal(await page.getByRole('group', { name: '小黑盒发送形式' }).isVisible(), true);
    assert.equal(await page.getByRole('heading', { name: '发送前检查', exact: true }).isVisible(), true);
    await primaryTabs.getByRole('tab', { name: /微信公众号/ }).click();
    await page.locator('.wechat-primary').locator('summary').filter({ hasText: '作者与摘要' }).click();
    assert.equal(await page.getByRole('textbox', { name: '公众号作者', exact: true }).inputValue(), '测试作者');
    // Simulate only the local Chrome transport; never open or write to a real platform account.
    const { token } = await (await fetch(`${origin}/api/publisher/extension/bootstrap`)).json();
    const headers = { 'content-type': 'application/json', 'x-ai-news-extension-token': token };
    const clientId = 'delivery-e2e';
    const fillOnce = async () => {
      await fetch(`${origin}/api/publisher/extension/heartbeat`, { method: 'POST', headers, body: JSON.stringify({ clientId, version: '0.1.23' }) });
      const receive = async () => {
        const deadline = Date.now() + 20_000;
        while (Date.now() < deadline) {
          const next = await fetch(`${origin}/api/publisher/extension/jobs/next?clientId=${clientId}`, { headers });
          if (next.status === 200) {
            const job = await next.json();
            const completed = await fetch(`${origin}/api/publisher/extension/jobs/${job.id}/result`, { method: 'POST', headers, body: JSON.stringify({ clientId, pageUrl: 'https://www.xiaoheihe.cn/creator/editor/draft/article', steps: ['登录','编辑器','标题','正文','配图','图注','分区','话题'].map(name => ({ name, ok: true, detail: '隔离测试传输回执' })) }) });
            assert.equal(completed.status, 200); return;
          }
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        throw new Error('No extension job was queued');
      };
      const job = receive();
      await page.getByRole('button', { name: '填入小黑盒编辑器', exact: true }).click();
      await job;
      await page.getByText('已填入并逐项核验', { exact: true }).waitFor();
    };
    await primaryTabs.getByRole('tab', { name: /小黑盒/ }).click();
    await fillOnce();
    await page.getByRole('textbox', { name: '文章标题', exact: true }).fill('填入后继续编辑的标题');
    const saveAck = page.waitForResponse(response => response.url().endsWith('/api/drafts/delivery-ui') && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: '保存草稿', exact: true }).click();
    assert.equal((await saveAck).status(), 200, 'fill receipt must return the current optimistic save version');
    await page.getByText('上次版本已填入，当前修改待同步', { exact: true }).waitFor();
    const savedAfterFill = await (await fetch(`${origin}/api/drafts/delivery-ui`)).json();
    assert.equal(savedAfterFill.title, '填入后继续编辑的标题');
    assert.notEqual(savedAfterFill.status, 'filled');
    await fillOnce();
    await primaryTabs.getByRole('tab', { name: /微信公众号/ }).click();
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(shots, `delivery-${width}.png`) });
    }
    assert.equal(await page.getByRole('complementary', { name: '草稿库', exact: true }).isVisible(), false);
    await page.getByText('其他平台 · 知乎、百家号', { exact: true }).click();
    const panel = page.locator('.multi-delivery');
    await panel.getByRole('checkbox', {name:/知乎/}).check();
    assert.equal(await panel.getByRole('checkbox', {name:/今日头条/}).isDisabled(), true);
    await page.getByRole('button', {name:'一键投递所选 1 个平台'}).click();
    await panel.getByRole('status').getByText(/当前同步助手未提供此平台|请先连接文章同步助手|尚未连接文章同步助手/).waitFor();
    assert.equal((await (await fetch(`${origin}/api/drafts/delivery-ui/social-deliveries`)).json()).receipts.length, 0);
    await panel.getByRole('link', { name: '连接设置', exact: true }).click();
    await page.getByRole('heading', { name: '连接多平台同步助手', exact: true }).waitFor();
    assert.equal(await page.getByRole('tab', { name: '平台连接', exact: true }).getAttribute('aria-selected'), 'true');
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await stopProcessTree(server); await rm(root, { recursive: true, force: true }); }
});
