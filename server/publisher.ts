import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, type Browser, type Locator, type Page } from "playwright-core";
import { insertedMediaIds, publisherBodyHtml } from "./article-html.js";
import { openDebugChrome } from "./chrome-launch.js";
import {
  assertPublicationRevision,
  PublicationRevisionConflictError,
} from "./publication-state.js";
import { inspectDraftImageFile } from "./published-materials.js";
import { updateState, workflowRoot } from "./storage.js";
import type { ArticleDraft, PublisherResult, PublisherStep } from "./types.js";

const chromeProfile = path.join(workflowRoot, "chrome-profile");
let publisherBrowser: Browser | undefined;

const cdpUrl = (port: number, pathName: string) => `http://127.0.0.1:${port}${pathName}`;

/**
 * Chrome can keep its debugging process alive after the last window is closed.
 * In that state /json/version still reports healthy, but Playwright cannot attach
 * because the default browser context no longer has a page. Seed one target first.
 */
export const ensureCdpPage = async (
  port: number,
  targetUrl = "about:blank",
  fetcher: typeof fetch = fetch,
) => {
  const listResponse = await fetcher(cdpUrl(port, "/json/list"), {
    signal: AbortSignal.timeout(1_500),
  });
  if (!listResponse.ok) throw new Error(`Chrome 页面状态返回 ${listResponse.status}`);
  const targets = (await listResponse.json()) as Array<{ type?: string }>;
  if (targets.some((target) => target.type === "page" || target.type === "webview")) return false;

  const createResponse = await fetcher(
    cdpUrl(port, `/json/new?${encodeURIComponent(targetUrl)}`),
    { method: "PUT", signal: AbortSignal.timeout(2_500) },
  );
  if (!createResponse.ok) throw new Error(`Chrome 无法恢复编辑器页面：${createResponse.status}`);
  return true;
};

const connectedPublisherBrowser = async (port: number) => {
  await ensureCdpPage(port);
  if (!publisherBrowser?.isConnected()) {
    publisherBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  }
  return publisherBrowser;
};

const statusUrl = (port: number) => `http://127.0.0.1:${port}/json/version`;

export const publisherStatus = async (port: number) => {
  try {
    const [versionResponse, targetsResponse] = await Promise.all([
      fetch(statusUrl(port), { signal: AbortSignal.timeout(1_500) }),
      fetch(cdpUrl(port, "/json/list"), { signal: AbortSignal.timeout(1_500) }),
    ]);
    if (!versionResponse.ok) return { ok: false, detail: `Chrome 调试端口返回 ${versionResponse.status}` };
    const payload = (await versionResponse.json()) as { Browser?: string };
    const targets = targetsResponse.ok
      ? await targetsResponse.json() as Array<{ type?: string }>
      : [];
    const pageCount = targets.filter((target) => target.type === "page" || target.type === "webview").length;
    return {
      ok: true,
      detail: pageCount
        ? `${payload.Browser ?? "Chrome 已连接"} · ${pageCount} 个页面`
        : `${payload.Browser ?? "Chrome 已连接"} · 编辑器页面将在填入时自动恢复`,
      pageCount,
    };
  } catch {
    return { ok: false, detail: "专用 Chrome 尚未启动" };
  }
};

export const launchPublisherChrome = async (editorUrl: string, port: number) => {
  await mkdir(chromeProfile, { recursive: true });
  const current = await publisherStatus(port);
  if (current.ok) {
    const browser = await connectedPublisherBrowser(port);
    const context = browser.contexts()[0];
    let page = context.pages().find((entry) => /xiaoheihe\.cn/i.test(entry.url()));
    if (!page) page = await context.newPage();
    if (!/xiaoheihe\.cn/i.test(page.url()) || page.url() === "about:blank") {
      await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
    }
    await page.bringToFront();
    return current;
  }
  await openDebugChrome(editorUrl, port, chromeProfile);
  await new Promise((resolve) => setTimeout(resolve, 1_800));
  return publisherStatus(port);
};

const firstVisible = async (locators: Locator[]) => {
  for (const locator of locators) {
    const count = await locator.count();
    for (let index = 0; index < count; index += 1) {
      const candidate = locator.nth(index);
      if (await candidate.isVisible().catch(() => false)) return candidate;
    }
  }
  return undefined;
};

