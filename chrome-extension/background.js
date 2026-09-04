import { createPublisherBridgeClient } from "./publisher-bridge.js";

const XIAOHEIHE_MATCHES = ["https://xiaoheihe.cn/*", "https://*.xiaoheihe.cn/*"];
const WORKBENCH_ORIGIN = "http://127.0.0.1:4317";
const PUBLISHER_ALARM = "ai-news-publisher-bridge";
const X_POST_URL = /^https:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/i;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForTab(tabId, timeoutMs = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === "complete") return tab;
    await delay(250);
  }
  return chrome.tabs.get(tabId);
}

async function findOrOpenEditor(editorUrl) {
  const existing = await chrome.tabs.query({ url: XIAOHEIHE_MATCHES });
  let tab = existing.find((entry) => entry.active) || existing[0];
  if (!tab?.id) tab = await chrome.tabs.create({ url: editorUrl, active: true });
  else await chrome.tabs.update(tab.id, { active: true });
  if (typeof tab.windowId === "number") {
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
  }
  return waitForTab(tab.id);
}

async function captureActiveXPost() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = String(tab?.url || "");
  const tabMatch = X_POST_URL.exec(tabUrl);
  if (!tab?.id || !tabMatch) throw new Error("请先打开一条单独的 X 原帖，再点击收录");

  const capture = {
    url: `https://x.com/${tabMatch[1]}/status/${tabMatch[2]}`,
    text: "",
    author: `@${tabMatch[1]}`.slice(0, 80),
    capturedAt: new Date().toISOString(),
  };

  const captureId = crypto.randomUUID();
  await chrome.storage.session.set({ [`xCapture:${captureId}`]: capture });
  await chrome.tabs.create({
    url: `${WORKBENCH_ORIGIN}/?xCapture=${encodeURIComponent(captureId)}#workbench`,
    active: true,
  });
  return { ok: true, detail: "原帖链接已收录，正在用官方 oEmbed 提取并进入复核" };
}

async function sendJobToPage(tabId, job) {
  let lastError;
  let injected = false;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const result = await chrome.tabs.sendMessage(tabId, {
        type: "AI_NEWS_FILL_XIAOHEIHE",
        job,
      });
      if (result?.retry) {
        await delay(750);
        continue;
      }
      if (result) return result;
    } catch (error) {
      lastError = error;
      const detail = error instanceof Error ? error.message : String(error);
      if (!injected && /Receiving end does not exist|Could not establish connection/i.test(detail)) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ["xiaoheihe-dom.js", "xiaoheihe-image-post-dom.js", "xiaoheihe.js"],
        });
        injected = true;
        await delay(250);
        continue;
      }
    }
    await delay(500);
  }
  throw lastError || new Error("无法连接小黑盒页面脚本，请刷新小黑盒页面后重试");
}

