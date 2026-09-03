import assert from "node:assert/strict";
import test from "node:test";
import { buildDistributionTargets } from "./distribution-view.js";

const draft = {
  id: "draft-1",
  updatedAt: "2026-09-04T08:00:00.000Z",
};

test("distribution view exposes the two real delivery targets without claiming final publication", () => {
  const targets = buildDistributionTargets({
    draft,
    dirty: false,
    publisherReady: true,
    wechatConfigured: true,
  });

  assert.deepEqual(targets.map((target) => target.id), ["wechat", "xiaoheihe"]);
  assert.deepEqual(targets.map((target) => target.operation), ["同步草稿箱", "填入编辑器"]);
  assert.ok(targets.every((target) => target.finalPublish === "manual"));
  assert.deepEqual(targets.map((target) => target.status), ["ready", "ready"]);
});

test("distribution view makes current, stale, and setup-required states explicit", () => {
  const current = buildDistributionTargets({
    draft: {
      ...draft,
      wechatDraft: {
        localDraftUpdatedAt: draft.updatedAt,
      },
      publisherReceipt: { outcome: "filled" },
    },
    dirty: false,
    publisherReady: true,
    wechatConfigured: true,
  });
  assert.deepEqual(current.map((target) => target.status), ["current", "current"]);

  const stale = buildDistributionTargets({
    draft: {
      ...draft,
      wechatDraft: { localDraftUpdatedAt: "2026-09-04T07:00:00.000Z" },
      publisherReceipt: { outcome: "filled" },
    },
    dirty: true,
    publisherReady: false,
    wechatConfigured: false,
  });
  assert.deepEqual(stale.map((target) => target.status), ["stale", "stale"]);

  const setup = buildDistributionTargets({
    draft,
    dirty: false,
    publisherReady: false,
    wechatConfigured: false,
  });
  assert.deepEqual(setup.map((target) => target.status), ["setup", "setup"]);
});
