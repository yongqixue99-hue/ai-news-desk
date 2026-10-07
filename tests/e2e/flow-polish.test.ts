import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import { buildCommunityView } from "../../server/community-view.js";
import { discoveryFixture } from "../fixtures/discovery.js";
import type { EditorialIntakeResult } from "../../src/api.js";

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    server.close(error => error ? reject(error) : resolve(port));
  });
});

test("lightweight community reading and paged history preserve mobile position and refresh failures", { timeout: 120_000 }, async () => {
  const fixture = discoveryFixture();
  const now = new Date().toISOString();
  const template = fixture.state.runs[0]!;
  const themes = ["本地模型的内存占用", "AI 阅读工具的来源保留", "代码助手的文件修改记录", "开源项目的使用条件", "自动化实验的失败原因", "模型评测的适用范围"];
  const candidates = Array.from({ length: 40 }, (_, index) => ({
    ...template.candidates[0]!, id: `community-${index}`, rawId: `community-raw-${index}`,
    title: `Fixture${index} Agent${index} Tool${index} Reader${index}`,
    url: `https://example.test/community/${index}`, sourceRole: "community" as const,
    sourceType: "hackernews" as const, sourceName: "Hacker News",
    publishedAt: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
    engagement: { platform: "hackernews", points: 210 - index * 3, comments: 30 - index % 20, discussionUrl: `https://example.test/discussion/${index}` },
    briefing: { ...template.candidates[0]!.briefing!, titleZh: `隔离示例：${themes[index % themes.length]} · ${index + 1}`, generatedAt: now },
  }));
  fixture.state.runs = [
    { ...template, id: "community-ui", candidates, rawCount: candidates.length },
    ...Array.from({ length: 64 }, (_, index) => ({
      ...template, id: `history-${index}`, origin: "collection" as const,
      createdAt: new Date(Date.now() - (index + 1) * 3_600_000).toISOString(),
      status: index % 3 === 0 ? "failed" as const : "ready" as const,
      stage: index % 3 === 0 ? "隔离示例：一个来源未读完" : "隔离示例：本轮无新候选",
      candidates: [], rawCount: 0,
    })),
  ];
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-flow-ui-"));
  await writeFile(path.join(root, "state.json"), JSON.stringify(fixture.state));
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let output = "";
  const server = spawn(process.execPath, ["--import", "tsx", "server/start.ts"], {
    env: { ...process.env, NODE_ENV: "production", AI_NEWS_DESK_PORT: String(port), AI_NEWS_DESK_WORKFLOW_ROOT: root },
    stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
  });
  server.stdout.on("data", chunk => output += String(chunk));
  server.stderr.on("data", chunk => output += String(chunk));
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const shots = path.resolve(".artifacts/flow-polish-2026-09-30/browser");
  await mkdir(shots, { recursive: true });
  try {
    const deadline = Date.now() + 30_000;
    while (!(await fetch(`${origin}/api/health`).catch(() => undefined))?.ok) {
      if (Date.now() > deadline) throw new Error(`isolated server did not become healthy\n${output}`);
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const response = await fetch(`${origin}/api/community`);
    assert.equal(response.status, 200);
    const view = await response.json() as ReturnType<typeof buildCommunityView>;
    assert.equal(view.feed.items.length, 40);
    assert.deepEqual(Object.keys(view).sort(), ["feed", "settings", "sources"]);
    assert.ok(JSON.stringify(view).length < JSON.stringify(fixture.state).length);
    assert.ok(!("drafts" in view) && !("runs" in view), "reading response does not carry the archive");

    browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
    const requests: string[] = [];
    const errors: string[] = [];
    const intakeRequests: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().startsWith(`${origin}/api/`)) requests.push(new URL(request.url()).pathname); });
    let failCommunity = false;
    let failDraftOpen = false;
    await page.route("**/api/**", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/api/community" && failCommunity) return route.fulfill({ status: 503, json: { error: "隔离示例：刷新查询失败" } });
      if (url.pathname === "/api/bootstrap" && failDraftOpen) return route.fulfill({ status: 503, json: { error: "隔离示例：草稿已生成，打开时连接中断" } });
      if (url.pathname.startsWith("/api/editorial-intakes/") && url.pathname.endsWith("/draft")) return route.fulfill({ json: { job: { id: "draft-open-fixture", status: "complete", result: { draftId: fixture.draft.id } }, draft: fixture.draft } });
      if (url.pathname.startsWith("/api/editorial-intakes/")) {
        const entry = view.feed.items.find(item => item.candidate.id === decodeURIComponent(url.pathname.split("/").at(-1)!))!;
        intakeRequests.push(entry.candidate.id);
        const detail: EditorialIntakeResult = {
          story: { ...fixture.story, title: entry.candidate.briefing!.titleZh, explanation: { ...fixture.story.explanation, status: "ready", readerBrief: "这是一份保留原始来源的隔离阅读示例。", unknowns: [] } },
          contentPackage: fixture.contentPackage, feedback: [],
          intake: { storyId: fixture.story.id, signalId: entry.candidate.id, sourceKind: "linked-community", recommendedIntent: "news", recommendationReason: "先查看关联原文，再决定是否写作。", options: [{ intent: "news", label: "按新闻写", description: "保留事实来源", mode: "brief", available: true, reason: "隔离验收不生成文章", workingCopy: false }] },
        };
        return route.fulfill({ json: detail });
      }
      if (route.request().method() === "POST") return route.fulfill({ status: 503, json: { error: "隔离验收未调用外部平台或 AI" } });
      return route.continue();
    });
    await page.goto(`${origin}/#community`);
    const signals = page.locator(".community-signal-main");
    await signals.first().waitFor();
    assert.equal(await signals.count(), 24);
    assert.equal(await page.locator(".community-reader-slot").isVisible(), false);
    assert.deepEqual(intakeRequests, [], "mobile list does not read the first article before a selection");
    assert.ok(!requests.includes("/api/bootstrap") && !requests.includes("/api/editorial-system"), "cold community does not wait for full workspace bootstrap");
    await page.screenshot({ path: path.join(shots, "community-list-390.png") });
    const selected = signals.nth(14);
    await selected.scrollIntoViewIfNeeded();
    const position = () => page.evaluate(() => ({ windowY: scrollY, mainY: document.querySelector("main")?.scrollTop ?? 0 }));
    const before = await position();
    const title = await selected.locator("strong").textContent();
    await selected.click();
    await page.getByRole("heading", { name: title!, exact: true }).waitFor();
    assert.equal(await page.locator(".community-signal-list").isVisible(), false);
    assert.equal(await page.locator(".community-square-header").isVisible(), false);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(shots, "community-reader-390.png") });
    failDraftOpen = true;
    await page.getByRole("button", { name: /按新闻写/, exact: false }).click();
    await page.getByText("隔离示例：草稿已生成，打开时连接中断", { exact: true }).waitFor();
    assert.equal(new URL(page.url()).hash, "#community", "failed draft opening preserves the current reading view");
    assert.deepEqual(errors, [], "failed navigation is caught instead of rejecting an unhandled promise");
    failDraftOpen = false;
    await page.getByRole("button", { name: "返回热点列表", exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await selected.evaluate(element => element === document.activeElement), true);
    const returned = await position();
    assert.ok(Math.abs(before.windowY - returned.windowY) < 2 && Math.abs(before.mainY - returned.mainY) < 2, `list restores position: ${JSON.stringify({ before, returned })}`);
    await page.getByRole("button", { name: "再看 16 条", exact: true }).click();
    assert.equal(await signals.count(), 40);
    failCommunity = true;
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByText("更新暂未完成，保留当前内容。", { exact: false }).waitFor();
    assert.equal(await signals.count(), 40, "refresh failure keeps the visible reading list");
    failCommunity = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.locator(".community-refresh-error").waitFor({ state: "hidden" });
    for (const width of [320, 850, 1440, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `community ${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole("heading", { name: title!, exact: true }).waitFor();
    assert.equal(await page.locator(".community-signal-list").isVisible(), true);
    assert.equal(await page.getByRole("button", { name: "返回热点列表", exact: true }).isVisible(), false);
    await page.screenshot({ path: path.join(shots, "community-1440.png") });

    await page.goto(`${origin}/#runs`);
    await page.getByRole("heading", { name: "运行记录", exact: true }).waitFor();
    const entries = page.locator(".run-history-entry");
    assert.equal(await entries.count(), 20);
    assert.equal(await page.getByLabel("诊断原文链接").count(), 0, "diagnostic children are not mounted in the history overview");
    await page.screenshot({ path: path.join(shots, "runs-1440.png") });
    await page.getByRole("button", { name: "再看 20 条", exact: true }).click();
    assert.equal(await entries.count(), 40);
    await page.getByLabel("按状态筛选").selectOption("failed");
    assert.equal(await entries.count(), 20, "changing filters resets the visible page");
    await page.getByRole("button", { name: "再看 2 条", exact: true }).click();
    assert.equal(await entries.count(), 22);
    await page.getByLabel("按状态筛选").selectOption("all");
    assert.equal(await entries.count(), 20);
    await page.locator(".run-diagnostic-tools > summary").click();
    await page.getByLabel("诊断原文链接").waitFor({ state: "attached" });
    assert.ok(!requests.includes("/api/source-changes"), "diagnostic disclosures do not read source changes until opened");
    await page.locator(".run-diagnostic-tools > summary").click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => scrollTo(0, 0));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(shots, "runs-390.png") });
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server.exitCode === null && server.signalCode === null) {
      if (process.platform !== "win32" && server.pid) process.kill(-server.pid, "SIGTERM");
      else server.kill("SIGTERM");
    }
    await new Promise<void>(resolve => {
      if (server.exitCode !== null || server.signalCode !== null) return resolve();
      server.once("exit", () => resolve());
      const timer = setTimeout(resolve, 3000); timer.unref();
    });
    if (process.platform !== "win32" && server.pid) {
      try { process.kill(-server.pid, "SIGKILL"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error; }
    } else if (server.exitCode === null && server.signalCode === null) server.kill("SIGKILL");
    server.stdout.destroy(); server.stderr.destroy();
    await rm(root, { recursive: true, force: true });
  }
});
