import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as cheerio from "cheerio";

const script = await readFile(new URL("./xiaoheihe-image-post-dom.js", import.meta.url), "utf8");

test("recognizes the current Xiaoheihe image-post editor without placeholders", () => {
  const $ = cheerio.load(`
    <div class="editor-image-wrapper__box upload"></div>
    <div class="editor-title__container"><div class="ProseMirror hb-editor" contenteditable="true"></div></div>
    <div class="image-text__edit-content--inner"><div class="ProseMirror hb-editor" contenteditable="true"></div></div>
  `);
  class FakeElement {}
  const root = {
    querySelectorAll(selector: string) {
      return $(selector).toArray().map((element) => Object.assign(new FakeElement(), {
        selector,
        element,
        getBoundingClientRect: () => ({ width: 100, height: 30 }),
      }));
    },
  };
  const context = vm.createContext({
    globalThis: {},
    Element: FakeElement,
    getComputedStyle: () => ({ display: "block", visibility: "visible" }),
  });
  vm.runInContext(script, context);
  const fields = (context.globalThis as {
    XiaoheiheImagePostDom: { findFields: (root: unknown) => Record<string, unknown> };
  }).XiaoheiheImagePostDom.findFields(root);

  assert.ok(fields.title);
  assert.ok(fields.body);
  assert.ok(fields.upload);
  assert.notEqual(fields.title, fields.body);
});