async function uploadImageInPage(payload) {
  const body = document.querySelector(".article__edit-content--inner .ProseMirror")
    || [...document.querySelectorAll(".ProseMirror")][1]
    || document.querySelector('[contenteditable="true"]');
  if (!(body instanceof HTMLElement)) return { ok: false, detail: "没有找到正文编辑器" };

  const markerCandidates = [...body.querySelectorAll("p, li, blockquote, h2, h3")];
  const marker = markerCandidates.find((element) => element.textContent?.includes(payload.markerToken));
  if (!(marker instanceof HTMLElement)) return { ok: false, detail: "没有找到图片插入位置" };

  const response = await fetch(payload.dataUrl);
  const blob = await response.blob();
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], payload.fileName, { type: payload.mimeType }));
  const container = body.closest(".article__edit-content") || body;
  const beforeBoxes = new Set(body.querySelectorAll(".article__image-box"));
  const markerRect = marker.getBoundingClientRect();
  const eventInit = {
    bubbles: true,
    cancelable: true,
    clientX: markerRect.left + Math.min(20, markerRect.width / 2),
    clientY: markerRect.top + Math.min(12, markerRect.height / 2),
    dataTransfer: transfer,
  };
  container.dispatchEvent(new DragEvent("dragover", eventInit));
  container.dispatchEvent(new DragEvent("drop", eventInit));

  const startedAt = Date.now();
  let insertedBox;
  while (Date.now() - startedAt < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    insertedBox ||= [...body.querySelectorAll(".article__image-box")]
      .find((element) => !beforeBoxes.has(element));
    if (!insertedBox) continue;
    if (insertedBox.querySelector(".article__image-box-failed")) {
      return { ok: false, detail: "小黑盒返回图片上传失败" };
    }
    const uploadedImage = insertedBox.querySelector('img[src^="http"]');
    if (uploadedImage) {
      const clearBlockContents = (element) => {
        if (!(element instanceof HTMLElement) || !element.isConnected) return;
        body.focus();
        const range = document.createRange();
        // Deleting a whole marker paragraph makes Xiaoheihe's ProseMirror keep
        // its first visible character. Replacing the selected contents is an
        // atomic edit instead, so the paragraph can no longer normalize back
        // to a lone opening bracket.
        range.selectNodeContents(element);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        const replaced = document.execCommand("insertText", false, "\u200b");
        if (!replaced) {
          element.replaceChildren(document.createTextNode("\u200b"));
        }
        body.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: "\u200b",
        }));
        body.dispatchEvent(new Event("change", { bubbles: true }));
      };

      // Inserting an image makes ProseMirror redraw the surrounding DOM. The
      // marker reference captured before the upload can therefore be stale;
      // reacquire the current paragraph before deleting it.
      const currentMarker = [...body.querySelectorAll("p, li, blockquote, h2, h3")]
        .find((element) => element.textContent?.includes(payload.markerToken));
      if (currentMarker) {
        clearBlockContents(currentMarker);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }

      // ProseMirror can redraw once more after the deletion. If that happens,
      // clean the current marker again instead of mutating a detached node.
      const redrawnMarker = [...body.querySelectorAll("p, li, blockquote, h2, h3")]
        .find((element) => element.textContent?.includes(payload.markerToken));
      if (redrawnMarker) clearBlockContents(redrawnMarker);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const uploadedUrl = uploadedImage.currentSrc || uploadedImage.src;
      const currentImageBox = [...body.querySelectorAll(".article__image-box")]
        .find((box) => {
          const image = box.querySelector("img");
          return image && (image.currentSrc || image.src) === uploadedUrl;
        }) || uploadedImage.closest(".article__image-box") || insertedBox;
      let adjacentBlocks = [currentImageBox.previousElementSibling, currentImageBox.nextElementSibling]
        .filter((element) => element instanceof HTMLElement);
      const isVisibleMarkerOrphan = (element) => {
        const text = String(element.textContent || "").replaceAll("\u200b", "").trim();
        return text === "【" || text.startsWith("【待上传配图：") || text.includes(payload.markerToken);
      };
      for (const orphan of adjacentBlocks.filter(isVisibleMarkerOrphan)) clearBlockContents(orphan);
      await new Promise((resolve) => setTimeout(resolve, 300));
      const verifiedImageBox = [...body.querySelectorAll(".article__image-box")]
        .find((box) => {
          const image = box.querySelector("img");
          return image && (image.currentSrc || image.src) === uploadedUrl;
        }) || currentImageBox;
      adjacentBlocks = [verifiedImageBox.previousElementSibling, verifiedImageBox.nextElementSibling]
        .filter((element) => element instanceof HTMLElement);
      const markerRemains = [...body.querySelectorAll("p, li, blockquote, h2, h3")]
        .some((element) => element.textContent?.includes(payload.markerToken));
      const visibleOrphanRemains = adjacentBlocks.some(isVisibleMarkerOrphan);
      return markerRemains
        || visibleOrphanRemains
        ? { ok: false, detail: "图片已上传，但定位文字未能完整清除" }
        : { ok: true, detail: "图片已上传并插入" };
    }
  }
  return { ok: false, detail: insertedBox ? "图片上传超时" : "小黑盒没有接收拖入的图片" };
}

