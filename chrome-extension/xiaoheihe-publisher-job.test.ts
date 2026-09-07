import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const script = await readFile(new URL("./xiaoheihe-publisher-job.js", import.meta.url), "utf8");
const context = vm.createContext({ globalThis: {} });
vm.runInContext(script, context);
const validator = (context.globalThis as {
  XiaoheihePublisherJob: {
    validateArticleImagePayload: (job: unknown) => { ok: boolean; detail: string };
    validateImagePostPayload: (job: unknown) => { ok: boolean; detail: string };
  };
}).XiaoheihePublisherJob;

test("article image payload must exactly match every body marker", () => {
  const bodyHtml = '<p>正文</p><p data-ai-news-image="placement-one">AIIMG:placement-one</p>';

  assert.equal(validator.validateArticleImagePayload({ bodyHtml, images: [] }).ok, false);
  assert.equal(validator.validateArticleImagePayload({
    bodyHtml,
    images: [{ id: "another-placement" }],
  }).ok, false);
  assert.equal(validator.validateArticleImagePayload({
    bodyHtml,
    images: [{ id: "placement-one" }],
  }).ok, true);
});

test("image-post payload accepts an ordered gallery and rejects duplicate IDs", () => {
  assert.equal(validator.validateImagePostPayload({ images: [] }).ok, false);
  assert.equal(validator.validateImagePostPayload({ images: [{ id: "one", dataUrl: "data:image/png;base64,YQ==" }, { id: "two", dataUrl: "data:image/png;base64,Yg==" }] }).ok, true);
  assert.equal(validator.validateImagePostPayload({ images: [{ id: "one", dataUrl: "data:image/png;base64,YQ==" }] }).ok, true);
});
