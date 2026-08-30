(function initXiaoheiheDom(global) {
  const selectors = {
    legacyTitle: [
      'input[placeholder*="标题"]',
      'textarea[placeholder*="标题"]',
      '[contenteditable="true"][data-placeholder*="标题"]',
      '[contenteditable="true"][aria-label*="标题"]',
    ],
    titleEditor: [
      '.editor-title__container .ProseMirror',
      '.hb-cpt__editor-title .ProseMirror',
      '.editor-article__title [contenteditable="true"]',
    ],
    bodyEditor: [
      '.article__edit-content--inner .ProseMirror',
      '.article__edit-content .ProseMirror',
      '.ProseMirror',
      '[contenteditable="true"][role="textbox"]',
      '.ql-editor',
      '[contenteditable="true"]',
      'textarea[placeholder*="正文"]',
    ],
  };

  const isVisible = (element) => {
    if (!element || element.nodeType !== 1) return false;
    const view = element.ownerDocument?.defaultView || global;
    const style = view.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== 'none'
      && style.visibility !== 'hidden'
      && Number(rect.width) > 0
      && Number(rect.height) > 0;
  };

  const roots = (document) => {
    const found = [document];
    for (const element of document.querySelectorAll('*')) {
      if (element.shadowRoot) found.push(element.shadowRoot);
    }
    return found;
  };

  const queryAll = (document, selector) => roots(document)
    .flatMap((root) => [...root.querySelectorAll(selector)]);

  const firstVisible = (document, selectorList, excluded = new Set()) => {
    for (const selector of selectorList) {
      const match = queryAll(document, selector)
        .find((element) => !excluded.has(element) && isVisible(element));
      if (match) return match;
    }
    return undefined;
  };

  const editableNearLabel = (document, labelText) => {
    const labels = queryAll(document, 'div, span, p, label')
      .filter((element) => isVisible(element) && element.textContent?.trim() === labelText);
    for (const label of labels) {
      let container = label.parentElement;
      for (let depth = 0; container && depth < 3; depth += 1, container = container.parentElement) {
        const editor = [...container.querySelectorAll(
          '.ProseMirror, [contenteditable="true"], input, textarea',
        )].find((element) => isVisible(element));
        if (editor) return editor;
      }
    }
    return undefined;
  };

  const findEditor = (document) => {
    const title = firstVisible(document, selectors.legacyTitle)
      || firstVisible(document, selectors.titleEditor)
      || editableNearLabel(document, '填写标题');
    const excluded = new Set(title ? [title] : []);
    const body = firstVisible(document, selectors.bodyEditor, excluded)
      || editableNearLabel(document, '正文文案');
    return { title, body };
  };

  const readEditableText = (element) => {
    if (!element) return '';
    if ('value' in element && typeof element.value === 'string') return element.value.trim();
    return String(element.innerText || element.textContent || '').replace(/\u200b/g, '').trim();
  };

  const findImageMarkers = (document, ids) => ids.flatMap((id) => {
    const attributeMarker = queryAll(document, '[data-ai-news-image]')
      .find((element) => element.getAttribute('data-ai-news-image') === id);
    if (attributeMarker) return [{ id, element: attributeMarker }];

    // Xiaoheihe's ProseMirror parser removes custom data attributes from pasted
    // HTML, but keeps text. The stable token lets us recover the intended image
    // position after that normalization.
    const token = `AIIMG:${id}`;
    const textMarker = queryAll(document, 'p, li, blockquote, h2, h3')
      .find((element) => element.textContent?.includes(token));
    return textMarker ? [{ id, element: textMarker }] : [];
  });

  const findImageDescriptionEditor = (imageBox) => {
    if (!imageBox) return undefined;
    const selectors = [
      'input[placeholder*="图片描述"]',
      'textarea[placeholder*="图片描述"]',
      '[contenteditable="true"][data-placeholder*="图片描述"]',
      '[contenteditable="true"][aria-label*="图片描述"]',
      '[contenteditable="true"]',
    ];
    for (const selector of selectors) {
      const match = [...imageBox.querySelectorAll(selector)].find(isVisible);
      if (match) return match;
    }
    return undefined;
  };

  const imageSource = (imageBox) => {
    const image = imageBox?.querySelector?.("img");
    return image ? String(image.currentSrc || image.src || "") : "";
  };

  const findImageBoxBySource = (document, source) => {
    if (!source) return undefined;
    return queryAll(document, ".article__image-box")
      .find((box) => imageSource(box) === source);
  };

  const captureInsertedImageBox = (document, beforeSources, beforeBoxes) => {
    const boxes = queryAll(document, ".article__image-box");
    const box = boxes.find((candidate) => {
      const source = imageSource(candidate);
      return source && !beforeSources.has(source);
    }) || boxes.filter((candidate) => !beforeBoxes.has(candidate)).at(-1);
    if (!box) return undefined;
    return { box, source: imageSource(box) };
  };

  const findRootByChildText = (document, rootSelector, childSelector, text) => queryAll(document, rootSelector)
    .find((root) => isVisible(root) && [...root.querySelectorAll(childSelector)]
      .some((child) => child.textContent?.trim() === text));

  const findSelectedCommunity = (document, text) => findRootByChildText(
    document,
    '.editor__topic-item',
    '.topic-item__text',
    text,
  );

  const findCommunityOption = (document, text) => findRootByChildText(
    document,
    '.editor-model__topic-list-item',
    '.topic-list-item__title',
    text,
  );

  const findSelectedTopic = (document, text) => findRootByChildText(
    document,
    '.editor__hashtag-item',
    '.hashtag-item__text',
    text,
  );

  const findTopicOption = (document, text) => findRootByChildText(
    document,
    '.editor-model__hashtag-list-item',
    '.hashtag-list-item__title',
    text,
  );

  global.XiaoheiheDom = {
    findEditor,
    captureInsertedImageBox,
    findImageBoxBySource,
    findImageDescriptionEditor,
    findCommunityOption,
    firstVisible: (document, selectorList) => firstVisible(document, selectorList),
    isVisible,
    findImageMarkers,
    findSelectedCommunity,
    findSelectedTopic,
    findTopicOption,
    queryAll,
    readEditableText,
  };
}(globalThis));
