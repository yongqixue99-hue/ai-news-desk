const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const domAdapter = globalThis.XiaoheiheDom;
const imagePostDomAdapter = globalThis.XiaoheiheImagePostDom;
const publisherJobAdapter = globalThis.XiaoheihePublisherJob;

const isVisible = (element) => {
  if (!(element instanceof Element)) return false;
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
};

const firstVisible = (selectors) => {
  if (domAdapter) return domAdapter.firstVisible(document, selectors);
  for (const selector of selectors) {
    const match = [...document.querySelectorAll(selector)].find(isVisible);
    if (match) return match;
  }
  return undefined;
};

const readEditableText = (element) => domAdapter?.readEditableText(element)
  || ("value" in element ? String(element.value || "").trim() : String(element.innerText || "").trim());

const exactTextMatches = (text) => [...document.querySelectorAll("button, a, [role='button'], [role='option'], span, div")]
  .filter((element) => isVisible(element) && element.textContent?.trim() === text);

const exactText = (text) => exactTextMatches(text)[0];

const selectedExactText = (text) => exactTextMatches(text).find((element) => {
  if (element.matches('[aria-selected="true"], [aria-checked="true"], [data-state="checked"]')) return true;
  const selectedClass = `${element.className || ""} ${element.parentElement?.className || ""}`;
  return /(?:^|\s)(?:selected|active|checked)(?:\s|$)/i.test(selectedClass);
});

const textMatch = (pattern) => [...document.querySelectorAll("button, a, [role='button'], [role='option'], span")]
  .find((element) => isVisible(element) && pattern.test(element.textContent?.trim() || ""));

const setNativeValue = (element, value) => {
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const selectContents = (element) => {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const fillRichText = (element, html, plainText) => {
  element.focus();
  selectContents(element);
  let inserted = false;
  try {
    inserted = document.execCommand("insertHTML", false, html);
  } catch {
    inserted = false;
  }
  if (!inserted || !readEditableText(element)) element.innerHTML = html;
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertFromPaste",
    data: plainText,
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const fillEditable = (element, value, html = undefined) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, value);
    return;
  }
  fillRichText(element, html || `<p>${String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")}</p>`, value);
};

const fillPlainText = (element, value) => {
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    setNativeValue(element, value);
    return;
  }
  element.focus();
  selectContents(element);
  let inserted = false;
  try {
    // The title editor is also ProseMirror, but its schema is plain text. Using
    // insertHTML here can make it normalize a paragraph boundary and drop the
    // final character. insertText keeps the replacement as one atomic edit.
    inserted = document.execCommand("insertText", false, value);
  } catch {
    inserted = false;
  }
  if (!inserted) element.textContent = value;
  element.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    inputType: "insertText",
    data: value,
  }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
};

const findEditor = () => domAdapter?.findEditor(document) || {
  title: firstVisible(['input[placeholder*="标题"]', 'textarea[placeholder*="标题"]']),
  body: firstVisible([".ProseMirror", '[contenteditable="true"][role="textbox"]', ".ql-editor", '[contenteditable="true"]']),
};

const fillImageDescription = async (resolveImageBox, caption) => {
  const description = String(caption || "").trim().slice(0, 240);
  if (!description) return true;
  let imageBox = resolveImageBox();
  if (!(imageBox instanceof HTMLElement)) return false;
  let editor = domAdapter?.findImageDescriptionEditor(imageBox);
  if (!editor) {
    const placeholder = [...imageBox.querySelectorAll("*")]
      .find((element) => element.textContent?.trim() === "请输入图片描述");
    if (placeholder instanceof HTMLElement) {
      placeholder.click();
      await wait(120);
      imageBox = resolveImageBox() || imageBox;
      editor = domAdapter?.findImageDescriptionEditor(imageBox);
      if (
        !editor
        && document.activeElement instanceof HTMLElement
        && imageBox.contains(document.activeElement)
        && (
          document.activeElement instanceof HTMLInputElement
          || document.activeElement instanceof HTMLTextAreaElement
          || document.activeElement.isContentEditable
        )
      ) {
        editor = document.activeElement;
      }
    }
  }
  if (!(editor instanceof HTMLElement)) return false;
  fillPlainText(editor, description);
  editor.blur();
  await wait(300);
  imageBox = resolveImageBox() || imageBox;
  const currentEditor = domAdapter?.findImageDescriptionEditor(imageBox);
  const normalizedDescription = description.replace(/\s+/g, "");
  const editorText = currentEditor ? readEditableText(currentEditor).replace(/\s+/g, "") : "";
  // Only the actual description editor is authoritative. The image container
  // also contains nearby article text, which previously produced false
  // positives while the placeholder still visibly read “请输入图片描述”.
  return editorText.includes(normalizedDescription);
};

