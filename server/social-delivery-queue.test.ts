import assert from "node:assert/strict";
import test from "node:test";
import { createSocialDeliveryQueue } from "./social-delivery-queue.js";
import { socialAccounts, socialRevisionHash } from "./social-delivery.js";
import { socialPlatforms, socialTitleProblem, selectedSocialPlatforms, type SocialDeliveryReceipt, type SocialDeliveryStatus, type SocialPlatform } from "./social-delivery-types.js";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState, restoreDraftFromTrashInState, trashDraftsInState } from "./draft-library.js";
import type { WorkflowState } from "./types.js";

const fixture = () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state); draft.title = "一篇测试文章"; draft.bodyHtml = "<p>测试正文</p>";
  let clock = Date.parse(draft.createdAt);
  const connection: SocialDeliveryStatus = { settings: { enabled: true, extensionId: "", tokenConfigured: true }, address: "", connected: false, detail: "", accounts: socialAccounts([]) };
  const sent: SocialPlatform[] = []; const opened: SocialPlatform[][] = []; const openedDrafts: string[] = [];
  let fail: SocialPlatform | undefined;
  let gate: Promise<void> | undefined;
  let onStatus = () => {};
  const dependencies = {
    read: async () => structuredClone(state),
    update: async <T>(fn: (state: WorkflowState) => T) => fn(state),
    status: async () => { onStatus(); return structuredClone(connection); },
    open: async (platforms: SocialPlatform[]) => { opened.push(platforms); },
    openReceipt: async (receipt: SocialDeliveryReceipt) => { openedDrafts.push(receipt.id); },
    now: () => clock,
    deliver: async (_id: string, platform: SocialPlatform, account: string, _version: string, accountId: string): Promise<SocialDeliveryReceipt> => {
      sent.push(platform); if (platform === fail) throw new Error("图片授权待补充");
      const receipt: SocialDeliveryReceipt = { id: `${platform}-${sent.length}`, platform, account, accountId, title: draft.title, revisionHash: socialRevisionHash(draft, platform), createdAt: new Date(clock).toISOString(), updatedAt: new Date(clock).toISOString(), status: "reported", detail: "助手已返回草稿回执", finalPublishAttempted: false };
      (draft.socialDeliveries ??= []).unshift(receipt);
      await gate;
      return receipt;
    },
  };
  const queue = createSocialDeliveryQueue(dependencies);
  const login = (platforms: SocialPlatform[], uid = "user-1") => {
    connection.connected = true;
    connection.accounts = socialAccounts(socialPlatforms.filter(p => p.enabled).map(p => ({ id: p.id, isAuthenticated: platforms.includes(p.id), username: "作者", userId: uid })));
  };
  return { state, draft, connection, sent, opened, openedDrafts, queue, dependencies, login,
    start: (platforms: SocialPlatform[] = ["baijiahao"]) => queue.start(draft.id, platforms, draft.updatedAt),
    target: (platform: SocialPlatform = "baijiahao") => draft.socialDeliveryBatches![0]!.targets.find(t => t.platform === platform)!,
    fail: (platform: SocialPlatform) => { fail = platform; },
    gate: (promise: Promise<void>) => { gate = promise; },
    advance: (ms: number) => { clock += ms; }, onStatus: (fn: () => void) => { onStatus = fn; },
  };
};

