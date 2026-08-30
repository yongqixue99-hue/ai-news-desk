import assert from "node:assert/strict";
import test from "node:test";
import { ExtensionPublisherBridge, type ExtensionPublisherJob } from "./publisher-extension.js";

const job = (id = "job-1"): ExtensionPublisherJob => ({
  id,
  draftId: "draft-1",
  createdAt: "2026-08-12T00:00:00.000Z",
  editorUrl: "https://xiaoheihe.cn/community/user/post_list",
  contentFormat: "article",
  title: "测试标题",
  bodyHtml: "<p>测试正文</p>",
  community: "盒友杂谈",
  topics: ["openai"],
  images: [],
});

test("extension image jobs carry the native Xiaoheihe description", () => {
  const image = {
    id: "placement-1",
    fileName: "image.png",
    mimeType: "image/png",
    dataUrl: "data:image/png;base64,AA==",
    caption: "广告示意图",
  } satisfies ExtensionPublisherJob["images"][number];
  assert.equal(image.caption, "广告示意图");
});

test("extension bridge becomes ready only after an authenticated heartbeat", () => {
  let now = 1_000;
  const bridge = new ExtensionPublisherBridge(() => now, 500);
  assert.equal(bridge.status().ok, false);
  assert.throws(() => bridge.heartbeat("wrong", "client-1", "0.1.0"), /配对/);

  const status = bridge.heartbeat(bridge.token, "client-1", "0.1.0");
  assert.equal(status.ok, true);
  assert.match(status.detail, /常用 Chrome/);

  now += 45_001;
  assert.equal(bridge.status().ok, false);
});

test("extension bridge gives a job to one client and resolves its report", async () => {
  const bridge = new ExtensionPublisherBridge(Date.now, 1_000);
  bridge.heartbeat(bridge.token, "client-1", "0.1.0");
  const completion = bridge.submit(job());

  assert.equal(bridge.claim(bridge.token, "client-1")?.id, "job-1");
  assert.equal(bridge.claim(bridge.token, "client-1"), undefined);
  assert.throws(
    () => bridge.complete(bridge.token, "another-client", "job-1", { steps: [] }),
    /不属于/,
  );

  bridge.complete(bridge.token, "client-1", "job-1", {
    pageUrl: "https://xiaoheihe.cn/editor",
    steps: [
      { name: "标题", ok: true, detail: "标题已填入" },
      { name: "正文", ok: true, detail: "正文已填入" },
    ],
  });
  const report = await completion;
  assert.equal(report.pageUrl, "https://xiaoheihe.cn/editor");
  assert.equal(report.steps.length, 2);
});

test("extension bridge rejects publishing while the helper is disconnected", () => {
  const bridge = new ExtensionPublisherBridge(Date.now, 20);
  assert.throws(() => bridge.submit(job()), /尚未连接/);
});
