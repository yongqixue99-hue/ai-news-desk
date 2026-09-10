import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import net, { type AddressInfo } from "node:net";
import { chromium, type Route } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import { LocalDatabase } from "../../server/local-database.js";
import { defaultHomeLayout } from "../../server/home-layout.js";
import { discoveryFixture } from "../fixtures/discovery.js";

const baseline = process.env.NEWSDESK_UI_BASELINE === "1";

test("discovery reader preserves scope, selection and position without implicit AI", { timeout: 120_000 }, async () => {
  const fixture = discoveryFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-discovery-"));
  await writeFile(path.join(root, "state.json"), JSON.stringify(fixture.state));
  const database = await LocalDatabase.open({ workflowRoot: root });
  database.saveContentPackage(fixture.contentPackage);
  const capturedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  database.saveSourceSnapshot({ urlKey: "source-desk:zhihu-hot:v1", requestedUrl: "https://www.zhihu.com/hot", canonicalUrl: "https://www.zhihu.com/hot", page: { items: [{ id: "123", rank: 29, title: "隔离示例：AI 工具怎样辅助阅读？", heat: "126 万热度", answers: 42, url: "https://www.zhihu.com/question/123" }], capturedAt, attemptedAt: capturedAt, retryAt: capturedAt } });
  database.close();
  const port = await new Promise<number>((resolve) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as AddressInfo).port; s.close(() => resolve(p)); }); });
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ["--import", "tsx", "server/start.ts"], { env: { ...process.env, NODE_ENV: "production", AI_NEWS_DESK_PORT: String(port), AI_NEWS_DESK_WORKFLOW_ROOT: root }, stdio: "ignore", detached: process.platform !== "win32" });
  const browser = await chromium.launch({ executablePath: await findChromeExecutable(), headless: true });
  const shots = path.resolve(process.env.NEWSDESK_UI_SCREENSHOTS || `/tmp/newsdesk-a1-${baseline ? "before" : "after"}`);
  await mkdir(shots, { recursive: true });
  try {
    for (let i = 0; i < 100; i++) { if ((await fetch(`${origin}/api/health`).catch(() => undefined))?.ok) break; await new Promise(r => setTimeout(r, 200)); }
    if (!baseline) {
      const before = await (await fetch(`${origin}/api/product/jobs?limit=12`)).json();
      await fetch(`${origin}/api/today?readOnly=1`);
      await fetch(`${origin}/api/today?readOnly=1`);
      assert.deepEqual(await (await fetch(`${origin}/api/product/jobs?limit=12`)).json(), before, "read-only Today must not enqueue maintenance");
      const materials = await (await fetch(`${origin}/api/stories/${fixture.story.id}/reading`)).json() as Array<{ originalText: string }>;
      assert.equal(materials[0]?.originalText, fixture.contentPackage.sourceEvidence![0]!.originalText, JSON.stringify(materials));
    }
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = []; page.on("pageerror", e => errors.push(e.message));
    const posts: string[] = [];
    let failToday = false;
    let failReading = false;
    let feedOverride: unknown;
    let loadingFeed: (() => void) | undefined;
    await page.addInitScript({ content: `
      const instances = [];
      class TestEvents extends EventTarget { constructor() { super(); instances.push(this); } close() {} }
      Object.defineProperty(window, "EventSource", { value: TestEvents });
      Object.defineProperty(window, "notifyFixtureUpdate", { value: () => instances.forEach(target => target.dispatchEvent(new MessageEvent("workflow", { data: "{}" }))) });
    ` });
    const intercept = async (route: Route) => {
      const request = route.request(); const url = new URL(request.url());
      if (request.method() === "PATCH" && /candidates/.test(url.pathname)) {
        const response = await route.fetch();
        fixture.story.selected = true; fixture.today.pending = [fixture.story];
        return route.fulfill({ response });
      }
      if (request.method() === "POST" && /topic-feeds\/zhihu\/123\/select$/.test(url.pathname)) return route.continue();
      if (request.method() === "POST") { posts.push(url.pathname); return route.fulfill({ status: 503, json: { error: "隔离验收：未调用外部服务" } }); }
      if (url.pathname === "/api/today") return failToday ? route.fulfill({ status: 503, json: { error: "隔离示例：本地查询暂不可用" } }) : route.fulfill({ json: fixture.today });
      if (url.pathname === `/api/stories/${fixture.story.id}/reading` && failReading) return route.fulfill({ status: 503, json: { error: "隔离示例：快照查询失败" } });
      if (url.pathname === "/api/topic-feeds/zhihu" && loadingFeed) await new Promise<void>(resolve => { loadingFeed = resolve; });
      if (url.pathname === "/api/topic-feeds/zhihu" && feedOverride) return route.fulfill({ json: feedOverride });
      if (url.pathname === `/api/stories/${fixture.story.id}`) return route.fulfill({ json: { story: fixture.story, contentPackage: fixture.contentPackage, feedback: [] } });
      return route.continue();
    };
    await page.route("**/api/**", intercept);
    await page.goto(`${origin}/#today`);
    await page.getByRole("tab", { name: "AI 新闻", exact: true }).waitFor();
    await page.getByRole("button", { name: `查看 ${fixture.story.title}`, exact: true }).waitFor();
    if (!baseline) {
      const palette = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(["--accent", "--text", "--muted", "--paper", "--warning"].map(key => [key, style.getPropertyValue(key).trim()]));
      });
      const luminance = (hex: string) => hex.slice(1).match(/.{2}/g)!.map(n => parseInt(n, 16) / 255).map(n => n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4).reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
      const ratios = Object.fromEntries(["--accent", "--text", "--muted", "--warning"].map(key => [key, 1.05 / (luminance(palette[key]!) + 0.05)]));
      for (const [key, ratio] of Object.entries(ratios)) assert.ok(ratio >= 4.5, `${key} on white: ${ratio}`);
      await writeFile(path.join(shots, "contrast.json"), JSON.stringify({ palette, ratios, scope: "Shared text colors against white; accent/white also checks the enabled solid-button pair. This is not a whole-product accessibility certification." }, null, 2));
    }
    await page.screenshot({ path: path.join(shots, "home-1440.png"), fullPage: true });
    const opener = page.getByRole("button", { name: `查看 ${fixture.story.title}`, exact: true });
    await opener.click();
    const reader = page.getByRole("dialog", { name: fixture.story.title, exact: true });
    await reader.waitFor();
    await page.screenshot({ path: path.join(shots, "reader-1440.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: path.join(shots, "reader-390.png") });
    await page.getByRole("button", { name: "关闭事件详情", exact: true }).click();
    await page.screenshot({ path: path.join(shots, "home-390.png"), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/#drafts`);
    await page.getByTestId("draft-editor").locator(".tiptap").waitFor();
    await page.screenshot({ path: path.join(shots, "editor-1440.png"), fullPage: true });
    if (baseline) return;
    await page.goto(`${origin}/#today`);
    await opener.waitFor();
    const tab = (name: string) => page.getByRole("tab", { name, exact: true });
    await tab("AI 新闻").focus(); await page.keyboard.press("ArrowRight");
    assert.equal(await tab("知乎").evaluate(el => el === document.activeElement), true);
    assert.equal(await tab("AI 新闻").getAttribute("aria-selected"), "true");
    await page.keyboard.press("Tab");
    assert.equal(await page.getByRole("tablist", { name: "选题分类" }).evaluate(el => el.contains(document.activeElement)), false);
    const widths = [320, 390, 820, 1280, 1440, 1920];
    const screenshot = async (name: string, fullPage = false) => page.screenshot({ path: path.join(shots, name + ".png"), fullPage });
    const noOverflow = async (label: string) => assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label);
    for (const width of widths) { await page.setViewportSize({ width, height: 900 }); await noOverflow(`home ${width}`); await page.evaluate(() => scrollTo(0, 0)); await screenshot(`home-${width}`); }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByLabel("筛选当前新闻列表").fill("not-present");
    await page.getByText("当前筛选没有结果", { exact: true }).waitFor(); await screenshot("filter-empty");
    await page.getByRole("button", { name: "清除筛选", exact: true }).click();
    await opener.scrollIntoViewIfNeeded(); await opener.focus();
    const originalY = await page.evaluate(() => scrollY);
    await opener.click(); await reader.waitFor();
    const readerTab = (name: string) => reader.getByRole("tab", { name, exact: true });
    await readerTab("原始正文").click(); await reader.getByText(fixture.contentPackage.sourceEvidence![0]!.originalText, { exact: true }).waitFor();
    await screenshot("reader-original");
    await readerTab("事实依据").click(); await reader.getByText("展开原句、位置与日期", { exact: true }).click();
    await reader.getByText("Commercial use requires a separate agreement.", { exact: true }).waitFor(); await screenshot("reader-evidence");
    await readerTab("社区观点").click(); await reader.getByRole("link", { name: /示例评论者/ }).waitFor();
    await reader.getByText(/有限样本，不能代表社区/).waitFor(); await screenshot("reader-community");
    await reader.getByRole("button", { name: "来源侧栏", exact: true }).click();
    await reader.getByRole("complementary", { name: "来源与材料范围" }).waitFor();
    await readerTab("编辑速读").click();
    assert.equal(await reader.getByRole("button", { name: "准备写作", exact: true }).isDisabled(), true);
    for (const width of widths) {
      await page.setViewportSize({ width, height: 900 }); await noOverflow(`reader ${width}`);
      assert.equal(await reader.locator(".story-drawer-body").evaluate(el => el.scrollWidth <= el.clientWidth), true, `reader inner ${width}`);
      await screenshot(`reader-sidebar-${width}`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await reader.getByRole("button", { name: "来源侧栏", exact: true }).click();
    await reader.getByRole("button", { name: "留作选题", exact: true }).click();
    await reader.getByRole("button", { name: "已保留", exact: true }).waitFor();
    await page.goBack(); await reader.waitFor({ state: "hidden" });
    assert.equal(await opener.evaluate(el => el === document.activeElement), true, "reader returns focus to its opener");
    assert.ok(Math.abs(await page.evaluate(() => scrollY) - originalY) < 2, "reader returns to its exact scroll position");
    await page.getByRole("region", { name: "我的待选题", exact: true }).getByRole("button", { name: fixture.story.title }).waitFor();
    const candidate = fixture.story.signals[0]!;
    await page.request.patch(`${origin}/api/runs/${candidate.runId}/candidates/${candidate.candidateId}`, { data: { selected: true } });
    const stored = await (await page.request.get(`${origin}/api/today?readOnly=1`)).json();
    assert.equal(stored.pending.filter((story: { id: string }) => story.id === fixture.story.id).length, 1, "repeat selection uses the same stored topic");
    await page.getByLabel("筛选当前新闻列表").fill("Acme");
    const beforeOrder = await page.locator("[data-story-id]").evaluateAll(elements => elements.map(el => el.getAttribute("data-story-id")));
    fixture.today.mustReads = [...fixture.today.mustReads].reverse();
    fixture.today.mustReads[0]!.lastSeenAt = new Date(Date.now() + 1000).toISOString();
    await page.evaluate(() => (window as unknown as { notifyFixtureUpdate: () => void }).notifyFixtureUpdate());
    await page.getByRole("button", { name: "显示更新", exact: true }).waitFor();
    assert.deepEqual(await page.locator("[data-story-id]").evaluateAll(elements => elements.map(el => el.getAttribute("data-story-id"))), beforeOrder);
    assert.equal(await page.getByLabel("筛选当前新闻列表").inputValue(), "Acme"); await screenshot("new-content");
    await page.getByLabel("筛选当前新闻列表").fill("");
    await page.getByRole("button", { name: "显示更新", exact: true }).click();
    failToday = true; await page.getByRole("button", { name: "重新整理", exact: true }).click();
    await page.getByText("刷新失败，保留上次内容", { exact: true }).waitFor(); await screenshot("refresh-failed"); failToday = false;
    await page.getByRole("button", { name: "重试", exact: true }).click();
    // A failed explicit preparation stays visible without touching a provider.
    fixture.contentPackage.status = "ready"; fixture.contentPackage.blockers = [];
    await opener.click(); await reader.waitFor();
    await reader.getByRole("button", { name: "准备写作", exact: true }).click();
    await reader.getByText("本次准备未完成，选题已保留", { exact: true }).waitFor(); await screenshot("prepare-failed");
    failReading = true; await readerTab("原始正文").click(); await reader.getByText("本地正文读取失败", { exact: true }).waitFor(); await screenshot("reading-failed");
    failReading = false; await reader.getByRole("button", { name: "重试读取快照", exact: true }).click();
    await reader.getByText("本地正文读取失败", { exact: true }).waitFor({ state: "hidden" });
    await reader.getByRole("button", { name: "关闭事件详情", exact: true }).click();
    await page.request.patch(`${origin}/api/home-layout`, { data: { ...defaultHomeLayout, columns: [...defaultHomeLayout.columns, ...["工具实践", "开源项目", "长名称研究栏目", "学习资料"].map((label, i) => ({ id: `custom-fixture-${i}`, label, source: "news", keyword: "fixture" }))] } });
    await page.reload(); await page.getByText("更多", { exact: true }).filter({ has: page.locator("svg") }).first().waitFor();
    await page.locator(".topic-more > summary").click(); await screenshot("column-overflow");
    await page.locator(".topic-more").getByRole("button", { name: "学习资料", exact: true }).click();
    assert.equal(await tab("学习资料").getAttribute("aria-selected"), "true");
    await page.setViewportSize({ width: 320, height: 780 }); await noOverflow("overflow columns 320"); await screenshot("column-overflow-320");
    await tab("知乎").click(); await page.getByText("旧快照", { exact: true }).waitFor(); await screenshot("stale-320");
    await page.getByRole("button", { name: "隔离示例：AI 工具怎样辅助阅读？", exact: true }).click();
    const headline = page.getByRole("dialog", { name: "隔离示例：AI 工具怎样辅助阅读？", exact: true });
    await headline.getByText("正文尚未读取", { exact: true }).waitFor(); await screenshot("headline-320");
    await headline.getByRole("button", { name: "留作选题", exact: true }).click(); await headline.getByRole("button", { name: "已保留", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /我的待选题.*继续写作/ }).click(); await screenshot("queue-320");
    await page.getByRole("button", { name: "关闭选题队列", exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await screenshot("stale-1440");
    for (const status of ["unavailable", "empty", "unread"] as const) {
      feedOverride = { platform: "zhihu", kind: "hotlist", status, items: [], error: status === "unavailable" ? "隔离示例：扩展未连接。" : undefined };
      await tab("AI 新闻").click(); await tab("知乎").click();
      await page.getByText(status === "unavailable" ? "知乎连接待恢复" : status === "empty" ? "本次读取没有选题" : "先读取一份真实热榜", { exact: true }).waitFor(); await screenshot(`feed-${status}`);
    }
    await tab("AI 新闻").click(); loadingFeed = () => undefined; await tab("知乎").click(); await page.getByText("正在读取已保存的选题…", { exact: true }).waitFor(); await screenshot("feed-loading"); loadingFeed(); loadingFeed = undefined;
    // Chromium's isolated profile preference applies actual browser zoom, including media queries.
    const zoomRoot = await mkdtemp(path.join(os.tmpdir(), "newsdesk-zoom-"));
    await mkdir(path.join(zoomRoot, "Default"));
    await writeFile(path.join(zoomRoot, "Default", "Preferences"), JSON.stringify({ partition: { default_zoom_level: { x: Math.log(2) / Math.log(1.2) } } }));
    const zoomContext = await chromium.launchPersistentContext(zoomRoot, { executablePath: await findChromeExecutable(), headless: true, viewport: null, args: ["--window-size=1440,1000"], reducedMotion: "reduce" });
    try {
      await zoomContext.route("**/api/**", intercept);
      const zoomPage = await zoomContext.newPage();
      const zoomCdp = await zoomContext.newCDPSession(zoomPage);
      const zoomShot = async (name: string) => {
        const result = await zoomCdp.send("Page.captureScreenshot", { captureBeyondViewport: false });
        await writeFile(path.join(shots, name + ".png"), Buffer.from(result.data, "base64"));
      };
      zoomPage.on("pageerror", e => errors.push(e.message));
      await zoomPage.goto(`${origin}/#today`);
      const zoomOpener = zoomPage.getByRole("button", { name: `查看 ${fixture.story.title}`, exact: true });
      await zoomOpener.waitFor();
      const geometry = await zoomPage.evaluate(() => ({ outerWidth, innerWidth, devicePixelRatio, overflow: document.documentElement.scrollWidth > innerWidth }));
      assert.equal(geometry.innerWidth, 720); assert.equal(geometry.devicePixelRatio, 2); assert.equal(geometry.overflow, false);
      await writeFile(path.join(shots, "zoom.json"), JSON.stringify(geometry, null, 2));
      await zoomShot("zoom-200-home");
      await zoomOpener.click();
      await zoomPage.getByRole("dialog", { name: fixture.story.title, exact: true }).waitFor();
      assert.equal(await zoomPage.locator(".story-drawer-body").evaluate(el => el.scrollWidth <= el.clientWidth), true);
      await zoomShot("zoom-200-reader");
      await zoomPage.getByRole("button", { name: "关闭事件详情", exact: true }).click();
      await zoomPage.waitForFunction(() => !window.history.state?.newsdeskReader);
      await zoomPage.goto(`${origin}/#drafts`);
      await zoomPage.locator(".draft-pane .tiptap").waitFor();
      assert.equal(await zoomPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await zoomShot("zoom-200-editor");
    } finally { await zoomContext.close(); }
    assert.deepEqual(posts.filter(p => !p.endsWith("/events") && !p.endsWith("/packages")), [], "opening and reading must not trigger generation");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    if (child.pid) { try { if (process.platform !== "win32") process.kill(-child.pid, "SIGTERM"); else child.kill(); } catch {} }
  }
});
