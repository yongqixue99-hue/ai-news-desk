import assert from "node:assert/strict";
import test from "node:test";
import { createSocialDeliveryDesk, socialDraftUrl } from "./social-delivery.js";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import type { WorkflowState } from "./types.js";
import type { SocialBridgeMethod } from "./social-bridge.js";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const setup = (capabilities = ["article", "draft", "image_upload", "cover"]) => {
  const state = createDefaultState(); const draft = createBlankDraftInState(state);
  draft.title = "头条隔离测试文章"; draft.bodyHtml = "<p>第一段。</p><p>第二段。</p>";
  const calls: Array<{ method: SocialBridgeMethod; params?: Record<string, unknown> }> = [];
  let postId = "123456";
  const dependencies = {
    read: async () => state, update: async <T>(fn: (state: WorkflowState) => T) => fn(state), quality: async () => {},
    loadImage: async () => { throw new Error("unexpected image read"); },
    bridge: { request: async (method: SocialBridgeMethod, params?: Record<string, unknown>) => {
      calls.push({ method, params });
      if (method === "listPlatforms") return [{ id: "toutiao", capabilities, version: "test-adapter/1" }];
      if (method === "checkAuth") return { isAuthenticated: true, username: "隔离作者", userId: "account-1" };
      if (method === "syncArticle") return { results: [{ platform: "toutiao", success: true, draftOnly: true, postId, postUrl: "https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=123456" }] };
      throw new Error("unexpected bridge method");
    } },
  };
  const desk = createSocialDeliveryDesk(dependencies);
  return { desk, draft, state, calls, dependencies, setPostId: (id: string) => { postId = id; }, send: () => desk.deliver(draft.id, "toutiao", "隔离作者", draft.updatedAt, "account-1") };
};
test("Toutiao creates a draft with an explicit draft-only request and ten retries reuse it", async () => {
  const f = setup(); const first = await f.send();
  assert.equal(first.status, "reported"); assert.equal(first.postId, "123456"); assert.equal(first.finalPublishAttempted, false);
  for (let index = 0; index < 10; index++) assert.equal((await createSocialDeliveryDesk(f.dependencies).deliver(f.draft.id, "toutiao", "隔离作者", f.draft.updatedAt, "account-1")).id, first.id);
  const writes = f.calls.filter(call => call.method === "syncArticle");
  assert.equal(writes.length, 1); assert.equal(writes[0]!.params?.draftOnly, true);
  assert.deepEqual(writes[0]!.params?.platforms, ["toutiao"]);
  assert.ok(first.fieldChecks?.fields.every(field => field.status === "unobserved"));
  assert.match(first.fieldChecks?.adapterVersion || "", /test-adapter\/1/);
  const reviewed = await f.desk.resolve(f.draft.id, first.id, "reviewed");
  assert.equal(reviewed.acceptance?.revisionHash, first.revisionHash);
  assert.equal(reviewed.acceptance?.accountId, "account-1");
  assert.equal(reviewed.acceptance?.adapterVersion, first.fieldChecks?.adapterVersion);
});
test("Toutiao rejects an adapter without draft capability before uploading or writing", async () => {
  const f = setup(["article"]);
  await assert.rejects(f.send(), /草稿能力/u);
  assert.deepEqual(f.calls.map(call => call.method), ["listPlatforms"]);
  assert.equal(f.draft.socialDeliveries?.length || 0, 0);
});
test("an ambiguous Toutiao receipt stays unknown across restart and cannot write again", async () => {
  const f = setup(); f.setPostId("999");
  const receipt = await f.send();
  assert.equal(receipt.status, "unknown");
  assert.match(receipt.fieldChecks?.adapterVersion || "", /test-adapter\/1/);
  assert.equal(receipt.fieldChecks?.fields.length, 5);
  assert.ok(receipt.fieldChecks?.fields.every(field => field.status === "unobserved"));
  await assert.rejects(f.send(), /待核对/u);
  assert.equal(f.calls.filter(call => call.method === "syncArticle").length, 1);
});
test("Toutiao accepts only exact official draft editor URLs with a numeric draft ID", () => {
  for (const version of [3, 4]) assert.equal(socialDraftUrl("toutiao", `https://mp.toutiao.com/profile_v${version}/graphic/publish?pgc_id=123`), `https://mp.toutiao.com/profile_v${version}/graphic/publish?pgc_id=123`);
  for (const url of ["https://mp.toutiao.com/profile_v4/graphic/publish", "https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=0", "https://mp.toutiao.com/profile_v4/graphic/publish?pgc_id=123&pgc_id=456", "https://www.toutiao.com/article/123", "https://mp.toutiao.com.evil.test/profile_v4/graphic/publish?pgc_id=123"]) assert.equal(socialDraftUrl("toutiao", url), undefined);
});

test("Toutiao sends the selected cover and body image once, with no local paths in the article", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-toutiao-cover-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const localPath = path.join(root, "cover.png"); await writeFile(localPath, "fixture-image");
  const f = setup();
  f.draft.images = [{ id: "cover", afterParagraph: 0, caption: "隔离测试配图", image: { id: "asset", caption: "隔离测试配图", url: "/media/cover.png", publicPath: "/media/cover.png", localPath, rights: "owned", selected: true, attribution: "隔离作者", sourceUrl: "https://example.com", allowedPlatforms: ["*"] } }];
  f.draft.bodyHtml += '<img data-media-id="cover" src="/media/cover.png">';
  f.draft.socialMetadata = { toutiao: { coverPlacementId: "cover", title: "头条独立标题" } };
  const original = f.dependencies.bridge.request;
  let uploadedUrl = "https://p3.toutiaoimg.com/fixture.png", uploads = 0;
  const desk = createSocialDeliveryDesk({ ...f.dependencies,
    loadImage: async () => ({ bytes: Buffer.from("fixture-image"), contentType: "image/png", fileName: "cover.png" }),
    bridge: { request: async (method, params) => {
      if (method === "uploadImage") { assert.equal(params?.platform, "toutiao"); uploads++; return { url: uploadedUrl }; }
      return original(method, params);
    } },
  });
  const send = () => desk.deliver(f.draft.id, "toutiao", "隔离作者", f.draft.updatedAt, "account-1");
  for (const badUrl of ["file:///private/image.png", "https://toutiaoimg.com.evil.test/image.png"]) {
    uploadedUrl = badUrl; await assert.rejects(send(), /图片地址/u);
  }
  assert.equal(f.calls.some(call => call.method === "syncArticle"), false);
  uploads = 0; uploadedUrl = "https://p3.toutiaoimg.com/fixture.png";
  const receipt = await send();
  assert.equal(receipt.status, "reported");
  await send(); assert.equal(uploads, 1);
  const article = f.calls.find(call => call.method === "syncArticle")?.params?.article as Record<string, unknown>;
  assert.equal(article.title, "头条独立标题"); assert.equal(article.cover, uploadedUrl);
  assert.match(String(article.content), /https:\/\/p3\.toutiaoimg\.com\/fixture\.png/u);
  assert.doesNotMatch(String(article.content), /data-media-id|src="\/media\/|file:\/\//u);
  assert.equal(f.draft.title, "头条隔离测试文章");
});