const waitForEditor = async (timeoutMs = 20_000) => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const editor = findEditor();
    if (editor.title && editor.body && editor.title !== editor.body) return editor;
    await wait(250);
  }
  return findEditor();
};

const closeBlockingDialogs = async () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const cancel = [...document.querySelectorAll("button")]
      .find((element) => isVisible(element) && element.textContent?.trim() === "取消");
    if (!cancel) return;
    cancel.click();
    await wait(250);
  }
};

async function ensureEditor() {
  let { title, body: editor } = findEditor();
  if (title && editor && title !== editor) return { title, editor };

  const bodyText = document.body?.innerText || "";
  if (/扫码登录|账号登录|登录后发布|立即登录/.test(bodyText) || /login|signin/i.test(location.href)) {
    return { issue: { name: "登录", ok: false, detail: "请先在这个常用 Chrome 中登录小黑盒，再重新点击填入" } };
  }

  const writeArticle = textMatch(/^(写文章|发布文章)$/);
  if (writeArticle) {
    writeArticle.click();
    ({ title, body: editor } = await waitForEditor());
    if (title && editor && title !== editor) return { title, editor };
  }
  ({ title, body: editor } = await waitForEditor(5_000));
  if (title && editor && title !== editor) return { title, editor };
  const proseMirrorCount = document.querySelectorAll(".ProseMirror").length;
  return {
    issue: {
      name: "编辑器",
      ok: false,
      detail: `小黑盒已打开，但未识别到完整编辑器（找到 ${proseMirrorCount} 个富文本区）；请刷新页面后重试`,
    },
  };
}

async function ensureImagePostEditor() {
  const bodyText = document.body?.innerText || "";
  if (/扫码登录|账号登录|登录后发布|立即登录/.test(bodyText) || /login|signin/i.test(location.href)) {
    return { issue: { name: "登录", ok: false, detail: "请先在这个常用 Chrome 中登录小黑盒，再重新点击填入" } };
  }

  const findFields = () => {
    const adapted = imagePostDomAdapter?.findFields(document);
    if (adapted?.title && adapted?.body && adapted?.upload) {
      return {
        title: adapted.title,
        body: adapted.body,
        imageInput: adapted.upload instanceof HTMLInputElement ? adapted.upload : undefined,
        imageUpload: adapted.upload instanceof HTMLInputElement ? undefined : adapted.upload,
      };
    }
    const title = firstVisible([
      '.editor-title__container [contenteditable="true"]',
      '.editor-image-text__title [contenteditable="true"]',
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable="true"][data-placeholder*="标题"]',
    ]);
    const bodyCandidates = [
      ...document.querySelectorAll([
        '.image-text__edit-content--inner [contenteditable="true"]',
        'textarea[placeholder*="正文"]',
        'textarea[placeholder*="内容"]',
        'textarea[placeholder*="说点"]',
        '[contenteditable="true"][data-placeholder*="正文"]',
        '[contenteditable="true"][data-placeholder*="内容"]',
        '[contenteditable="true"][data-placeholder*="说点"]',
        '[contenteditable="true"][role="textbox"]',
      ].join(",")),
    ].filter((element) => isVisible(element) && element !== title);
    const imageInput = [...document.querySelectorAll('input[type="file"]')]
      .find((element) => !element.disabled && (!element.accept || /image/i.test(element.accept)));
    const imageUpload = firstVisible(['.editor-image-wrapper__box.upload']);
    return { title, body: bodyCandidates[0], imageInput, imageUpload };
  };
  let fields = findFields();
  if (fields.title && fields.body && (fields.imageInput || fields.imageUpload)) return fields;

  const publishContent = textMatch(/^(发布内容|创作内容)$/);
  if (publishContent) {
    publishContent.click();
    await wait(500);
  }
  const publishImagePost = textMatch(/^(发布图文|发图文|写图文)$/);
  if (!publishImagePost) {
    return { issue: { name: "图文编辑器", ok: false, detail: "没有找到“发布图文”入口；请在小黑盒创作者页手动进入发布图文后重试" } };
  }
  publishImagePost.click();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    fields = findFields();
    if (fields.title && fields.body && (fields.imageInput || fields.imageUpload)) return fields;
    await wait(250);
  }
  if (!fields.title || !fields.body || fields.title === fields.body || (!fields.imageInput && !fields.imageUpload)) {
    return { issue: { name: "图文编辑器", ok: false, detail: "已点击发布图文，但未识别到标题和正文输入区" } };
  }
  return fields;
}

