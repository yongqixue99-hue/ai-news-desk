import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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

test("production routes, strategy controls, completion, draft resumption and mobile navigation remain usable", { timeout: 180_000 }, async () => {
  const workflowRoot = await mkdtemp(path.join(os.tmpdir(), "ai-news-desk-e2e-"));
  const initialState = createDefaultState();
  initialState.settings.scheduleEnabled = false;
  initialState.settings.officialMonitorEnabled = false;
  await writeFile(path.join(workflowRoot, "state.json"), JSON.stringify(initialState));
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
    detached: process.platform !== "win32",
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
    await page.addInitScript(() => {
      Storage.prototype.setItem = () => { throw new DOMException("Storage disabled", "SecurityError"); };
    });
    for (const [route, heading] of [
      ["today", "今日编辑台"],
      ["workbench", "新闻工作台"],
      ["drafts", "文章草稿"],
      ["sources", "新闻源"],
      ["ai-settings", "AI 设置"],
      ["editorial-system", "内容策略"],
    ] as const) {
      await page.goto(`${origin}/#${route}`, { waitUntil: "domcontentloaded" });
      await page.getByRole("heading", { name: heading, exact: true }).waitFor();
      if (route === "today") {
        await page.getByLabel("搜索想写的新闻").waitFor();
        await page.getByRole("button", { name: "搜索最近 7 天", exact: true }).waitFor();
        assert.equal(await page.evaluate(() => performance.getEntriesByType("resource").some((entry) => /article-editor|DraftWorkspace|fonts\.googleapis/u.test(entry.name))), false);
      }
    }

    // These controls use the real isolated API; reload proves persistence.
    await page.getByLabel("内容定位", { exact: true }).fill("解释重要 AI 变化和具体实践");
    await page.getByLabel("写给谁看", { exact: true }).fill("普通科技读者");
    await Promise.all([
      page.waitForResponse((response) => response.url().endsWith("/api/editorial-system/profile") && response.request().method() === "PATCH"),
      page.getByRole("button", { name: "保存写作档案", exact: true }).click(),
    ]);
    for (const label of ["应用写作档案", "应用写作记忆", "参考选题反馈", "启用 Tab 补全"]) {
      await Promise.all([
        page.waitForResponse((response) => response.url().endsWith("/api/settings") && response.request().method() === "PATCH"),
        page.getByRole("checkbox", { name: label, exact: true }).uncheck(),
      ]);
    }
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "内容策略", exact: true }).waitFor();
    assert.equal(await page.getByLabel("内容定位", { exact: true }).inputValue(), "解释重要 AI 变化和具体实践");
    for (const label of ["应用写作档案", "应用写作记忆", "参考选题反馈", "启用 Tab 补全"]) {
      assert.equal(await page.getByRole("checkbox", { name: label, exact: true }).isChecked(), false);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.request.patch(`${origin}/api/settings`, { data: { editorialProfileEnabled: true, writingMemoryEnabled: true, personalizationEnabled: true, inlineCompletionEnabled: true } });

    // Both entry points must use the requested draft, even if it is not first.
    const bootstrapResponse = await page.request.get(`${origin}/api/bootstrap`);
    const state = await bootstrapResponse.json();
    const newest = draftFixture("draft-newest", "第一篇，不应被误打开");
    const requested = draftFixture("draft-requested", "继续编辑指定的草稿");
    requested.images = ["a", "b"].map(id => ({ id, caption: `测试图片 ${id}`, afterParagraph: 0, image: { id, url: `${origin}/gallery-fixture.svg`, caption: `测试图片 ${id}`, sourceUrl: "https://example.com/fixture", attribution: "测试素材", rights: "owned", selected: false } }));
    await page.route("**/gallery-fixture.svg", route => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#dcd9cc"/></svg>' }));
    requested.provenance.contentPackageId = "package-e2e";
    state.aiSettings.completionProviderId = "deepseek";
    state.aiSettings.providers.find((provider: { id: string }) => provider.id === "deepseek").apiKeyConfigured = true;
    let completionCalls = 0;
    await page.route("**/api/drafts/*/completions", (route) => {
      completionCalls += 1;
      return route.fulfill({ contentType: "text/event-stream", body: `event: final\ndata: ${JSON.stringify({ available: true, text: "接口已经开放。", providerName: "测试补全" })}\n\n` });
    });
    const savedEdits: Array<Partial<ArticleDraft>> = [];
    await page.route("**/api/drafts/draft-requested", (route) => {
      const patch = route.request().postDataJSON();
      savedEdits.push(patch);
      return route.fulfill({ json: { ...requested, ...patch } });
    });
    const now = new Date().toISOString();
    await page.route("**/api/bootstrap", (route) => route.fulfill({ json: { ...state, drafts: [newest, requested] } }));
    await page.route("**/api/drafts/overview", (route) => route.fulfill({ json: {
      total: 2, recent: [{ id: requested.id, title: requested.title, status: requested.status, updatedAt: now }],
    } }));
    const jobs = [{
      id: "completed-job", type: "draft-from-package", idempotencyKey: "test-job", status: "complete",
      payload: {}, result: { draftId: requested.id }, progress: 1, attempts: 1, maxAttempts: 1,
      createdAt: now, updatedAt: now,
    }];
    await page.route("**/api/product/jobs?*", (route) => route.fulfill({ json: jobs }));
    await page.route("**/api/events", (route) => route.fulfill({
      status: 200, contentType: "text/event-stream", body: `event: jobs\ndata: ${JSON.stringify(jobs)}\n\n`,
    }));
    await page.goto(`${origin}/#today`, { waitUntil: "domcontentloaded" });
    // Hash navigation keeps the shell's original SSE connection alive. Reload
    // once so the isolated job fixture is used by that persistent subscription.
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "待编辑 继续编辑指定的草稿", exact: true }).click();
    await page.getByLabel("文章标题", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("文章标题", { exact: true }).inputValue(), requested.title);

    await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "今日", exact: true }).click();
    await page.getByRole("complementary", { name: "后台任务中心" }).getByRole("button", { name: /最近任务|任务状态读取失败/u }).click();
    await page.getByRole("complementary", { name: "后台任务中心" }).getByRole("button", { name: "打开草稿", exact: true }).click();
    await page.getByLabel("文章标题", { exact: true }).waitFor();
    assert.equal(await page.getByLabel("文章标题", { exact: true }).inputValue(), requested.title);

    // The sidebar shortcut must not steal Bold from a nested rich-text node.
    await page.locator(".tiptap p").first().click();
    await page.keyboard.press("Control+b");
    assert.equal(await page.locator(".app-shell.sidebar-expanded").count(), 1);
    const prose = page.getByLabel("连续文章编辑器", { exact: true }).first();
    await prose.click();
    await page.keyboard.press("Control+End");
    await page.getByRole("button", { name: "续写一次", exact: true }).click();
    await page.locator(".inline-completion-ghost").waitFor();
    const beforeCompletion = await prose.innerText();
    await page.keyboard.press("Escape");
    assert.equal(await page.locator(".inline-completion-ghost").count(), 0);
    const dismissedCalls = completionCalls;
    await prose.blur();
    await prose.focus();
    await page.waitForTimeout(1100);
    assert.equal(completionCalls, dismissedCalls, "dismissed completion does not immediately reappear on focus");
    await page.getByRole("button", { name: "续写一次", exact: true }).click();
    await page.locator(".inline-completion-ghost").waitFor();
    await page.keyboard.press("Tab");
    assert.equal(await page.locator(".inline-completion-ghost").count(), 0);
    assert.ok((await prose.innerText()).includes("接口已经开放。"));
    await page.keyboard.press("Control+z");
    assert.ok(!(await prose.innerText()).includes("接口已经开放。"), "one undo removes accepted completion");
    assert.ok(beforeCompletion.includes("用于核对草稿"));
    await page.getByRole("button", { name: "Tab 续写开关", exact: true }).click();
    const offCalls = completionCalls;
    await prose.click();
    await page.keyboard.press("End");
    await page.keyboard.type("more words");
    await page.waitForTimeout(1100);
    assert.equal(completionCalls, offCalls, "disabled completion makes no requests");

    // Format and gallery order must participate in autosave while preserving the article.
    const articleBeforeGallery = await prose.innerHTML();
    await page.getByRole("navigation", { name: "草稿辅助工具" }).getByRole("button", { name: "发布", exact: true }).click();
    await page.locator(".platform-options").getByRole("button", { name: /小黑盒/u }).click();
    await page.getByRole("group", { name: "小黑盒发送形式" }).getByRole("button", { name: /图文/u }).click();
    await page.getByRole("button", { name: "加入图集：测试图片 a", exact: true }).click();
    await page.getByRole("button", { name: "加入图集：测试图片 b", exact: true }).click();
    await page.getByRole("button", { name: "图片 2 上移", exact: true }).click();
    const gallerySaved = page.waitForResponse(response => response.url().endsWith("/api/drafts/draft-requested") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await gallerySaved;
    assert.equal(savedEdits.at(-1)?.contentFormat, "image-post");
    assert.deepEqual(savedEdits.at(-1)?.imagePostImageIds, ["b", "a"]);
    assert.equal(await prose.innerHTML(), articleBeforeGallery);
    await page.getByRole("group", { name: "小黑盒发送形式" }).getByRole("button", { name: /文章/u }).click();
    const articleSaved = page.waitForResponse(response => response.url().endsWith("/api/drafts/draft-requested") && response.request().method() === "PATCH");
    await page.getByRole("button", { name: "保存草稿", exact: true }).click();
    await articleSaved;
    assert.equal(savedEdits.at(-1)?.contentFormat, "article");
    assert.deepEqual(savedEdits.at(-1)?.imagePostImageIds, ["b", "a"]);
    assert.equal(await prose.innerHTML(), articleBeforeGallery);

    const fixtureState = createDefaultState();
    const candidate = rawItemToCandidate({ id: "release", title: "OpenAI released GPT-6 Astra", url: "https://openai.com/index/gpt-6-astra/", published_at: new Date().toISOString(), fetched_at: new Date().toISOString(), content: "OpenAI released GPT-6 Astra. The official page includes capability benchmarks.", source_type: "rss", metadata: { feed_name: "OpenAI", source_role: "official" } }, 48, ["ai"]);
    candidate.briefing = { titleZh: "模型发布阅读器回归检查", summaryZh: "此条仅用于浏览器测试。", basis: "full-source", generatedAt: new Date().toISOString(), providerId: "test" };
    fixtureState.runs = [{ id: "reader-test", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "ready", stage: "完成", windowHours: 48, sourceIds: [], scheduled: false, rawCount: 1, candidates: [candidate], logs: [] }];
    const readerToday = buildTodayView(fixtureState);
    const readerStory = readerToday.releaseHighlights![0]!;
    readerStory.explanation.status = "ready";
    readerStory.images = Array.from({ length: 4 }, (_, index) => ({ id: `figure-${index}`, url: `${origin}/fixture-chart.svg`, publicPath: "/fixture-chart.svg", localPath: "/fixture-only", sourceUrl: candidate.url, caption: `能力图表 ${index + 1}`, attribution: "测试来源", width: 900, height: 500, rights: "editorial-screenshot", captureKind: index === 1 ? "table" : "chart", selected: true }));
    readerStory.imageCount = readerStory.localImageCount = 4;
    await page.route("**/fixture-chart.svg", (route) => route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500"><rect width="900" height="500" fill="#eeeee8"/><text x="50" y="80" font-size="28">Capability chart fixture</text></svg>' }));
    await page.route("**/api/today", (route) => route.fulfill({ json: readerToday }));
    await page.route(`**/api/stories/${readerStory.id}`, (route) => route.fulfill({ json: { story: readerStory, feedback: [], assetCollection: { sourceReports: [{ url: candidate.url, status: "partial", imageCount: 4, screenshotCount: 2, detail: "部分原图下载失败，已保留原链接" }] } } }));
    await page.route(`**/api/stories/${readerStory.id}/events`, (route) => route.fulfill({ json: {} }));
    let collected = false;
    await page.route(`**/api/stories/${readerStory.id}/assets`, (route) => {
      collected = true;
      return route.fulfill({ json: { job: { id: "asset-collection-test", type: "hydrate-story-assets", status: "complete", progress: 1, payload: { storyId: readerStory.id, scope: "article" }, result: { imageCount: 4 } }, reused: false } });
    });
    await page.getByRole("navigation", { name: "主导航", exact: true }).getByRole("button", { name: "今日", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("region", { name: "近期重要发布" }).getByRole("button").click();
    const reader = page.getByRole("dialog", { name: "模型发布阅读器回归检查" });
    await reader.waitFor();
    assert.equal(await reader.locator(".story-package-builder").getAttribute("open"), null);
    await reader.getByRole("navigation", { name: "事件视图" }).getByRole("button", { name: /图片与图表/u }).click();
    assert.equal(await reader.locator(".asset-contact-sheet button").count(), 4);
    await reader.getByRole("button", { name: "下一张图片", exact: true }).click();
    assert.equal(await reader.locator(".asset-kind").textContent(), "评测表格");
    assert.equal(await reader.getByRole("link", { name: "打开原文出处", exact: true }).getAttribute("href"), candidate.url);
    await reader.getByRole("button", { name: "收集原文图片与图表", exact: true }).click();
    await reader.getByText("这篇原文仍有素材缺口", { exact: true }).waitFor();
    assert.equal(collected, true);
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await reader.locator(".story-drawer-body").evaluate((element) => element.scrollWidth <= element.clientWidth), true);
    await reader.getByRole("button", { name: "关闭事件详情", exact: true }).click();
    const nav = page.getByRole("navigation", { name: "主导航", exact: true });
    assert.equal(await nav.getByRole("button").count(), 5);
    for (const label of ["今日", "新闻工作台", "社区广场", "草稿", "更多"]) {
      assert.equal(await nav.getByText(label, { exact: true }).isVisible(), true, `${label} is visible on mobile`);
    }
    const more = nav.getByRole("button", { name: "更多功能", exact: true });
    await more.click();
    await page.keyboard.press("Escape");
    assert.equal(await more.evaluate((button) => button === document.activeElement), true);
    assert.equal(await more.getAttribute("aria-expanded"), "false");
    await more.click();
    await page.locator("#mobile-more-panel").getByRole("button", { name: "运行记录", exact: true }).click();
    assert.equal(new URL(page.url()).hash, "#runs");
    await page.goBack();
    await page.getByRole("heading", { name: "今日编辑台", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(pageErrors, []);
  } finally {
    await browser?.close();
    await stopProcessTree(server);
    await rm(workflowRoot, { recursive: true, force: true });
  }
});
