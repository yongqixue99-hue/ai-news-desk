import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { publicationRevisionHash } from "./publication-state.js";
import { editableDraftContent } from "../src/draft-stability.js";

test("WeChat delivery metadata survives editor persistence and invalidates only its own platform", () => {
  const draft = createBlankDraftInState(createDefaultState());
  const beforeWechat = publicationRevisionHash(draft, "wechat");
  const beforeXhh = publicationRevisionHash(draft, "xiaoheihe");
  Object.assign(draft, { wechatMetadata: { author: "作者", digest: "这篇摘要", contentSourceUrl: "https://example.com/source", coverPlacementId: "cover-2" } });
  assert.deepEqual(editableDraftContent(draft).wechatMetadata, draft.wechatMetadata, "save and recovery must retain the platform form");
  assert.notEqual(publicationRevisionHash(draft, "wechat"), beforeWechat, "metadata edits must invalidate the previously delivered revision");
  assert.equal(publicationRevisionHash(draft, "xiaoheihe"), beforeXhh);
});

import { beginWeChatAttempt, resolveWeChatAttempt, primaryDeliveryStatus } from "./primary-delivery.js";
test("ambiguous WeChat writes remain blocked after restart until the exact attempt is resolved", () => {
  const draft = createBlankDraftInState(createDefaultState());
  const attempt = beginWeChatAttempt(draft, "wx-a", "created");
  const reloaded = JSON.parse(JSON.stringify(draft));
  assert.throws(() => beginWeChatAttempt(reloaded, "wx-a", "created"), /尚未核对/);
  assert.equal(primaryDeliveryStatus(reloaded, "wx-a").wechat.status, "unknown");
  assert.throws(() => resolveWeChatAttempt(reloaded, "other"), /已变化/);
  resolveWeChatAttempt(reloaded, attempt.id);
  assert.doesNotThrow(() => beginWeChatAttempt(reloaded, "wx-a", "created"));
  assert.equal(reloaded.wechatSyncAttempts.length, 2);
});

test("saved Xiaoheihe edits remain stale after dirty state clears", () => {
  const draft = createBlankDraftInState(createDefaultState());
  draft.publisherReceipt = { outcome: "filled", revisionHash: publicationRevisionHash(draft, "xiaoheihe") } as any;
  assert.equal(primaryDeliveryStatus(draft, "wx-a").xiaoheihe.status, "current");
  draft.title = "已保存的新标题";
  assert.equal(primaryDeliveryStatus(draft, "wx-a").xiaoheihe.status, "changed");
});