async function fillImagePost(job) {
  await closeBlockingDialogs();
  const readiness = await ensureImagePostEditor();
  if (readiness.issue) return { pageUrl: location.href, steps: [readiness.issue] };
  const steps = [];
  try {
    const title = String(job.title || "").trim();
    const scratch = document.createElement("div");
    scratch.innerHTML = String(job.bodyHtml || "");
    const bodyText = (scratch.innerText || scratch.textContent || "").trim();
    fillPlainText(readiness.title, title);
    fillPlainText(readiness.body, bodyText);
    await wait(400);
    const titleOk = readEditableText(readiness.title) === title;
    const bodyOk = readEditableText(readiness.body).replace(/\s+/g, "").includes(bodyText.replace(/\s+/g, ""));
    steps.push({ name: "标题", ok: titleOk, detail: titleOk ? "图文标题已填入并验证" : "图文标题验证失败" });
    steps.push({ name: "正文", ok: bodyOk, detail: bodyOk ? `图文短文已填入并验证（${bodyText.length} 字）` : "图文短文填入后被清空" });
    if (!titleOk || !bodyOk) return { pageUrl: location.href, steps };

    const imageIntegrity = publisherJobAdapter?.validateImagePostPayload(job);
    if (!imageIntegrity?.ok) {
      steps.push({
        name: "配图",
        ok: false,
        detail: String(imageIntegrity?.detail || "图文稿图片完整性模块未加载"),
      });
      return { pageUrl: location.href, steps };
    }
    const image = Array.isArray(job.images) ? job.images[0] : undefined;
    if (!image?.dataUrl) {
      steps.push({ name: "配图", ok: false, detail: "图文稿没有可上传图片" });
      return { pageUrl: location.href, steps };
    }
    const upload = await chrome.runtime.sendMessage({
      type: "AI_NEWS_UPLOAD_XIAOHEIHE_IMAGE_POST",
      payload: image,
    });
    steps.push({
      name: "配图",
      ok: Boolean(upload?.ok),
      detail: String(upload?.detail || "图文图片上传没有返回结果"),
    });
    if (!upload?.ok) return { pageUrl: location.href, steps };
    steps.push(await chooseCommunity(job.community));
    steps.push(await chooseTopics(job.topics));
  } catch (error) {
    steps.push({ name: "页面操作", ok: false, detail: error instanceof Error ? error.message : String(error) });
  }
  return { pageUrl: location.href, steps };
}

