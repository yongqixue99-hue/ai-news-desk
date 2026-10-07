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
    runArticleContent: (job: unknown, dependencies: Record<string, unknown>) => Promise<{ ready: boolean; resumed?: boolean; steps: Array<{ name: string; ok: boolean }> }>;
    runCover: (job: unknown, dependencies: Record<string, unknown>) => Promise<{ ok: boolean; detail: string }>;
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

const resumableJob = () => ({ draftId: "draft-one", contentHash: "a".repeat(64), title: "标题", contentFormat: "article", images: [{ id: "one" }] });
const liveArticle = () => ({ pageUrl: "https://www.xiaoheihe.cn/creator/editor/draft/article/article-one", title: "标题", signature: "b".repeat(64), imageCount: 1, pendingMarkers: false });
const checkpoint = () => ({ schemaVersion: "xiaoheihe-article-checkpoint/v1", draftId: "draft-one", contentHash: "a".repeat(64), pageUrl: liveArticle().pageUrl, signature: "b".repeat(64), imageIds: ["one"] });

test("retrying article settings reads the live draft and keeps verified text and images", async () => {
  let reads = 0;
  const result = await validator.runArticleContent(resumableJob(), {
    loadCheckpoint: async () => checkpoint(), readLive: async () => { reads++; return liveArticle(); },
    clearCheckpoint: async () => { throw new Error("must keep checkpoint"); },
    fillTitle: async () => { throw new Error("must not rewrite title"); },
    fillBody: async () => { throw new Error("must not rewrite body"); },
    uploadImages: async () => { throw new Error("must not upload images again"); },
  });
  assert.equal(reads, 1);
  assert.equal(result.ready, true);
  assert.equal(result.resumed, true);
  assert.ok(result.steps.every(step => step.ok));
});

test("platform edits, changed links or missing images never get silently overwritten on retry", async () => {
  for (const change of [{ signature: "c".repeat(64) }, { imageCount: 0 }, { pendingMarkers: true }]) {
    const result = await validator.runArticleContent(resumableJob(), {
      loadCheckpoint: async () => checkpoint(), readLive: async () => ({ ...liveArticle(), ...change }),
      clearCheckpoint: async () => { throw new Error("must not overwrite edited draft"); },
      fillTitle: async () => { throw new Error("must not write"); },
    });
    assert.equal(result.ready, false);
    assert.equal(result.steps[0]?.ok, false);
  }
});

test("new local content replaces only an unchanged platform draft and checkpoints after all content steps pass", async () => {
  const calls: string[] = [];
  let saved: unknown;
  const result = await validator.runArticleContent({ ...resumableJob(), contentHash: "d".repeat(64) }, {
    loadCheckpoint: async () => checkpoint(), readLive: async () => liveArticle(),
    clearCheckpoint: async () => { calls.push("clear"); },
    fillTitle: async () => { calls.push("title"); return { name: "标题", ok: true }; },
    fillBody: async () => { calls.push("body"); return { name: "正文", ok: true }; },
    uploadImages: async () => { calls.push("images"); return { name: "配图", ok: true }; },
    saveCheckpoint: async (value: unknown) => { saved = value; },
  });
  assert.equal(result.ready, true);
  assert.deepEqual(calls, ["clear", "title", "body", "images"]);
  assert.equal((saved as { contentHash: string }).contentHash, "d".repeat(64));
});

test("an incomplete image upload never becomes a complete content checkpoint", async () => {
  const result = await validator.runArticleContent(resumableJob(), {
    loadCheckpoint: async () => undefined, readLive: async () => liveArticle(), clearCheckpoint: async () => {},
    fillTitle: async () => ({ name: "标题", ok: true }), fillBody: async () => ({ name: "正文", ok: true }),
    uploadImages: async () => ({ name: "配图", ok: false }),
    saveCheckpoint: async () => { throw new Error("incomplete upload must not be remembered as complete"); },
  });
  assert.equal(result.ready, false);
});