test("catalog uses real edit entries and individual title limits", () => {
  assert.equal(socialPlatforms.find(p => p.id === "toutiao")!.url, "https://mp.toutiao.com/profile_v4/graphic/publish");
  assert.equal(socialPlatforms.find(p => p.id === "baijiahao")!.url, "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1");
  assert.equal(socialTitleProblem("baijiahao", "字".repeat(64)), "");
  assert.match(socialTitleProblem("toutiao", "字".repeat(31)), /2–30/);
  assert.deepEqual(selectedSocialPlatforms(["baijiahao", "baijiahao"]), ["baijiahao"]);
  for (const input of [[], ["https://evil.example/"], "baijiahao", ["--user-data-dir=other"]]) assert.throws(() => selectedSocialPlatforms(input));
});
test("disconnected transport is unknown, not logged out", () => {
  assert.equal(socialAccounts([]).find(p => p.id === "baijiahao")!.authState, "unknown");
  assert.equal(socialAccounts([{ id: "baijiahao" }]).find(p => p.id === "baijiahao")!.authState, "unknown");
  assert.equal(socialAccounts([{ id: "baijiahao", isAuthenticated: false }]).find(p => p.id === "baijiahao")!.authState, "signed-out");
});
test("opens selected entries once, waits for bridge then login, and resumes once", async () => {
  const f = fixture(); const batch = await f.start();
  assert.deepEqual(f.opened, [["baijiahao"]]);
  assert.equal((await f.start()).id, batch.id); assert.equal(f.opened.length, 1);
  await f.queue.tick(); assert.equal(f.target().status, "waiting-connection");
  f.login([]); await f.queue.tick(); assert.equal(f.target().status, "waiting-login");
  f.login(["baijiahao"]); await f.queue.tick(); await f.queue.tick();
  assert.deepEqual(f.sent, ["baijiahao"]); assert.equal(f.target().status, "reported");
  assert.deepEqual(f.openedDrafts, ["baijiahao-1"]);
  assert.equal(f.target().accountId, "user-1");
});
test("one blocked or logged-out platform does not prevent a ready target", async () => {
  const f = fixture(); f.login(["baijiahao"]); await f.start(["baijiahao", "zhihu", "toutiao"]); await f.queue.tick();
  assert.deepEqual(f.sent, ["baijiahao"]); assert.equal(f.target("zhihu").status, "waiting-login"); assert.equal(f.target("toutiao").status, "blocked");
  f.login(["baijiahao", "zhihu"]); await f.queue.tick(); assert.deepEqual(f.sent, ["baijiahao", "zhihu"]);
});
test("preflight failure stays local to a target", async () => {
  const f = fixture(); f.login(["baijiahao", "zhihu"]); f.fail("baijiahao"); await f.start(["baijiahao", "zhihu"]); await f.queue.tick();
  assert.equal(f.target().status, "blocked"); assert.equal(f.target("zhihu").status, "reported");
});
test("unsupported targets and invalid titles never reach transport", async () => {
  const f = fixture(); f.login(["baijiahao"]); f.draft.title = "字"; await f.start(["baijiahao", "toutiao"]); await f.queue.tick();
  assert.equal(f.sent.length, 0); assert.match(f.target().detail, /2–64/);
  await assert.rejects(f.queue.start(f.draft.id, ["baijiahao"], "stale"), /草稿已变化/);
});
test("changed content, account, or expired login wait require a new user action", async () => {
  for (const reason of ["content", "account", "expired"]) {
    const f = fixture();
    await f.queue.start(f.draft.id, ["baijiahao"], f.draft.updatedAt, { baijiahao: { account: "作者", accountId: "user-1" } });
    if (reason === "content") f.draft.bodyHtml = "<p>用户修改的正文</p>";
    if (reason === "expired") f.advance(10 * 60_000);
    f.login(["baijiahao"], reason === "account" ? "other-user" : "user-1"); await f.queue.tick();
    assert.equal(f.target().status, "blocked"); assert.equal(f.sent.length, 0);
  }
});
test("cancelling while auth detection is in flight prevents sending", async () => {
  const f = fixture(); f.login(["baijiahao"]); const batch = await f.start();
  f.onStatus(() => { void f.queue.cancel(f.draft.id, batch.id); }); await f.queue.tick();
  assert.equal(f.target().status, "cancelled"); assert.equal(f.sent.length, 0);
});
test("concurrent worker polls do not duplicate remote requests and cannot cancel a send", async () => {
  const f = fixture(); f.login(["baijiahao"]); const batch = await f.start();
  let release!: () => void; f.gate(new Promise<void>(resolve => { release = resolve; }));
  const sending = f.queue.tick();
  while (!f.sent.length) await new Promise(resolve => setImmediate(resolve));
  await f.queue.tick(); await f.queue.cancel(f.draft.id, batch.id); assert.equal(f.target().status, "sending");
  release(); await sending; assert.equal(f.sent.length, 1); assert.equal(f.target().status, "reported");
});
test("worker restart recovers the receipt of an interrupted send without resending", async () => {
  for (const status of ["sending", "reported", "unknown"] as const) {
    const f = fixture(); f.login(["baijiahao"]); await f.start(); await f.queue.tick();
    f.target().status = "sending"; f.draft.socialDeliveries![0]!.status = status;
    const restarted = createSocialDeliveryQueue(f.dependencies); await restarted.tick();
    assert.equal(f.sent.length, 1); assert.equal(f.target().status, status === "reported" ? "reported" : "unknown");
  }
});
test("trashed and restored drafts never resume a previously queued delivery", async () => {
  const f = fixture(); await f.start(); trashDraftsInState(f.state, [{ id: f.draft.id, updatedAt: f.draft.updatedAt }]);
  restoreDraftFromTrashInState(f.state, f.draft.id); f.login(["baijiahao"]); await f.queue.tick();
  assert.equal(f.sent.length, 0); assert.equal(f.target().status, "cancelled");
});
