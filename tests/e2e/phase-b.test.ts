import { appendDraftRevision } from "../../server/draft-revisions.js";
import { draftDocumentKey } from "../../server/draft-document.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import type { ArticleDraft } from "../../server/types.js";
import { createDefaultState } from "../../server/defaults.js";
import { rawItemToCandidate } from "../../server/scoring.js";
import { buildTodayView } from "../../server/story-desk.js";
import { LocalDatabase } from "../../server/local-database.js";

const draftFixture = (id: string, title: string): ArticleDraft => ({
  id, title, candidateId: id, runId: "test-run", status: "editing",
  createdAt: "2026-09-05T00:00:00Z", updatedAt: "2026-09-05T00:00:00Z",
  paragraphs: ["用于核对草稿打开行为的测试正文。"], bodyHtml: "<p>用于核对草稿打开行为的测试正文。</p>",
  take: "", sources: [], uncertainties: [], images: [], community: "", topics: [],
  provenance: { originalUrl: `https://example.com/${id}`, generatedBy: "codex-cli", authoringMode: "human-first" },
});

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

test("stage B editor saves, confirms, expires proposals and recovers without live AI", { timeout: 180_000 }, async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "newsdesk-phase-b-"));
  const artifacts = path.resolve(".artifacts/phase-b/browser");
  await mkdir(artifacts, { recursive: true });
  const state = createDefaultState();
  state.settings.scheduleEnabled = false; state.settings.officialMonitorEnabled = false;
  state.settings.inlineCompletionEnabled = false;
  state.sources.forEach((source) => { source.enabled = false; source.selected = false; });
  const draft = draftFixture("phase-b-draft", "阶段 B 编辑确认测试");
  draft.provenance.contentPackageId = "phase-b-package";
  state.drafts = [draft];
  appendDraftRevision(state, draft, "initial");
  await writeFile(path.join(workflowRoot, "state.json"), JSON.stringify(state));
  const port = await freePort(); const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const server = spawn(process.execPath, ["--import", "tsx", "server/start.ts"], {
    cwd: process.cwd(), env: { ...process.env, NODE_ENV: "production", AI_NEWS_DESK_PORT: String(port), AI_NEWS_DESK_WORKFLOW_ROOT: workflowRoot, NO_COLOR: "1" },
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  server.stdout.on("data", (chunk) => { output += String(chunk); }); server.stderr.on("data", (chunk) => { output += String(chunk); });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    await waitForHealth(origin, () => output);
    browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message));
    let proposalCount = 0;
    await page.route("**/api/drafts/*/agent/threads", async (route) => {
      if (route.request().method() === "GET") return route.fulfill({ json: [] });
      const input = route.request().postDataJSON().draft;
      const persisted = await (await page.request.get(`${origin}/api/drafts/${draft.id}`)).json() as ArticleDraft;
      const current = { ...persisted, ...input, provenance: persisted.provenance };
      proposalCount++;
      return route.fulfill({ json: {
        id: `proposal-${proposalCount}`, draftId: draft.id, role: "optimization", providerId: "fixture", providerName: "隔离测试", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        sourceSnapshot: { url: draft.provenance.originalUrl, title: draft.title, text: draft.paragraphs[0], method: "content-package", capturedAt: draft.createdAt },
        draftSnapshot: { title: current.title, text: current.paragraphs.join("\n"), capturedAt: current.updatedAt, documentKey: draftDocumentKey(current) }, messages: [],
        optimization: { strategy: "brief", editMode: "minimal", diagnosis: [], improvements: [], diagnostics: [], preservedBlockIds: [], factCheckPassed: true, rollbackRecommended: false, factWarnings: [],
          changes: [{ id: `change-${proposalCount}`, blockId: "paragraph:0", before: draft.paragraphs[0], after: "这是经过逐项审阅后采用的测试正文。", reason: "简化措辞", affectedFactIds: [], factCheckPassed: true, factWarnings: [] }] },
      } });
    });
    // No provider or page extraction can be reached through browser actions in this test.
    await page.route("**/api/drafts/*/completions", (route) => route.fulfill({ json: { available: false, reason: "隔离测试" } }));
    await page.goto(`${origin}/#drafts`, { waitUntil: "domcontentloaded" });
    const editor = page.getByRole("textbox", { name: "连续文章编辑器" });
    await editor.waitFor();
    assert.equal(await page.getByRole("button", { name: "编辑", exact: true }).getAttribute("aria-pressed"), "true");
    assert.equal(await page.getByRole("region", { name: "文章内容预览" }).count(), 0);
    const title = page.getByLabel("文章标题", { exact: true });
    await title.fill("人工修改后的确认标题");
    await page.waitForResponse((response) => response.url() === `${origin}/api/drafts/${draft.id}` && response.request().method() === "PATCH" && response.ok());
    await Promise.all([page.waitForResponse((response) => response.url().endsWith(`/${draft.id}/confirm`) && response.ok()), page.getByRole("button", { name: "确认定稿", exact: true }).click()]);
    const confirmed = await (await page.request.get(`${origin}/api/drafts/${draft.id}`)).json() as ArticleDraft;
    assert.equal(confirmed.editorialBaseline?.initial.snapshot.title, draft.title);
    assert.equal(confirmed.editorialBaseline?.confirmed?.snapshot.title, "人工修改后的确认标题");
    assert.equal(confirmed.editorialBaseline?.confirmed?.learningEligible, true);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByText(/已确认/u).first().waitFor();
    for (const width of [1440, 820, 390, 320]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(() => window.scrollTo(0, 0));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `editor at ${width}px`);
      assert.ok((await title.boundingBox())!.y >= 0, "title is not clipped above the screen");
      await page.screenshot({ path: path.join(artifacts, `editor-${width}.png`), fullPage: true });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const libraryButton = page.getByRole("button", { name: /^草稿库/u });
    if (await libraryButton.getAttribute("aria-expanded") !== "true") await libraryButton.click();
    const library = page.getByRole("complementary", { name: "草稿库", exact: true });
    const tools = page.getByRole("navigation", { name: "草稿辅助工具" });
    const libraryBounds = (await library.boundingBox())!;
    assert.ok(libraryBounds.y + libraryBounds.height <= (await tools.boundingBox())!.y + 1, "library must not cover the mobile tools");
    await tools.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page.getByRole("tabpanel", { name: "AI 助手面板", exact: true }).waitFor();
    assert.equal(await library.isVisible(), false);
    await page.getByRole("button", { name: "关闭右侧面板", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await tools.getByRole("button", { name: "AI 助手", exact: true }).click();
    await page.getByRole("tab", { name: "优化文稿", exact: true }).click();
    await page.getByRole("button", { name: "检查并优化文稿", exact: true }).click();
    await page.getByRole("button", { name: "应用此项", exact: true }).waitFor();
    await title.fill("建议生成后的新标题");
    await page.getByRole("button", { name: "应用此项", exact: true }).click();
    await page.getByText("正文或素材版本已变化，旧建议已过期，请重新生成修改建议", { exact: true }).waitFor();
    assert.equal(await editor.textContent(), draft.paragraphs[0]);
    await page.screenshot({ path: path.join(artifacts, "expired-proposal.png"), fullPage: true });
    await page.getByRole("button", { name: "重新运行", exact: true }).click();
    await page.getByRole("button", { name: "应用此项", exact: true }).click();
    await page.getByRole("button", { name: "撤销上次 AI 修改", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.tiptap')?.textContent?.includes("逐项审阅"));
    await page.screenshot({ path: path.join(artifacts, "accepted-proposal.png"), fullPage: true });
    await page.getByRole("button", { name: "撤销上次 AI 修改", exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.tiptap')?.textContent?.includes("核对草稿"));
    await Promise.all([page.waitForResponse((response) => response.url().endsWith(`/${draft.id}/confirm`) && response.ok()), page.getByRole("button", { name: "确认定稿", exact: true }).click()]);
    const assisted = await (await page.request.get(`${origin}/api/drafts/${draft.id}`)).json() as ArticleDraft;
    assert.equal(assisted.editorialBaseline?.confirmed?.learningEligible, false);
    await tools.getByRole("button", { name: "版本", exact: true }).click();
    await page.getByRole("heading", { name: "初稿 → 确认稿", exact: true }).waitFor();
    assert.ok(await page.locator(".confirmation-diff-lines .diff-added").count());
    await page.screenshot({ path: path.join(artifacts, "confirmation-diff.png"), fullPage: true });
    // Library actions use the real API in this isolated workspace, including autosave and stale tabs.
    await page.getByRole("button", { name: "新建草稿", exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="文章标题"]')?.value === "");
    await title.fill("手写新草稿");
    await editor.fill("这是在空白草稿里手写的内容。");
    // Delete immediately, before the debounced autosave: deletion must first preserve the edit.
    await page.getByRole("button", { name: "删除当前草稿", exact: true }).click();
    const deletion = page.getByRole("dialog", { name: "删除这篇草稿？" });
    await deletion.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(await title.inputValue(), "手写新草稿");
    await page.getByRole("button", { name: "删除当前草稿", exact: true }).click();
    await deletion.getByRole("button", { name: "确认删除", exact: true }).click();
    await deletion.waitFor({ state: "hidden" });
    const trash = await (await page.request.get(`${origin}/api/draft-trash`)).json();
    assert.equal(trash.length, 1);
    assert.equal(trash[0].title, "手写新草稿");
    assert.equal((await page.request.patch(`${origin}/api/drafts/${trash[0].id}`, { data: { title: "迟到的自动保存", updatedAt: trash[0].updatedAt } })).status(), 404);
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await page.getByRole("button", { name: "恢复 手写新草稿", exact: true }).click();
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="文章标题"]')?.value === "手写新草稿");
    assert.ok((await editor.innerText()).includes("这是在空白草稿里手写的内容。"));
    assert.ok((await title.boundingBox())!.y > (await page.getByRole("group", { name: "草稿管理" }).boundingBox())!.y, "restored title must be visible below library actions");
    const stale = await page.request.patch(`${origin}/api/drafts/${trash[0].id}`, { data: { title: "恢复前的旧保存", updatedAt: trash[0].updatedAt } });
    assert.equal(stale.ok(), false);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "清空草稿", exact: true }).click();
    const clear = page.getByRole("dialog", { name: "清空 2 篇草稿？" });
    await clear.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "清空草稿", exact: true }).click();
    await clear.getByRole("button", { name: "确认清空", exact: true }).click();
    await page.getByRole("heading", { name: "还没有草稿", exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "还没有草稿", exact: true }).waitFor();
    const overview = await (await page.request.get(`${origin}/api/drafts/overview`)).json();
    assert.equal(JSON.stringify(overview).includes("手写新草稿"), false);
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      for (const label of ["新建草稿", "删除当前草稿", "清空草稿", "回收站"]) {
        assert.equal(await page.getByRole("button", { name: label, exact: true }).isVisible(), true);
      }
      await page.screenshot({ path: path.join(artifacts, `library-empty-${width}.png`), fullPage: true });
    }
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await page.getByRole("button", { name: "恢复 手写新草稿", exact: true }).click();
    await editor.waitFor();
    await page.screenshot({ path: path.join(artifacts, "library-restored-mobile.png"), fullPage: true });
    // Focus mode works on a narrow screen and restores the regular management controls.
    await page.getByRole("button", { name: "专注写作", exact: true }).click();
    assert.equal(await page.getByRole("group", { name: "草稿管理" }).isVisible(), false);
    assert.equal(await page.locator(".main-sidebar").isVisible(), false);
    assert.equal(await page.getByRole("button", { name: "退出专注", exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(artifacts, "focus-mobile.png"), fullPage: true });
    await page.keyboard.press("Escape");
    assert.equal(await page.getByRole("group", { name: "草稿管理" }).isVisible(), true);
    // The article's own images are first; changing image tabs preserves an unfinished URL.
    await tools.getByRole("button", { name: "图片", exact: true }).click();
    assert.equal(await page.getByRole("tab", { name: /^本稿配图/u }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("heading", { name: "通用素材库", exact: true }).isVisible(), false);
    await page.getByRole("tab", { name: "添加图片", exact: true }).click();
    await page.getByPlaceholder("图片 URL", { exact: true }).fill("https://example.com/unfinished.png");
    await page.getByRole("tab", { name: "通用素材", exact: true }).click();
    await page.getByRole("tab", { name: "添加图片", exact: true }).click();
    assert.equal(await page.getByPlaceholder("图片 URL", { exact: true }).inputValue(), "https://example.com/unfinished.png");
    await page.getByRole("button", { name: "关闭右侧面板", exact: true }).click();
    // Bulk restore, body search and multi-select all use the isolated real API.
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await page.getByRole("button", { name: "恢复当前结果 (1)", exact: true }).click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "hidden" });
    await page.setViewportSize({ width: 1440, height: 1000 });
    if (await libraryButton.getAttribute("aria-expanded") !== "true") await libraryButton.click();
    await page.getByLabel("搜索草稿", { exact: true }).fill("空白草稿里手写");
    assert.equal(await page.locator(".draft-list-item").count(), 1);
    await page.getByRole("button", { name: "多选", exact: true }).click();
    await page.getByRole("checkbox", { name: "全选当前结果", exact: true }).check();
    assert.equal(await page.getByRole("button", { name: "删除选中 (1)", exact: true }).isEnabled(), true);
    await page.getByLabel("搜索草稿", { exact: true }).fill("");
    assert.equal(await page.getByRole("button", { name: "删除选中 (0)", exact: true }).isEnabled(), false);
    await page.getByLabel("草稿排序", { exact: true }).selectOption("title");
    await page.getByRole("button", { name: "取消多选", exact: true }).click();
    await page.locator(".draft-list-item").filter({ hasText: "手写新草稿" }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector<HTMLTextAreaElement>('[aria-label="文章标题"]')?.value === "手写新草稿");
    await page.getByRole("button", { name: "多选", exact: true }).click();
    await page.getByRole("checkbox", { name: "全选当前结果", exact: true }).check();
    await page.getByRole("button", { name: "删除选中 (2)", exact: true }).click();
    const batchDialog = page.getByRole("dialog", { name: "删除选中的 2 篇草稿？" });
    assert.equal(await batchDialog.getByRole("listitem").count(), 2);
    await batchDialog.getByRole("button", { name: "确认删除", exact: true }).click();
    await page.getByRole("heading", { name: "还没有草稿", exact: true }).waitFor();
    await page.getByRole("button", { name: "回收站", exact: true }).click();
    await page.getByLabel("搜索回收站").fill("手写");
    await page.getByRole("button", { name: "恢复当前结果 (1)", exact: true }).click();
    await page.getByRole("button", { name: "确认恢复", exact: true }).click();
    await editor.waitFor();
    assert.equal((await (await page.request.get(`${origin}/api/draft-trash`)).json()).length, 1, "filtered restore leaves unrelated trash alone");
    assert.deepEqual(errors, []);
    await writeFile(path.join(artifacts, "checks.json"), JSON.stringify({ widths: [1440, 820, 390, 320], confirmed: confirmed.editorialBaseline?.confirmed, assisted: assisted.editorialBaseline?.confirmed, proposalCount, pageErrors: errors }, null, 2));
  } finally {
    await browser?.close(); await stopProcessTree(server); await rm(workflowRoot, { recursive: true, force: true });
  }
});
