import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createWeChatDraftDesk } from "./wechat-draft.js";
import type { ArticleDraft } from "./types.js";

const wechatFixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-wechat-images-"));
const wechatImagePath = path.join(wechatFixtureRoot, "cover.png");
writeFileSync(wechatImagePath, Buffer.from("image-bytes"));
after(() => rmSync(wechatFixtureRoot, { recursive: true, force: true }));

const articleDraft = (): ArticleDraft => ({
  id: "draft-1",
  runId: "run-1",
  candidateId: "candidate-1",
  createdAt: "2026-08-26T02:00:00.000Z",
  updatedAt: "2026-08-26T02:30:00.000Z",
  status: "ready",
  contentFormat: "article",
  title: "OpenAI 发布新模型",
  paragraphs: ["官方公布了新模型。"],
  take: "这会改变开发者的工作方式。",
  bodyHtml: [
    "<h2>发生了什么</h2>",
    "<p>官方公布了新模型。</p>",
    '<img src="/media/draft-1/cover.png" alt="产品界面" data-media-id="placement-1" data-caption="产品界面" data-attribution="OpenAI">',
    "<p>图：产品界面（来源：OpenAI）</p>",
  ].join(""),
  sources: [{ label: "OpenAI", url: "https://openai.com/news/example", kind: "primary", verified: true }],
  factClaims: [{
    id: "claim-1",
    claim: "OpenAI 发布新模型",
    status: "full-source",
    sourceUrl: "https://openai.com/news/example",
    capturedAt: "2026-08-26T02:00:00.000Z",
  }],
  uncertainties: [],
  images: [{
    id: "placement-1",
    afterParagraph: 0,
    caption: "产品界面",
    image: {
      id: "image-1",
      url: "/media/draft-1/cover.png",
      localPath: wechatImagePath,
      publicPath: "/media/draft-1/cover.png",
      caption: "产品界面",
      attribution: "OpenAI",
      sourceUrl: "https://openai.com/news/example",
      selected: true,
      rights: "owned",
      allowedPlatforms: ["wechat"],
    },
  }],
  community: "盒友杂谈",
  topics: ["AI"],
  provenance: {
    originalUrl: "https://openai.com/news/example",
    generatedBy: "test",
  },
});

test("a personal official account can verify draft access without performing a write", async () => {
  const desk = createWeChatDraftDesk({
    gateway: {
      countDrafts: async () => 7,
      uploadContentImage: async () => { throw new Error("connection checks must not upload"); },
      uploadPermanentImage: async () => { throw new Error("connection checks must not upload"); },
      addDraft: async () => { throw new Error("connection checks must not create drafts"); },
      updateDraft: async () => { throw new Error("connection checks must not update drafts"); },
    },
  });

  const result = await desk.checkConnection(new Date("2026-08-26T03:00:00.000Z"));

  assert.deepEqual(result, {
    ok: true,
    status: "connected",
    checkedAt: "2026-08-26T03:00:00.000Z",
    draftCount: 7,
    detail: "公众号草稿接口已连接 · 当前 7 篇草稿",
  });
});

test("connection failures stay actionable instead of leaking an unhandled gateway error", async () => {
  const desk = createWeChatDraftDesk({
    gateway: {
      countDrafts: async () => { throw new Error("调用接口的IP地址不在白名单中"); },
      uploadContentImage: async () => { throw new Error("unused"); },
      uploadPermanentImage: async () => { throw new Error("unused"); },
      addDraft: async () => { throw new Error("unused"); },
      updateDraft: async () => { throw new Error("unused"); },
    },
  });

  const result = await desk.checkConnection(new Date("2026-08-26T03:05:00.000Z"));

  assert.deepEqual(result, {
    ok: false,
    status: "error",
    checkedAt: "2026-08-26T03:05:00.000Z",
    detail: "调用接口的IP地址不在白名单中",
  });
});

test("syncing an article uploads its image and creates a WeChat draft without local editor markers", async () => {
  let submitted: Parameters<NonNullable<Parameters<typeof createWeChatDraftDesk>[0]["gateway"]["addDraft"]>>[0] | undefined;
  const desk = createWeChatDraftDesk({
    gateway: {
      countDrafts: async () => 0,
      uploadContentImage: async (asset) => {
        assert.equal(asset.fileName, "cover.png");
        return { url: "https://mmbiz.qpic.cn/article-image" };
      },
      uploadPermanentImage: async () => ({ mediaId: "cover-media-1" }),
      addDraft: async (article) => {
        submitted = article;
        return { mediaId: "draft-media-1" };
      },
      updateDraft: async () => { throw new Error("a new article must not update a draft"); },
    },
    loadImage: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "cover.png",
      contentType: "image/png",
    }),
  });

  const result = await desk.syncDraft({
    draft: articleDraft(),
    author: "小明",
    now: new Date("2026-08-26T03:10:00.000Z"),
  });

  assert.equal(submitted?.title, "OpenAI 发布新模型");
  assert.equal(submitted?.author, "小明");
  assert.equal(submitted?.thumb_media_id, "cover-media-1");
  assert.match(submitted?.content ?? "", /https:\/\/mmbiz\.qpic\.cn\/article-image/);
  assert.doesNotMatch(submitted?.content ?? "", /\/media\/draft-1|data-media-id/);
  assert.equal(result.operation, "created");
  assert.equal(result.mediaId, "draft-media-1");
  assert.equal(result.imageCount, 1);
  assert.equal(result.syncedAt, "2026-08-26T03:10:00.000Z");
});