async function uploadImages(job) {
  const images = Array.isArray(job.images) ? job.images : [];
  const integrity = publisherJobAdapter?.validateArticleImagePayload(job);
  if (!integrity?.ok) {
    return {
      name: "配图",
      ok: false,
      detail: String(integrity?.detail || "文章图片完整性模块未加载"),
    };
  }
  if (!images.length) return { name: "配图", ok: true, detail: "本稿没有需要上传的图片" };
  const byId = new Map(images.map((image) => [image.id, image]));
  const markers = domAdapter?.findImageMarkers(document, images.map((image) => image.id))
    || [...document.querySelectorAll("[data-ai-news-image]")].map((element) => ({
      id: element.getAttribute("data-ai-news-image"),
      element,
    }));
  const markerIds = markers.map((entry) => String(entry.id || ""));
  const exactDomMarkers = markers.length === images.length
    && new Set(markerIds).size === markerIds.length
    && markerIds.every((id) => byId.has(id));
  if (!exactDomMarkers) {
    return {
      name: "配图",
      ok: false,
      detail: `编辑器图片标记与载荷不一致（找到 ${markers.length} 个位置，需要 ${images.length} 张）`,
    };
  }

  let uploaded = 0;
  const failures = [];
  const uploadedDescriptions = [];
  for (const markerEntry of markers) {
    const marker = markerEntry.element;
    const image = byId.get(markerEntry.id);
    if (!image) continue;
    try {
      const beforeBoxes = new Set(document.querySelectorAll(".article__image-box"));
      const beforeSources = new Set(
        [...document.querySelectorAll(".article__image-box img")]
          .map((element) => element.currentSrc || element.src)
          .filter(Boolean),
      );
      marker.scrollIntoView({ block: "center" });
      const result = await chrome.runtime.sendMessage({
        type: "AI_NEWS_UPLOAD_XIAOHEIHE_IMAGE",
        payload: {
          markerToken: `AIIMG:${image.id}`,
          dataUrl: image.dataUrl,
          fileName: image.fileName,
          mimeType: image.mimeType,
          caption: image.caption,
        },
      });
      if (result?.ok) {
        // Capture this upload while it is still the only source missing from
        // the pre-upload snapshot. Looking for "any new source" later is not
        // safe: the draft image array can differ from article order, so after
        // all uploads the first new DOM image may belong to another caption.
        const captured = domAdapter?.captureInsertedImageBox(document, beforeSources, beforeBoxes);
        const capturedBox = captured?.box;
        const capturedSource = captured?.source || "";
        const resolveImageBox = () => domAdapter?.findImageBoxBySource(document, capturedSource)
          || (capturedBox?.isConnected ? capturedBox : undefined);
        if (!capturedBox || !capturedSource) {
          failures.push("图片已上传，但无法绑定对应的图片描述位置");
          continue;
        }
        uploaded += 1;
        uploadedDescriptions.push({ resolveImageBox, caption: image.caption });
      } else failures.push(String(result?.detail || "图片上传没有返回成功状态"));
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
      // The marker remains visible so the user knows where manual upload is needed.
    }
  }
  // Adding another image makes Xiaoheihe redraw earlier image nodes and can
  // discard descriptions entered too early. Fill all descriptions only after
  // every image is present, then verify the final editor state.
  for (const entry of uploadedDescriptions) {
    if (!await fillImageDescription(entry.resolveImageBox, entry.caption)) {
      failures.push("图片已上传，但图片描述未能填入");
    }
  }
  await wait(500);
  const lostDescription = uploadedDescriptions.find(({ resolveImageBox, caption }) => {
    const imageBox = resolveImageBox();
    if (!(imageBox instanceof HTMLElement)) return true;
    const editor = domAdapter?.findImageDescriptionEditor(imageBox);
    if (!editor) return true;
    const expected = String(caption || "").replace(/\s+/g, "").trim();
    return !readEditableText(editor).replace(/\s+/g, "").includes(expected);
  });
  if (lostDescription || failures.some((failure) => failure.includes("图片描述"))) {
    return {
      name: "配图",
      ok: false,
      detail: `已上传 ${uploaded}/${markers.length} 张，但最终复验发现图片描述没有保留`,
    };
  }
  return {
    name: "配图",
    ok: uploaded === images.length,
    detail: uploaded === images.length
      ? `已上传 ${uploaded} 张图片并填写图片描述`
      : `已上传 ${uploaded}/${images.length} 张；${failures[0] || "其余位置保留了待上传标记"}`,
  };
}

async function chooseCommunity(community) {
  if (!community) return { name: "分区", ok: false, detail: "草稿没有选择分区" };
  const selectedCommunity = () => domAdapter?.findSelectedCommunity(document, community);
  if (selectedCommunity()) return { name: "分区", ok: true, detail: `已是${community}` };
  const trigger = textMatch(/添加社区|选择.*(?:分区|社区)|关联社区/)
    || firstVisible(['[placeholder*="社区"]']);
  if (!trigger) return { name: "分区", ok: false, detail: "没有找到分区选择控件" };
  trigger.click();
  let option;
  for (let attempt = 0; attempt < 20 && !option; attempt += 1) {
    option = domAdapter?.findCommunityOption(document, community);
    if (!option) await wait(250);
  }
  if (!option) {
    const input = firstVisible([
      'input[placeholder*="搜索社区"]',
      'input[placeholder*="社区"]',
    ]);
    if (input instanceof HTMLInputElement) {
      setNativeValue(input, community);
      for (let attempt = 0; attempt < 20 && !option; attempt += 1) {
        option = domAdapter?.findCommunityOption(document, community);
        if (!option) await wait(250);
      }
    }
  }
  if (!option) return { name: "分区", ok: false, detail: `没有找到${community}选项` };
  option.click();
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (selectedCommunity()) return { name: "分区", ok: true, detail: `已选择${community}` };
    await wait(250);
  }
  return { name: "分区", ok: false, detail: `${community}选项已点击，但页面没有显示为已选择` };
}

