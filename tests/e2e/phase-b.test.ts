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
    assert.equal(await page.getByRole("button", { name: "仅编辑", exact: true }).getAttribute("aria-pressed"), "true");
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
    await page.setViewportSize({ width: 1440, height: 1000 });
    const tools = page.getByRole("navigation", { name: "草稿辅助工具" });
    await tools.getByRole("button", { name: "Agent", exact: true }).click();
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
    assert.deepEqual(errors, []);
    await writeFile(path.join(artifacts, "checks.json"), JSON.stringify({ widths: [1440, 820, 390, 320], confirmed: confirmed.editorialBaseline?.confirmed, assisted: assisted.editorialBaseline?.confirmed, proposalCount, pageErrors: errors }, null, 2));
  } finally {
    await browser?.close(); await stopProcessTree(server); await rm(workflowRoot, { recursive: true, force: true });
  }
});
