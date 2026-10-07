import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("./xiaoheihe.js", import.meta.url), "utf8");
const validation = await readFile(new URL("./xiaoheihe-publisher-job.js", import.meta.url), "utf8");
const uploader = source.slice(source.indexOf("async function uploadImages("), source.indexOf("async function chooseCommunity("));
class Box { isConnected = true; caption = ""; constructor(readonly source: string) {} }
const fixture = () => {
  const boxes = [new Box("https://img.example.test/one.png")];
  const uploads: string[] = [], saved: unknown[] = [];
  const context = vm.createContext({ HTMLElement: Box, console,
    document: { querySelectorAll: (selector: string) => selector.endsWith(" img") ? boxes.map(box => ({ src: box.source })) : boxes },
    domAdapter: {
      findImageMarkers: (_document: unknown, ids: string[]) => ids.map(id => ({ id, element: { scrollIntoView() {} } })),
      findImageBoxBySource: (_document: unknown, url: string) => boxes.find(box => box.source === url),
      captureInsertedImageBox: () => ({ box: boxes.at(-1), source: boxes.at(-1)!.source }),
      findImageDescriptionEditor: (box: Box) => box,
    },
    chrome: { runtime: { sendMessage: async (input: { payload: { markerToken: string } }) => {
      uploads.push(input.payload.markerToken); boxes.push(new Box("https://img.example.test/two.png")); return { ok: true };
    } } },
    fillImageDescription: async (resolve: () => Box, caption: string) => { const box = resolve(); if (!box) return false; box.caption = caption; return true; },
    readEditableText: (box: Box) => box.caption, wait: async () => {},
  });
  vm.runInContext(validation, context);
  vm.runInContext(`const publisherJobAdapter = globalThis.XiaoheihePublisherJob; ${uploader}; globalThis.upload = uploadImages;`, context);
  const job = { bodyHtml: '<p data-ai-news-image="one">AIIMG:one</p><p data-ai-news-image="two">AIIMG:two</p>',
    images: [{ id: "one", caption: "第一张描述" }, { id: "two", caption: "第二张描述" }] };
  return { boxes, uploads, saved, send: (url = boxes[0]!.source) => context.upload(job, { uploadedImages: [{ id: "one", source: url }], onProgress: async (images: unknown) => { saved.push(structuredClone(images)); } }) };
};

test("the real article uploader skips the verified image and restores descriptions after appending the remaining image", async () => {
  const f = fixture(); const result = await f.send();
  assert.equal(result.ok, true); assert.deepEqual(f.uploads, ["AIIMG:two"]);
  assert.deepEqual(f.boxes.map(box => box.caption), ["第一张描述", "第二张描述"]);
  assert.deepEqual(f.saved.at(-1), [{ id: "one", source: "https://img.example.test/one.png" }, { id: "two", source: "https://img.example.test/two.png" }]);
});
test("a missing recorded native image stops resume before uploading anything else", async () => {
  const f = fixture(); assert.equal((await f.send("https://img.example.test/missing.png")).ok, false);
  assert.deepEqual(f.uploads, []);
});
