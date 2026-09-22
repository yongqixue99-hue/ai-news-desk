(function initSettings(global) {
  const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

  const read = document => ({
    visibility: document.querySelector('.authority__selector .selector__active')?.textContent?.trim(),
    participating: document.querySelector('.creation-plan-join .switch__button')?.classList.contains('active'),
    plan: document.querySelector('.creation-plan-select__radio.selected .radio__select-label')?.textContent?.trim(),
  });
  async function configure(document, options, uploadCover, wait = sleep) {
    const steps = [];
    const planLabels = { standard: options.contentFormat === "image-post" ? "图文计划" : "文章计划", hot: "热点计划" };
    const publicLabel = '所有人可见';
    if (read(document).visibility !== publicLabel) {
      document.querySelector('.authority__selector .selector__box')?.click();
      await wait(150);
      [...document.querySelectorAll('.authority__selector .selector__pull-list-item')].find(item => item.textContent?.trim() === publicLabel)?.click();
      await wait(200);
    }
    steps.push({ name: '可见范围', ok: read(document).visibility === publicLabel, detail: read(document).visibility === publicLabel ? publicLabel : '可见范围未能设为所有人可见' });
    const participating = options.creationPlan !== 'none';
    const control = document.querySelector('.creation-plan-join .switch__button');
    if (control && read(document).participating !== participating) { control.click(); await wait(300); }
    if (participating) {
      [...document.querySelectorAll('.creation-plan-select__radio')].find(item => item.querySelector('.radio__select-label')?.textContent?.trim() === planLabels[options.creationPlan])?.click();
      await wait(300);
    }
    const state = read(document);
    const planOk = Boolean(control) && state.participating === participating && (!participating || state.plan === planLabels[options.creationPlan]);
    steps.push({ name: '创作计划', ok: planOk, detail: planOk ? participating ? planLabels[options.creationPlan] : '不参与' : '平台未确认所选创作计划' });
    if (!participating) steps.push({ name: '内容封面', ok: true, detail: '不参与创作计划，无需封面' });
    else if (!planOk || !options.cover) steps.push({ name: '内容封面', ok: false, detail: '请先选择有效计划和封面' });
    else {
      const result = await uploadCover(options.cover);
      steps.push({ name: '内容封面', ok: Boolean(result?.ok), detail: result?.detail || '封面上传未完成' });
    }
    return steps;
  }
  global.XiaoheiheSettings = { read, configure };
})(globalThis);