const currentArticleEditors = (page: Page) => page.locator([
  ".editor-title__container .ProseMirror",
  ".hb-cpt__editor-title .ProseMirror",
  ".article__edit-content--inner .ProseMirror",
  ".article__edit-content .ProseMirror",
].join(", "));

const articleEditorReady = async (page: Page) => {
  const editors = currentArticleEditors(page);
  return (await editors.count()) >= 2
    && await editors.nth(0).isVisible().catch(() => false)
    && await editors.nth(1).isVisible().catch(() => false);
};

const fillTitle = async (page: Page, title: string): Promise<PublisherStep> => {
  const input = await firstVisible([
    page.locator('input[placeholder*="标题"]'),
    page.locator('textarea[placeholder*="标题"]'),
    page.getByRole("textbox", { name: /标题/ }),
  ]);
  if (input) await input.fill(title);
  else {
    const editors = currentArticleEditors(page);
    if ((await editors.count()) < 2) return { name: "标题", ok: false, detail: "没有找到标题编辑区" };
    await editors.nth(0).fill(title);
  }
  const actual = input
    ? await input.inputValue().catch(() => "")
    : await currentArticleEditors(page).nth(0).innerText().catch(() => "");
  const ok = actual.trim() === title.trim();
  return {
    name: "标题",
    ok,
    detail: ok ? "标题已填入并验证" : "标题填入后未保留在编辑器中",
  };
};

const ensureEditorPage = async (page: Page): Promise<PublisherStep | undefined> => {
  const titleInput = await firstVisible([
    page.locator('input[placeholder*="标题"]'),
    page.locator('textarea[placeholder*="标题"]'),
  ]);
  if (titleInput || await articleEditorReady(page)) return undefined;
  const writeArticle = await firstVisible([
    page.getByText("写文章", { exact: true }),
    page.getByRole("button", { name: /写文章|发布文章/ }),
    page.getByRole("link", { name: /写文章|发布文章/ }),
  ]);
  if (writeArticle) {
    await writeArticle.click();
    await page.waitForTimeout(1_000);
    const openedTitleInput = await firstVisible([
      page.locator('input[placeholder*="标题"]'),
      page.locator('textarea[placeholder*="标题"]'),
    ]);
    if (openedTitleInput || await articleEditorReady(page)) return undefined;
  }
  const loginMarker = await firstVisible([
    page.getByText(/扫码登录|账号登录|登录后发布/, { exact: false }),
    page.getByRole("button", { name: /登录/ }),
  ]);
  if (loginMarker || /login|signin/i.test(page.url())) {
    return { name: "登录", ok: false, detail: "请先在专用 Chrome 中登录小黑盒，再重新点击填入" };
  }
  return {
    name: "编辑器",
    ok: false,
    detail: "小黑盒页面已打开，但没有找到“写文章”入口；请在页面中手动进入文章编辑器后重试",
  };
};

