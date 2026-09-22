import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as cheerio from "cheerio";

const script = await readFile(new URL("./xiaoheihe-settings.js", import.meta.url), "utf8");
function fixture(planLabel = "文章计划", participating = false) {
  const $ = cheerio.load(`<div class="authority__selector"><div class="selector__box"></div><div class="selector__active">仅自己可见</div><div class="selector__pull-list-item">所有人可见</div></div><div class="creation-plan-join"><div class="switch__button ${participating ? "active" : ""}"></div></div><div class="creation-plan-select"><div class="creation-plan-select__radio"><div class="radio__select-label">${planLabel}</div></div><div class="creation-plan-select__radio"><div class="radio__select-label">热点计划</div></div></div>`);
  const wrap = (element: any): any => element ? {
    get textContent() { return $(element).text(); },
    classList: { contains: (name: string) => $(element).hasClass(name) },
    querySelector: (selector: string) => wrap($(element).find(selector).get(0)),
    click() {
      if ($(element).hasClass("selector__pull-list-item")) $('.selector__active').text($(element).text());
      if ($(element).hasClass("switch__button")) $(element).toggleClass("active");
      if ($(element).hasClass("creation-plan-select__radio")) { $('.creation-plan-select__radio').removeClass("selected"); $(element).addClass("selected"); }
    },
  } : undefined;
  const document = { querySelector: (selector: string) => wrap($(selector).get(0)), querySelectorAll: (selector: string) => $(selector).toArray().map(wrap) };
  const context = vm.createContext({ globalThis: {}, setTimeout }); vm.runInContext(script, context);
  return { document, settings: context.globalThis.XiaoheiheSettings as { configure: (document: unknown, options: unknown, upload: (cover: unknown) => Promise<unknown>, wait: () => Promise<void>) => Promise<Array<{name: string;ok:boolean;detail:string}>> } };
}

test("default delivery turns participation off and verifies public visibility", async () => {
  const { document, settings } = fixture("文章计划", true);
  const steps = await settings.configure(document, { creationPlan: "none" }, async () => { throw new Error("must not upload"); }, async () => {});
  assert.ok(steps.every(step => step.ok));
  assert.equal(steps.find(step => step.name === "创作计划")?.detail, "不参与");
});
for (const [format, label] of [["article", "文章计划"], ["image-post", "图文计划"]]) {
  test(`${format} selects its actual platform plan and reports cover failure truthfully`, async () => {
    const { document, settings } = fixture(label); let uploads = 0;
    const steps = await settings.configure(document, { contentFormat: format, creationPlan: "standard", cover: { id: "independent" } }, async () => { uploads++; return { ok: false, detail: "upload rejected" }; }, async () => {});
    assert.equal(uploads, 1);
    assert.equal(steps.find(step => step.name === "创作计划")?.detail, label);
    assert.equal(steps.find(step => step.name === "内容封面")?.ok, false);
  });
}
test("unavailable plan never uploads a cover or reports ready", async () => {
  const { document, settings } = fixture("文章计划");
  const steps = await settings.configure(document, { contentFormat: "image-post", creationPlan: "standard", cover: {} }, async () => { throw new Error("must not upload"); }, async () => {});
  assert.equal(steps.find(step => step.name === "创作计划")?.ok, false);
});