async function uploadImagePostInPage(payload) {
  const input = [...document.querySelectorAll('input[type="file"]')]
    .find((element) => !element.disabled && (!element.accept || /image/i.test(element.accept)));
  const uploadDropzone = document.querySelector('.editor-image-wrapper__box.upload');
  if (!(input instanceof HTMLInputElement) && !(uploadDropzone instanceof HTMLElement)) {
    return { ok: false, detail: "没有识别到图文图片上传区域" };
  }
  const before = new Set(
    [...document.querySelectorAll("img")]
      .map((image) => image.currentSrc || image.src)
      .filter(Boolean),
  );
  const response = await fetch(payload.dataUrl);
  const blob = await response.blob();
  const transfer = new DataTransfer();
  transfer.items.add(new File(
    [blob],
    payload.fileName || "image-post.png",
    { type: payload.mimeType || blob.type || "image/png" },
  ));
  if (input instanceof HTMLInputElement) {
    input.files = transfer.files;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  } else if (uploadDropzone instanceof HTMLElement) {
    const rect = uploadDropzone.getBoundingClientRect();
    const eventInit = {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      dataTransfer: transfer,
    };
    uploadDropzone.dispatchEvent(new DragEvent("dragenter", eventInit));
    uploadDropzone.dispatchEvent(new DragEvent("dragover", eventInit));
    uploadDropzone.dispatchEvent(new DragEvent("drop", eventInit));
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const preview = [...document.querySelectorAll("img")].find((image) => {
      const source = image.currentSrc || image.src;
      return source && !before.has(source) && image.getBoundingClientRect().width > 40;
    });
    if (preview) return { ok: true, detail: "图文图片已上传并显示预览" };
    const bodyText = document.body?.innerText || "";
    if (/图片上传失败|上传失败|重新上传/.test(bodyText)) {
      return { ok: false, detail: "小黑盒返回图文图片上传失败" };
    }
  }
  return { ok: false, detail: "图片已选择，但小黑盒没有显示新的图片预览" };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "AI_NEWS_CAPTURE_ACTIVE_X_POST") {
    if (sender.id !== chrome.runtime.id) {
      sendResponse({ ok: false, error: "拒绝非本扩展发起的收录请求" });
      return undefined;
    }
    captureActiveXPost()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "AI_NEWS_GET_X_CAPTURE") {
    if (!sender.url?.startsWith(`${WORKBENCH_ORIGIN}/`)) {
      sendResponse({ ok: false, error: "收录数据只能交给本地工作台" });
      return undefined;
    }
    const captureId = String(message.captureId || "");
    if (!/^[0-9a-f-]{36}$/i.test(captureId)) {
      sendResponse({ ok: false, error: "收录编号无效" });
      return undefined;
    }
    chrome.storage.session.get(`xCapture:${captureId}`)
      .then((items) => sendResponse({ ok: true, capture: items[`xCapture:${captureId}`] }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "AI_NEWS_DELETE_X_CAPTURE") {
    if (!sender.url?.startsWith(`${WORKBENCH_ORIGIN}/`)) {
      sendResponse({ ok: false, error: "收录数据只能由本地工作台删除" });
      return undefined;
    }
    const captureId = String(message.captureId || "");
    chrome.storage.session.remove(`xCapture:${captureId}`)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));
    return true;
  }

  if (message?.type === "AI_NEWS_UPLOAD_XIAOHEIHE_IMAGE_POST") {
    if (!sender.tab?.id || !/^https:\/\/(?:[^/]+\.)?xiaoheihe\.cn\//i.test(sender.url || "")) {
      sendResponse({ ok: false, detail: "图文图片任务不是由小黑盒编辑页发起" });
      return undefined;
    }
    const payload = message.payload || {};
    if (!/^data:image\//i.test(String(payload.dataUrl || ""))) {
      sendResponse({ ok: false, detail: "图文图片数据无效" });
      return undefined;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: uploadImagePostInPage,
      args: [payload],
    }).then((results) => sendResponse(results[0]?.result || {
      ok: false,
      detail: "页面没有返回图文图片结果",
    })).catch((error) => sendResponse({
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type === "AI_NEWS_UPLOAD_XIAOHEIHE_IMAGE") {
    if (!sender.tab?.id || !/^https:\/\/(?:[^/]+\.)?xiaoheihe\.cn\//i.test(sender.url || "")) {
      sendResponse({ ok: false, detail: "图片任务不是由小黑盒编辑页发起" });
      return undefined;
    }
    const payload = message.payload || {};
    if (!/^data:image\//i.test(String(payload.dataUrl || ""))) {
      sendResponse({ ok: false, detail: "图片数据无效" });
      return undefined;
    }
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      world: "MAIN",
      func: uploadImageInPage,
      args: [payload],
    }).then((results) => sendResponse(results[0]?.result || {
      ok: false,
      detail: "页面没有返回图片结果",
    })).catch((error) => sendResponse({
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }));
    return true;
  }

  if (message?.type !== "AI_NEWS_RUN_PUBLISH_JOB") return undefined;
  if (!sender.url?.startsWith("http://127.0.0.1:4317/")) {
    sendResponse({
      steps: [{ name: "安全检查", ok: false, detail: "任务不是由本地工作台发起" }],
    });
    return undefined;
  }
  const editorUrl = String(message.job?.editorUrl || "");
  if (!/^https:\/\/(?:[^/]+\.)?xiaoheihe\.cn\//i.test(editorUrl)) {
    sendResponse({
      steps: [{ name: "安全检查", ok: false, detail: "编辑器地址不是小黑盒官网" }],
    });
    return undefined;
  }

  (async () => {
    const tab = await findOrOpenEditor(editorUrl);
    return sendJobToPage(tab.id, message.job);
  })().then(sendResponse).catch((error) => sendResponse({
    pageUrl: editorUrl,
    steps: [{
      name: "填入助手",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }],
  }));
  return true;
});

const publisherBridge = createPublisherBridgeClient({
  origin: WORKBENCH_ORIGIN,
  clientId: chrome.runtime.id,
  version: chrome.runtime.getManifest().version,
  runJob: async (job) => {
    const editorUrl = String(job?.editorUrl || "");
    if (!/^https:\/\/(?:[^/]+\.)?xiaoheihe\.cn\//i.test(editorUrl)) {
      throw new Error("编辑器地址不是小黑盒官网");
    }
    const tab = await findOrOpenEditor(editorUrl);
    return sendJobToPage(tab.id, job);
  },
});

const runPublisherBridge = () => {
  void publisherBridge.tick().catch((error) => {
    console.warn("[AI 新闻工作台] 后台填入助手暂时无法连接：", error);
  });
};

const ensurePublisherAlarm = () => {
  chrome.alarms.create(PUBLISHER_ALARM, { periodInMinutes: 0.5 });
};

chrome.runtime.onInstalled.addListener(() => {
  ensurePublisherAlarm();
  runPublisherBridge();
});
chrome.runtime.onStartup.addListener(() => {
  ensurePublisherAlarm();
  runPublisherBridge();
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PUBLISHER_ALARM) runPublisherBridge();
});

ensurePublisherAlarm();
runPublisherBridge();
