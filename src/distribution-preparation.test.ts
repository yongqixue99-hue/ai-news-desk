import assert from "node:assert/strict";
import test from "node:test";
import { prepareDistributionTargets } from "./distribution-preparation.js";

test("one-click preparation saves the article before preparing every available platform", async () => {
  const events: string[] = [];

  const result = await prepareDistributionTargets({
    save: async () => {
      events.push("saved");
    },
    targets: [
      {
        id: "wechat",
        available: true,
        prepare: async () => {
          events.push("wechat");
          return "公众号草稿已同步";
        },
      },
      {
        id: "xiaoheihe",
        available: true,
        prepare: async () => {
          events.push("xiaoheihe");
          return "小黑盒编辑器已填入";
        },
      },
    ],
  });

  assert.equal(events[0], "saved");
  assert.deepEqual(new Set(events.slice(1)), new Set(["wechat", "xiaoheihe"]));
  assert.equal(result.outcome, "prepared");
  assert.equal(result.finalPublishAttempted, false);
  assert.deepEqual(result.targets, [
    { id: "wechat", status: "prepared", detail: "公众号草稿已同步" },
    { id: "xiaoheihe", status: "prepared", detail: "小黑盒编辑器已填入" },
  ]);
});

test("one platform failure is reported without cancelling the other platform", async () => {
  let xiaoheihePrepared = false;

  const result = await prepareDistributionTargets({
    save: async () => undefined,
    targets: [
      {
        id: "wechat",
        available: true,
        prepare: async () => {
          throw new Error("公众号图片权限未通过");
        },
      },
      {
        id: "xiaoheihe",
        available: true,
        prepare: async () => {
          xiaoheihePrepared = true;
          return "小黑盒编辑器已填入";
        },
      },
    ],
  });

  assert.equal(xiaoheihePrepared, true);
  assert.equal(result.outcome, "partial");
  assert.equal(result.finalPublishAttempted, false);
  assert.deepEqual(result.targets, [
    { id: "wechat", status: "failed", detail: "公众号图片权限未通过" },
    { id: "xiaoheihe", status: "prepared", detail: "小黑盒编辑器已填入" },
  ]);
});

test("an unconnected platform is skipped while connected platforms are still prepared", async () => {
  let unavailablePlatformCalled = false;

  const result = await prepareDistributionTargets({
    save: async () => undefined,
    targets: [
      {
        id: "wechat",
        available: false,
        unavailableReason: "微信公众号尚未连接",
        prepare: async () => {
          unavailablePlatformCalled = true;
          return "不应执行";
        },
      },
      {
        id: "xiaoheihe",
        available: true,
        prepare: async () => "小黑盒编辑器已填入",
      },
    ],
  });

  assert.equal(unavailablePlatformCalled, false);
  assert.equal(result.outcome, "partial");
  assert.deepEqual(result.targets, [
    { id: "wechat", status: "skipped", detail: "微信公众号尚未连接" },
    { id: "xiaoheihe", status: "prepared", detail: "小黑盒编辑器已填入" },
  ]);
});