test("changed local image selection replaces an unchanged partially uploaded remote draft", async () => {
  const saved = { ...checkpoint(), schemaVersion: "xiaoheihe-article-checkpoint/v2", stage: "images",
    uploadedImages: [{ id: "one", source: "https://img.example.test/one.png" }], pendingImageIds: ["two"] };
  const calls: string[] = [];
  let live = { ...liveArticle(), pendingMarkers: true, pendingImageIds: ["two"] };
  const result = await validator.runArticleContent({ ...resumableJob(), contentHash: "d".repeat(64), images: [{ id: "three" }] }, {
    loadCheckpoint: async () => saved, readLive: async () => live,
    clearCheckpoint: async () => { calls.push("clear"); },
    fillTitle: async () => { calls.push("title"); return { name: "标题", ok: true }; },
    fillBody: async () => { calls.push("body"); live = { ...live, imageCount: 0, pendingImageIds: ["three"] }; return { name: "正文", ok: true }; },
    uploadImages: async () => { calls.push("images"); return { name: "配图", ok: false }; }, saveCheckpoint: async () => {},
  });
  assert.deepEqual(calls, ["clear", "title", "body", "images"]);
  assert.equal(result.ready, false);
});

test("partial images resume from verified native sources without replacing title or body", async () => {
  const job = { ...resumableJob(), images: [{ id: "one" }, { id: "two" }] };
  const saved = { ...checkpoint(), schemaVersion: "xiaoheihe-article-checkpoint/v2", stage: "images",
    uploadedImages: [{ id: "one", source: "https://img.example.test/one.png" }], pendingImageIds: ["two"] };
  let uploaded: unknown;
  const result = await validator.runArticleContent(job, {
    loadCheckpoint: async () => saved,
    readLive: async () => ({ ...liveArticle(), pendingMarkers: true, pendingImageIds: ["two"] }),
    clearCheckpoint: async () => { throw new Error("must preserve partial checkpoint"); },
    fillTitle: async () => { throw new Error("must not replace title"); },
    fillBody: async () => { throw new Error("must not replace body"); },
    uploadImages: async (progress: unknown) => { uploaded = progress; return { name: "配图", ok: false }; },
  });
  assert.equal(result.ready, false);
  assert.deepEqual(JSON.parse(JSON.stringify((uploaded as { uploadedImages: unknown }).uploadedImages)), saved.uploadedImages);
});

test("each successful image can be checkpointed even if the following image fails", async () => {
  const job = { ...resumableJob(), images: [{ id: "one" }, { id: "two" }] };
  let live = { ...liveArticle(), imageCount: 0, pendingMarkers: true, pendingImageIds: ["one", "two"] };
  let saved: Record<string, unknown> | undefined;
  const result = await validator.runArticleContent(job, {
    loadCheckpoint: async () => undefined, readLive: async () => live, clearCheckpoint: async () => {},
    fillTitle: async () => ({ name: "标题", ok: true }), fillBody: async () => ({ name: "正文", ok: true }),
    saveCheckpoint: async (value: Record<string, unknown>) => { saved = value; },
    uploadImages: async (progress: { onProgress: (images: unknown[]) => Promise<void> }) => {
      live = { ...live, signature: "c".repeat(64), imageCount: 1, pendingImageIds: ["two"] };
      await progress.onProgress([{ id: "one", source: "https://img.example.test/one.png" }]);
      return { name: "配图", ok: false };
    },
  });
  assert.equal(result.ready, false);
  assert.equal(saved?.schemaVersion, "xiaoheihe-article-checkpoint/v2");
  assert.deepEqual(JSON.parse(JSON.stringify(saved?.imageIds)), ["one"]);
  assert.deepEqual(JSON.parse(JSON.stringify(saved?.pendingImageIds)), ["two"]);
});

test("verified cover is reused on retry; a changed cover is uploaded and rebound", async () => {
  let stored: unknown, uploads = 0;
  const job = { draftId: "draft-one", coverHash: "a".repeat(64) };
  const dependencies = {
    loadCheckpoint: async () => stored,
    readLive: async () => ({ pageUrl: liveArticle().pageUrl, source: "https://img.example.test/cover.png" }),
    saveCheckpoint: async (value: unknown) => { stored = value; },
    upload: async () => { uploads++; return { ok: true, detail: "uploaded" }; },
  };
  assert.equal((await validator.runCover(job, dependencies)).ok, true);
  assert.equal((await validator.runCover(job, dependencies)).ok, true);
  assert.equal(uploads, 1);
  assert.equal((await validator.runCover({ ...job, coverHash: "b".repeat(64) }, dependencies)).ok, true);
  assert.equal(uploads, 2);
});