test("WeChat delivery restores a deleted Creative Commons attribution caption", async () => {
  let submittedContent = "";
  const desk = createWeChatDraftDesk({
    gateway: {
      countDrafts: async () => 0,
      uploadContentImage: async () => ({ url: "https://mmbiz.qpic.cn/licensed-image" }),
      uploadPermanentImage: async () => ({ mediaId: "licensed-cover" }),
      addDraft: async (article) => {
        submittedContent = article.content;
        return { mediaId: "licensed-draft" };
      },
      updateDraft: async () => { throw new Error("unused"); },
    },
    loadImage: async () => ({
      bytes: new Uint8Array([1, 2, 3]),
      fileName: "person.jpg",
      contentType: "image/jpeg",
    }),
  });
  const licensed = articleDraft();
  licensed.bodyHtml = '<p>正文</p><img src="/media/draft-1/cover.png" data-media-id="placement-1" data-caption="人物资料图">';
  licensed.images[0].caption = "人物资料图";
  licensed.images[0].image.caption = "人物资料图";
  licensed.images[0].image.rights = "licensed";
  licensed.images[0].image.attribution = "TechCrunch / Wikimedia Commons，CC BY 2.0";
  licensed.images[0].image.sourceUrl = "https://commons.wikimedia.org/wiki/File:Person.jpg";
  licensed.images[0].image.evidenceNote = "Commons 文件页确认 CC BY 2.0。";
  licensed.images[0].image.licenseId = "CC-BY-2.0";
  licensed.images[0].image.licenseUrl = "https://creativecommons.org/licenses/by/2.0/";
  licensed.images[0].image.modificationNote = "仅缩放，未裁切或调色";

  await desk.syncDraft({ draft: licensed, now: new Date("2026-08-26T03:20:00.000Z") });

  assert.match(submittedContent, /图：人物资料图/);
  assert.match(submittedContent, /TechCrunch \/ Wikimedia Commons，CC BY 2\.0/);
  assert.match(submittedContent, /creativecommons\.org\/licenses\/by\/2\.0/);
  assert.match(submittedContent, /修改：仅缩放，未裁切或调色/);
});

test("a repeated sync skips unchanged content and later updates the existing WeChat draft", async () => {
  let contentUploads = 0;
  let coverUploads = 0;
  let additions = 0;
  let updates = 0;
  const desk = createWeChatDraftDesk({
    gateway: {
      countDrafts: async () => 0,
      uploadContentImage: async () => ({ url: `https://mmbiz.qpic.cn/article-${++contentUploads}` }),
      uploadPermanentImage: async () => ({ mediaId: `cover-${++coverUploads}` }),
      addDraft: async () => {
        additions += 1;
        return { mediaId: "same-draft-media-id" };
      },
      updateDraft: async (mediaId) => {
        assert.equal(mediaId, "same-draft-media-id");
        updates += 1;
      },
    },
    loadImage: async () => ({
      bytes: new Uint8Array([8, 6, 2, 6]),
      fileName: "cover.jpg",
      contentType: "image/jpeg",
    }),
  });
  const first = await desk.syncDraft({ draft: articleDraft(), now: new Date("2026-08-26T04:00:00.000Z") });

  const unchanged = await desk.syncDraft({
    draft: articleDraft(),
    previousReceipt: first,
    now: new Date("2026-08-26T04:05:00.000Z"),
  });
  const changedDraft = articleDraft();
  changedDraft.title = "OpenAI 新模型对普通读者意味着什么";
  changedDraft.updatedAt = "2026-08-26T04:08:00.000Z";
  const updated = await desk.syncDraft({
    draft: changedDraft,
    previousReceipt: unchanged,
    now: new Date("2026-08-26T04:10:00.000Z"),
  });

  assert.equal(unchanged.operation, "unchanged");
  assert.equal(updated.operation, "updated");
  assert.equal(updated.mediaId, "same-draft-media-id");
  assert.equal(additions, 1);
  assert.equal(updates, 1);
  assert.equal(contentUploads, 2, "unchanged content should not upload its image again");
  assert.equal(coverUploads, 2, "unchanged content should not upload its cover again");
});
