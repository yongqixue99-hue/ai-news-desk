(function installXiaoheiheImagePostDom(globalObject) {
  const visible = (element) => {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
  };

  const firstVisible = (root, selectors) => {
    for (const selector of selectors) {
      const match = [...root.querySelectorAll(selector)].find(visible);
      if (match) return match;
    }
    return undefined;
  };

  globalObject.XiaoheiheImagePostDom = Object.freeze({
    findFields(root) {
      const title = firstVisible(root, [
        '.editor-title__container [contenteditable="true"]',
        '.editor-image-text__title [contenteditable="true"]',
        'input[placeholder*="标题"]',
        'textarea[placeholder*="标题"]',
      ]);
      const body = firstVisible(root, [
        '.image-text__edit-content--inner [contenteditable="true"]',
        'textarea[placeholder*="正文"]',
        'textarea[placeholder*="内容"]',
      ]);
      const upload = firstVisible(root, [
        '.editor-image-wrapper__box.upload',
        'input[type="file"][accept*="image"]',
      ]);
      return { title, body, upload };
    },
  });
})(globalThis);
