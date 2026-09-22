import assert from "node:assert/strict";
import test from "node:test";
import { createSocialDeliveryDesk, socialAccounts, socialDraftUrl, socialRevisionHash } from "./social-delivery.js";
import { createDefaultState, upgradeState } from "./defaults.js";
import type { ArticleDraft, WorkflowState } from "./types.js";
import type { SocialBridgeMethod } from "./social-bridge.js";

const draft = (): ArticleDraft => ({
  id: "d", runId: "r", candidateId: "c", createdAt: "2026-09-20T01:00:00Z", updatedAt: "2026-09-20T01:00:00Z",
  status: "ready", title: "已审定文章", paragraphs: ["正文。"], bodyHtml: "<p>正文。</p>", take: "", sources: [], factClaims: [], uncertainties: [], images: [], community: "", topics: [], provenance: { originalUrl: "https://example.com", generatedBy: "test" },
});
const fixture = () => {
  let state = createDefaultState(); state.drafts = [draft()];
  const calls: SocialBridgeMethod[] = [];
  let onSync = async (): Promise<unknown> => ({ results: [{ platform: "zhihu", success: true, draftOnly: true, postId: "123", postUrl: "https://zhuanlan.zhihu.com/p/123/edit" }] });
  let username = "作者";
  let quality = async () => {};
  const dependencies = {
    read: async () => structuredClone(state),
    update: async <T>(mutate: (state: WorkflowState) => T) => mutate(state),
    quality: async () => quality(),
    loadImage: async () => { throw new Error("unexpected image read"); },
    bridge: { request: async (method: SocialBridgeMethod) => {
      calls.push(method);
      if (method === "checkAuth") return { isAuthenticated: true, username, userId: "uid-1" };
      if (method === "syncArticle") { assert.equal(state.drafts[0]!.socialDeliveries?.[0]?.status, "sending"); return onSync(); }
      throw new Error("unexpected request");
    } },
  };
  const desk = createSocialDeliveryDesk(dependencies);
  return { desk, dependencies, calls, get state() { return state; }, set state(value: WorkflowState) { state = value; }, setSync: (fn: typeof onSync) => { onSync = fn; }, setUsername: (name: string) => { username = name; }, setQuality: (fn: typeof quality) => { quality = fn; }, send: () => desk.deliver("d", "zhihu", "作者", state.drafts[0]!.updatedAt, "uid-1") };
};

test("Baijiahao accepts the editor's 2–64 character titles without truncation", async () => {
  for (const length of [2, 31, 64]) {
    const f = fixture(); f.state.drafts[0]!.title = "文".repeat(length);
    f.setSync(async () => ({ results: [{ platform: "baijiahao", success: true, draftOnly: true, postId: "456", postUrl: "https://baijiahao.baidu.com/builder/rc/edit?article_id=456" }] }));
    const receipt = await f.desk.deliver("d", "baijiahao", "作者", f.state.drafts[0]!.updatedAt, "uid-1");
    assert.equal(receipt.status, "reported"); assert.equal(receipt.title.length, length);
  }
  for (const length of [0, 1, 65]) {
    const f = fixture(); f.state.drafts[0]!.title = "文".repeat(length);
    await assert.rejects(f.desk.deliver("d", "baijiahao", "作者", f.state.drafts[0]!.updatedAt, "uid-1"), /2–64/);
    assert.equal(f.calls.length, 0);
  }
});

