// Runs in the page's MAIN world because its upload control creates a transient
// file input. It uses the platform's own upload/crop UI and never its publish API.
export async function uploadCoverInPage(payload) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => element && element.getBoundingClientRect().width > 0 && getComputedStyle(element).visibility !== 'hidden';
  const coverImage = () => document.querySelector('.form-thumb .thumb-card__image img');
  const before = coverImage()?.src;
  const trigger = document.querySelector('.form-thumb .thumb-card__corner');
  if (!visible(trigger)) return { ok: false, detail: '没有找到创作计划的封面入口' };
  const blob = await (await fetch(payload.dataUrl)).blob();
  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], payload.fileName, { type: payload.mimeType }));
  const originalClick = HTMLInputElement.prototype.click;
  let supplied = false;
  const supply = input => {
    if (supplied || input.type !== 'file') return;
    supplied = true;
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  HTMLInputElement.prototype.click = function () {
    if (this.type === 'file' && !supplied) { supply(this); return; }
    return originalClick.call(this);
  };
  try {
    trigger.click();
    for (let attempt = 0; attempt < 30 && !supplied; attempt += 1) {
      const selector = document.querySelector('.editor-model__thumb-selector');
      const input = selector?.querySelector('input[type="file"]');
      if (input) supply(input);
      else if (visible(selector?.querySelector('.editor-model__thumb-upload'))) selector.querySelector('.editor-model__thumb-upload').click();
      await wait(200);
    }
  } finally {
    HTMLInputElement.prototype.click = originalClick;
  }
  if (!supplied) return { ok: false, detail: '平台封面上传入口已变化，未能传入文件' };
  let confirmed = false;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const image = coverImage();
    if (image && image.src !== before && /^https:\/\//.test(image.src) && image.complete && image.naturalWidth > 0 && visible(image) && Number(getComputedStyle(image).opacity) > 0) return { ok: true, detail: '封面已上传、裁切并在平台回读确认' };
    const selector = document.querySelector('.editor-model__thumb-selector');
    if (!confirmed && selector?.querySelector('.cropper-container') && !visible(selector.querySelector('.editor-model__thumb-clip--loading'))) {
      // Only the cover modal's confirmation button is eligible here.
      const modal = selector.closest('[role="dialog"], .hb-cpt__modal, .editor-model, .editor__model-frame, .modal__container') || selector.parentElement;
      const button = [...(modal?.querySelectorAll('button, [role="button"], .hb-cpt__button') || [])].find(item => visible(item) && /^(确定|确认|完成|保存封面)$/.test(item.textContent.trim()) && !item.disabled && !item.classList.contains('disabled'));
      if (button) { button.click(); confirmed = true; }
    }
    await wait(250);
  }
  return { ok: false, detail: '封面已传入，但平台尚未确认最终封面，请检查封面裁切窗口' };
}