async function chooseTopics(topics) {
  const missing = [];
  for (const topic of topics || []) {
    const selectedTopic = () => domAdapter?.findSelectedTopic(document, topic);
    if (selectedTopic()) continue;
    const trigger = textMatch(/添加话题|关联话题|选择话题/)
      || firstVisible(['[placeholder*="话题"]']);
    if (!trigger) {
      missing.push(topic);
      continue;
    }
    trigger.click();
    await wait(250);
    const input = firstVisible(['input[placeholder*="话题"]']);
    if (!(input instanceof HTMLInputElement)) {
      missing.push(topic);
      continue;
    }
    setNativeValue(input, topic);
    let option;
    for (let attempt = 0; attempt < 24 && !option; attempt += 1) {
      option = domAdapter?.findTopicOption(document, topic);
      if (!option) await wait(250);
    }
    if (!option) {
      missing.push(topic);
      const cancel = [...document.querySelectorAll("button")]
        .find((element) => isVisible(element) && element.textContent?.trim() === "取消");
      cancel?.click();
      await wait(200);
      continue;
    }
    option.click();
    for (let attempt = 0; attempt < 20 && !selectedTopic(); attempt += 1) await wait(250);
    if (!selectedTopic()) missing.push(topic);
  }
  return {
    name: "话题",
    ok: missing.length === 0,
    detail: missing.length ? `需要手动补充：${missing.join("、")}` : `已处理 ${(topics || []).length} 个话题`,
  };
}

async function fillJob(job) {
  if (job.contentFormat === "image-post") return fillImagePost(job);
  await closeBlockingDialogs();
  const readiness = await ensureEditor();
  if (readiness.issue) return { pageUrl: location.href, steps: [readiness.issue] };
  const steps = [];
  try {
    const title = String(job.title || "");
    let titleEditor = readiness.title;
    fillPlainText(titleEditor, title);
    await wait(300);
    // ProseMirror may replace its root while normalizing the edit. Reacquire it
    // before verification and retry once on the live node when needed.
    titleEditor = findEditor().title || titleEditor;
    let actualTitle = readEditableText(titleEditor);
    if (actualTitle !== title.trim()) {
      fillPlainText(titleEditor, title);
      await wait(300);
      titleEditor = findEditor().title || titleEditor;
      actualTitle = readEditableText(titleEditor);
    }
    const titleOk = actualTitle === title.trim();
    steps.push({
      name: "标题",
      ok: titleOk,
      detail: titleOk ? "标题已填入并验证" : `标题验证失败（页面仍为 ${actualTitle.length} 字）`,
    });

    const bodyHtml = String(job.bodyHtml || "");
    const scratch = document.createElement("div");
    scratch.innerHTML = bodyHtml;
    const expectedBodyText = (scratch.innerText || scratch.textContent || "").replace(/\s+/g, "").trim();
    fillEditable(readiness.editor, expectedBodyText, bodyHtml);
    await wait(500);
    const actualBodyText = readEditableText(readiness.editor).replace(/\s+/g, "");
    const bodyOk = expectedBodyText.length === 0 || actualBodyText.length >= Math.min(expectedBodyText.length, 20);
    steps.push({
      name: "正文",
      ok: bodyOk,
      detail: bodyOk ? `正文已填入并验证（${actualBodyText.length} 字）` : "正文填入后被编辑器清空",
    });

    if (!titleOk || !bodyOk) return { pageUrl: location.href, steps };

    steps.push(await uploadImages(job));
    steps.push(await chooseCommunity(String(job.community || "")));
    steps.push(await chooseTopics(Array.isArray(job.topics) ? job.topics : []));
  } catch (error) {
    steps.push({
      name: "页面操作",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  return { pageUrl: location.href, steps };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "AI_NEWS_FILL_XIAOHEIHE") return undefined;
  fillJob(message.job).then(sendResponse).catch((error) => sendResponse({
    pageUrl: location.href,
    steps: [{
      name: "页面操作",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    }],
  }));
  return true;
});