test("only verified public adapters are offered, even when helper lists Toutiao", () => {
  const accounts = socialAccounts([{ id: "toutiao", isAuthenticated: true, username: "作者" }, { id: "zhihu", isAuthenticated: true, username: "作者" }]);
  assert.equal(accounts.find(item => item.id === "toutiao")?.available, false);
  assert.equal(accounts.find(item => item.id === "zhihu")?.available, true);
  assert.equal(socialAccounts({ id: "zhihu" })[0]?.authenticated, false);
});
test("draft links must point to approved editors, never published articles or arbitrary URLs", () => {
  for (const value of ["javascript:alert(1)", "https://evil.test/", "https://zhuanlan.zhihu.com/p/123", "https://zhuanlan.zhihu.com.evil.test/p/123/edit", "https://user@zhuanlan.zhihu.com/p/123/edit"]) assert.equal(socialDraftUrl("zhihu", value), undefined);
  assert.equal(socialDraftUrl("baijiahao", "https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=456"), "https://baijiahao.baidu.com/builder/rc/edit?type=news&article_id=456");
});
test("successful acknowledgement is recorded as reported, same revision reuses receipt across restart", async () => {
  const f = fixture(); const first = await f.send(); assert.equal(first.status, "reported"); assert.equal(first.finalPublishAttempted, false);
  f.state = upgradeState(JSON.parse(JSON.stringify(f.state)));
  const other = createSocialDeliveryDesk(f.dependencies);
  assert.equal((await other.deliver("d", "zhihu", "作者", f.state.drafts[0]!.updatedAt, "uid-1")).id, first.id);
  assert.equal(f.calls.filter(method => method === "syncArticle").length, 1);
});
test("unknown remote result persists and prevents blind retries even when article changes", async () => {
  const f = fixture(); f.setSync(async () => { throw new Error("network lost"); });
  const receipt = await f.send(); assert.equal(receipt.status, "unknown");
  f.state.drafts[0]!.title = "修改后的标题";
  const other = createSocialDeliveryDesk(f.dependencies);
  await assert.rejects(other.deliver("d", "zhihu", "作者", f.state.drafts[0]!.updatedAt, "uid-1"), /先到平台确认/);
  await other.resolve("d", receipt.id, "not-received");
  assert.equal(f.state.drafts[0]!.socialDeliveries?.[0]?.status, "not-received");
  await f.send(); assert.equal(f.calls.filter(method => method === "syncArticle").length, 2);
});
test("missing draft marker, failed, wrong-platform or unsafe receipts stay unknown", async () => {
  for (const result of [{ success: true, platform: "zhihu", postId: "123", postUrl: "https://zhuanlan.zhihu.com/p/123/edit" }, { success: false }, { success: true, draftOnly: true, platform: "zhihu", postId: "999", postUrl: "https://zhuanlan.zhihu.com/p/123/edit" }, { success: true, draftOnly: true, platform: "baijiahao" }, { success: true, draftOnly: true, platform: "zhihu", postId: "123", postUrl: "https://evil.test" }]) {
    const f = fixture(); f.setSync(async () => ({ results: [result] })); assert.equal((await f.send()).status, "unknown");
  }
});
test("account mismatch and stale selected revision fail before remote mutation", async () => {
  const f = fixture(); f.setUsername("另一个人"); await assert.rejects(f.send(), /账号已变化/);
  await assert.rejects(f.desk.deliver("d", "zhihu", "另一个人", "old", "uid-2"), /草稿已变化/);
  assert.equal(f.calls.includes("syncArticle"), false);
});
test("account switch after sending invalidates acknowledgement", async () => {
  const f = fixture(); f.setSync(async () => { f.setUsername("另一个人"); return { results: [{ platform: "zhihu", success: true, draftOnly: true, postId: "123", postUrl: "https://zhuanlan.zhihu.com/p/123/edit" }] }; });
  assert.equal((await f.send()).status, "unknown");
});
test("concurrent submit is rejected; cannot resolve an active attempt", async () => {
  const f = fixture(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.setSync(async () => { await gate; throw new Error("interrupted"); });
  const running = f.send();
  await assert.rejects(f.send(), /正在投递/);
  for (let attempt = 0; attempt < 100 && !f.state.drafts[0]!.socialDeliveries?.length; attempt++) await new Promise(resolve => setTimeout(resolve, 1));
  assert.ok(f.state.drafts[0]!.socialDeliveries?.length);
  await assert.rejects(f.desk.resolve("d", f.state.drafts[0]!.socialDeliveries![0]!.id, "not-received"), /仍在执行/);
  release(); await running;
});
test("editorial failure and unknown images block transport", async () => {
  const f = fixture(); f.setQuality(async () => { throw new Error("证据不足"); }); await assert.rejects(f.send(), /证据不足/);
  f.setQuality(async () => {}); f.state.drafts[0]!.bodyHtml += '<img src="https://example.com/a.jpg">';
  await assert.rejects(f.send(), /素材管理/); assert.equal(f.calls.includes("syncArticle"), false);
});
test("unverified platform cannot bypass the UI; no remote methods are called", async () => {
  const f = fixture(); await assert.rejects(f.desk.deliver("d", "toutiao", "作者", f.state.drafts[0]!.updatedAt, "uid-1"), /尚未接通/); assert.equal(f.calls.length, 0);
});
test("manual review preserves prior receipt; new revision creates separate history", async () => {
  const f = fixture(); const receipt = await f.send(); f.state.drafts[0]!.title = "新版本";
  await assert.rejects(f.send(), /核对上次/);
  await f.desk.resolve("d", receipt.id, "reviewed"); const second = await f.send();
  assert.notEqual(second.id, receipt.id); assert.equal(f.state.drafts[0]!.socialDeliveries?.length, 2);
  assert.equal(second.revisionHash, socialRevisionHash(f.state.drafts[0]!, "zhihu"));
});

test("platform image rights and changed revisions fail before article creation", async () => {
  const f = fixture();
  f.state.drafts[0]!.images = [{ id: "cover", afterParagraph: 0, caption: "封面", image: { id: "asset", caption: "封面", url: "/media/cover.png", localPath: "/not-available/cover.png", rights: "owned", selected: true, attribution: "作者", sourceUrl: "https://example.com", allowedPlatforms: ["wechat"] } }];
  f.state.drafts[0]!.bodyHtml += '<img data-media-id="cover" src="/media/cover.png">';
  await assert.rejects(f.send(), /图片/); assert.equal(f.calls.includes("uploadImage"), false); assert.equal(f.calls.includes("syncArticle"), false);
  f.state.drafts[0]!.images = []; f.state.drafts[0]!.bodyHtml = "<p>正文。</p>";
  f.setQuality(async () => { f.state.drafts[0]!.title = "准备期间修改"; });
  await assert.rejects(f.send(), /正文发生变化/); assert.equal(f.calls.includes("syncArticle"), false);
});
test("same displayed name with a different user ID is rejected", async () => {
  const f = fixture();
  await assert.rejects(f.desk.deliver("d", "zhihu", "作者", f.state.drafts[0]!.updatedAt, "another-uid"), /账号已变化/);
  assert.equal(f.calls.includes("syncArticle"), false);
});