const fillBody = async (page: Page, draft: ArticleDraft): Promise<PublisherStep> => {
  const currentEditors = currentArticleEditors(page);
  const editor = (await currentEditors.count()) >= 2
    ? currentEditors.nth(1)
    : await firstVisible([
    page.locator('[contenteditable="true"][role="textbox"]'),
    page.locator('[contenteditable="true"]'),
    page.locator(".ql-editor"),
  ]);
  if (!editor) return { name: "正文", ok: false, detail: "没有找到正文编辑器" };
  const html = publisherBodyHtml(draft);
  await editor.evaluate((element, nextHtml) => {
    element.innerHTML = nextHtml;
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText" }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, html);
  await page.waitForTimeout(400);
  const actual = (await editor.innerText().catch(() => "")).replace(/\s+/g, "").trim();
  const ok = actual.length >= 20;
  return {
    name: "正文",
    ok,
    detail: ok ? `正文已填入并验证（${actual.length} 字）` : "正文填入后被编辑器清空",
  };
};

const uploadImages = async (page: Page, draft: ArticleDraft): Promise<PublisherStep> => {
  const usedIds = insertedMediaIds(draft);
  const uploadable = draft.images.filter(
    (placement) => placement.image.localPath && usedIds.has(placement.id),
  );
  if (!usedIds.size) return { name: "配图", ok: true, detail: "本稿没有需要上传的图片" };
  if (uploadable.length !== usedIds.size) {
    return { name: "配图", ok: false, detail: `正文引用 ${usedIds.size} 张图片，但只有 ${uploadable.length} 张有本地记录` };
  }
  for (const placement of uploadable) {
    const inspected = await inspectDraftImageFile(placement);
    if (!inspected.available || !placement.image.fingerprint || inspected.fingerprint !== placement.image.fingerprint) {
      return {
        name: "配图",
        ok: false,
        detail: `图片“${placement.caption}”缺失或文件指纹已变化，请重新插入后再填入`,
      };
    }
  }

  let uploaded = 0;
  let expected = 0;
  for (const placement of uploadable) {
    const markers = page.locator(`[data-ai-news-image="${placement.id}"]`);
    const occurrenceCount = await markers.count();
    expected += occurrenceCount;
    for (let occurrence = 0; occurrence < occurrenceCount; occurrence += 1) {
      const marker = markers.first();
      if (await marker.isVisible().catch(() => false)) await marker.click();
      const imageButton = await firstVisible([
        page.getByRole("button", { name: /图片|插图|上传图片/ }),
        page.locator('[aria-label*="图片"]'),
        page.locator('[title*="图片"]'),
      ]);
      try {
        if (imageButton) {
          const chooserPromise = page.waitForEvent("filechooser", { timeout: 2_500 });
          await imageButton.click();
          const chooser = await chooserPromise;
          await chooser.setFiles(placement.image.localPath!);
        } else {
          const fileInput = page.locator('input[type="file"][accept*="image"]').first();
          if (!(await fileInput.count())) continue;
          await fileInput.setInputFiles(placement.image.localPath!);
        }
        await page.waitForTimeout(1_000);
        if (await marker.count()) await marker.evaluate((element) => element.remove()).catch(() => undefined);
        uploaded += 1;
      } catch {
        // Keep the visible marker so the user can see exactly where the failed image belongs.
      }
    }
  }
  return {
    name: "配图",
    ok: uploaded === expected,
    detail:
      uploaded === expected
        ? `已上传 ${uploaded} 张图片`
        : `已上传 ${uploaded}/${expected} 张；未成功的位置保留了明确标记`,
  };
};

const chooseCommunity = async (page: Page, community: string): Promise<PublisherStep> => {
  if (await page.getByText(community, { exact: true }).count()) {
    return { name: "分区", ok: true, detail: `已是${community}` };
  }
  const trigger = await firstVisible([
    page.getByText(/添加社区|选择.*(?:分区|社区)|关联社区/, { exact: false }),
    page.locator('[placeholder*="社区"]'),
  ]);
  if (!trigger) return { name: "分区", ok: false, detail: "没有找到分区选择控件" };
  await trigger.click();
  const option = page.getByText(community, { exact: true }).last();
  if (!(await option.count())) return { name: "分区", ok: false, detail: `没有找到${community}选项` };
  await option.click();
  return { name: "分区", ok: true, detail: `已选择${community}` };
};

const chooseTopics = async (page: Page, topics: string[]): Promise<PublisherStep> => {
  const missing: string[] = [];
  for (const topic of topics) {
    if (await page.getByText(topic, { exact: true }).count()) continue;
    const trigger = await firstVisible([
      page.getByText(/添加话题|关联话题|选择话题/, { exact: false }),
      page.locator('[placeholder*="话题"]'),
    ]);
    if (!trigger) {
      missing.push(topic);
      continue;
    }
    await trigger.click();
    const input = await firstVisible([
      page.locator('input[placeholder*="话题"]'),
      page.getByRole("textbox").last(),
    ]);
    if (!input) {
      missing.push(topic);
      continue;
    }
    await input.fill(topic);
    await page.waitForTimeout(350);
    const option = page.getByText(topic, { exact: true }).last();
    if (await option.count()) await option.click();
    else await input.press("Enter");
  }
  return {
    name: "话题",
    ok: missing.length === 0,
    detail: missing.length ? `以下话题需要手动补充：${missing.join("、")}` : `已处理 ${topics.length} 个话题`,
  };
};

export const fillXiaoheihe = async (
  draftSnapshot: ArticleDraft,
  expectedRevisionHash: string,
  port: number,
  editorUrl: string,
): Promise<PublisherResult> => {
  assertPublicationRevision(draftSnapshot, "xiaoheihe", expectedRevisionHash);
  const ready = await publisherStatus(port);
  if (!ready.ok) throw new Error("请先启动专用 Chrome，并在其中登录小黑盒");

  let browser: Browser;
  try {
    browser = await connectedPublisherBrowser(port);
  } catch (error) {
    publisherBrowser = undefined;
    const detail = error instanceof Error ? error.message : String(error);
    if (/Browser context management is not supported|Browser\.setDownloadBehavior/i.test(detail)) {
      throw new Error("专用 Chrome 的编辑器窗口已关闭，自动恢复失败。请重新点击“启动小黑盒专用 Chrome”后再填入");
    }
    throw new Error(`无法连接小黑盒专用 Chrome：${detail}`);
  }
  const context = browser.contexts()[0];
  let page = context.pages().find((entry) => /xiaoheihe\.cn/i.test(entry.url()));
  if (!page) page = await context.newPage();
  if (!/xiaoheihe\.cn/i.test(page.url()) || page.url() === "about:blank") {
    await page.goto(editorUrl, { waitUntil: "domcontentloaded" });
  }
  await page.bringToFront();
  const steps: PublisherStep[] = [];
  try {
    const editorIssue = await ensureEditorPage(page);
    if (editorIssue) {
      steps.push(editorIssue);
    } else {
      // Serialize behind pending saves, then compare immediately before the
      // first field is written into the remote editor.
      const currentDraft = await updateState((state) => {
        const draft = state.drafts.find((entry) => entry.id === draftSnapshot.id);
        return draft ? structuredClone(draft) : undefined;
      });
      if (!currentDraft) {
        throw new PublicationRevisionConflictError(
          draftSnapshot.id,
          expectedRevisionHash,
          "draft-missing",
        );
      }
      assertPublicationRevision(currentDraft, "xiaoheihe", expectedRevisionHash);
      steps.push(await fillTitle(page, draftSnapshot.title));
      steps.push(await fillBody(page, draftSnapshot));
      if (steps.find((step) => step.name === "正文")?.ok) {
        steps.push(await uploadImages(page, draftSnapshot));
      }
      steps.push(await chooseCommunity(page, draftSnapshot.community));
      steps.push(await chooseTopics(page, draftSnapshot.topics));
    }
  } catch (error) {
    if (error instanceof PublicationRevisionConflictError) throw error;
    steps.push({
      name: "页面操作",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  const allStepsOk = ["标题", "正文", "配图", "分区", "话题"].every(
    (name) => steps.find((step) => step.name === name)?.ok === true,
  ) && steps.every((step) => step.ok);
  let diagnosticScreenshot: string | undefined;
  if (steps.some((step) => !step.ok)) {
    const logsRoot = path.join(workflowRoot, "logs");
    await mkdir(logsRoot, { recursive: true });
    diagnosticScreenshot = path.join(
      logsRoot,
      `publisher-${draftSnapshot.id}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
    );
    await page.screenshot({ path: diagnosticScreenshot, fullPage: true }).catch(() => {
      diagnosticScreenshot = undefined;
    });
  }
  const result: PublisherResult = {
    at: new Date().toISOString(),
    ok: allStepsOk,
    revisionHash: expectedRevisionHash,
    pageUrl: page.url(),
    community: draftSnapshot.community,
    topics: [...draftSnapshot.topics],
    diagnosticScreenshot,
    steps,
    warning: diagnosticScreenshot
      ? `有步骤未完成，失败现场已保存：${diagnosticScreenshot}。系统不会点击最终发布。`
      : "内容只填入编辑器；系统不会点击最终发布。请检查正文、图片位置、分区和话题。",
  };
  return result;
};
