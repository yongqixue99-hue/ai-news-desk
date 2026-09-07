import assert from "node:assert/strict";
import test from "node:test";
import {
  appendEditorialReadiness,
  completePublisherAttempt,
  createPublisherAttempt,
  publisherRuntimeFromStatus,
  evaluatePublisherPreflight,
} from "./publisher-preflight.js";

test("CDP gallery delivery has one actionable protocol capability", () => {
  const result = evaluatePublisherPreflight({
    runtime: { mode: "cdp", connected: true },
    draft: { id: "gallery-cdp", contentFormat: "image-post", title: "图集测试", bodyHtml: "<p>用于检查图文通道。</p>", community: "盒友杂谈", topics: ["AI"], images: [{ id: "one", available: true, caption: "测试图片" }] },
  });
  assert.equal(result.canQueueFill, false);
  assert.equal(result.capabilities.filter(item => item.id === "protocol").length, 1);
  assert.ok(result.blocking.some(item => item.code === "PREFLIGHT_IMAGE_POST_EXTENSION_REQUIRED"));
});

test("editorial blockers are added without hiding transport or title failures", () => {
  const preflight = evaluatePublisherPreflight({
    runtime: { mode: "chrome-extension", connected: false },
    draft: {
      id: "draft-multiple-blockers",
      title: "这是一个明确超过小黑盒三十字标题限制并且不应该被摘要漏掉的测试标题",
      bodyHtml: "<p>这是一段长度足够的正文，用来证明版权问题加入后，连接和标题错误仍会被完整保留。</p>",
      community: "盒友杂谈",
      topics: ["AI"],
      images: [],
    },
  });

  appendEditorialReadiness(preflight, {
    ready: false,
    blockers: ["图片：截图还没有获得小黑盒平台使用许可"],
    warnings: [],
  });

  assert.equal(preflight.canQueueFill, false);
  assert.equal(preflight.blocking.some((issue) => issue.code === "PREFLIGHT_TRANSPORT_DISCONNECTED"), true);
  assert.equal(preflight.blocking.some((issue) => issue.code === "PREFLIGHT_TITLE_TOO_LONG"), true);
  assert.equal(preflight.blocking.some((issue) => issue.code === "PREFLIGHT_EDITORIAL_READINESS"), true);
  assert.match(preflight.summary, new RegExp(`有 ${preflight.blocking.length} 项阻止填入`));
});

test("a connected, live Xiaoheihe editor with a complete draft is ready to fill", () => {
  const result = evaluatePublisherPreflight({
    checkedAt: "2026-08-13T00:00:00.000Z",
    minimumProtocolVersion: "0.1.14",
    runtime: {
      mode: "chrome-extension",
      connected: true,
      detail: "常用 Chrome 填入助手已连接 · v0.1.14",
      loggedIn: true,
      editorReady: true,
      pageUrl: "https://www.xiaoheihe.cn/app/bbs/editor",
    },
    draft: {
      id: "draft-1",
      title: "ChatGPT 广告功能扩大测试范围",
      bodyHtml: "<p>OpenAI 更新了 ChatGPT 广告测试范围，更多地区的免费用户将看到独立标记的广告内容。</p>",
      community: "盒友杂谈",
      topics: ["OpenAI", "ChatGPT"],
      images: [{ id: "image-1", available: true, caption: "ChatGPT 广告设置页面" }],
    },
  });

  assert.equal(result.canQueueFill, true);
  assert.equal(result.publishReady, true);
  assert.equal(result.finalPublish.manualOnly, true);
  assert.equal(result.finalPublish.willClickPublish, false);
  assert.deepEqual(result.blocking, []);
  assert.equal(result.capabilities.every((capability) => capability.status === "pass"), true);
});

test("preflight returns actionable blockers for an outdated helper and incomplete payload", () => {
  const result = evaluatePublisherPreflight({
    checkedAt: "2026-08-13T00:00:00.000Z",
    minimumProtocolVersion: "0.1.14",
    runtime: {
      mode: "chrome-extension",
      connected: false,
      detail: "常用 Chrome 填入助手已断开 · v0.1.7",
      editorReady: false,
    },
    draft: {
      id: "draft-broken",
      title: "这是一个超过小黑盒三十字标题上限且无法原样填入编辑器的测试标题",
      bodyHtml: "<p>太短</p>",
      community: "",
      topics: ["一", "二", "三", "四", "五", "六"],
      images: [{ id: "missing-image", available: false, caption: "" }],
    },
  });

  assert.equal(result.canQueueFill, false);
  assert.equal(result.publishReady, false);
  assert.equal(result.requiresLiveProbe, true);
  assert.deepEqual(
    result.blocking.map((issue) => issue.code),
    [
      "PREFLIGHT_TRANSPORT_DISCONNECTED",
      "PREFLIGHT_PROTOCOL_OUTDATED",
      "PREFLIGHT_EDITOR_NOT_READY",
      "PREFLIGHT_TITLE_TOO_LONG",
      "PREFLIGHT_BODY_TOO_SHORT",
      "PREFLIGHT_IMAGES_MISSING",
      "PREFLIGHT_CAPTIONS_MISSING",
      "PREFLIGHT_COMMUNITY_MISSING",
      "PREFLIGHT_TOPICS_TOO_MANY",
    ],
  );
  assert.equal(result.warnings[0]?.code, "PREFLIGHT_LOGIN_UNKNOWN");
  assert.match(result.blocking[0]?.action || "", /扩展|助手/);
});

test("a fill attempt produces a structured receipt without ever publishing", () => {
  const preflight = evaluatePublisherPreflight({
    checkedAt: "2026-08-13T00:00:00.000Z",
    expectedRevisionHash: "preflight-revision-1",
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.14",
    },
    draft: {
      id: "draft-receipt",
      title: "OpenAI 更新 ChatGPT 广告测试",
      bodyHtml: "<p>OpenAI 扩大了 ChatGPT 广告测试范围，并说明广告与回答会分开显示。</p>",
      community: "盒友杂谈",
      topics: ["OpenAI"],
      images: [{ id: "image-1", available: true, caption: "广告控制页面" }],
    },
  });
  const attempt = createPublisherAttempt(preflight, {
    attemptId: "attempt-1",
    startedAt: "2026-08-13T00:01:00.000Z",
  });

  assert.equal(attempt.status, "running");
  assert.equal(attempt.safety.operation, "fill-only");
  assert.equal(attempt.safety.finalPublishAllowed, false);

  const receipt = completePublisherAttempt(attempt, {
    completedAt: "2026-08-13T00:02:00.000Z",
    pageUrl: "https://www.xiaoheihe.cn/app/bbs/editor",
    steps: [
      { name: "标题", ok: true, detail: "标题已填入并验证" },
      { name: "正文", ok: true, detail: "正文已填入并验证" },
      { name: "配图", ok: true, detail: "图片与图注已填入" },
      { name: "分区", ok: true, detail: "已选择盒友杂谈" },
      { name: "话题", ok: true, detail: "已选择 OpenAI" },
    ],
  });

  assert.equal(receipt.schemaVersion, "publisher-receipt/v1");
  assert.equal(receipt.revisionHash, "preflight-revision-1");
  assert.equal(receipt.outcome, "filled");
  assert.equal(receipt.safety.finalPublishAttempted, false);
  assert.equal(receipt.safety.finalPublishPerformed, false);
  assert.deepEqual(receipt.usedImageIds, ["image-1"]);
  assert.equal(receipt.checks.every((check) => check.ok), true);
  assert.match(receipt.summary, /填入.*最终发布/);
});

test("a text-only draft remains fillable but clearly warns that it has no image", () => {
  const result = evaluatePublisherPreflight({
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.14",
      loggedIn: true,
      editorReady: true,
    },
    draft: {
      id: "draft-text-only",
      title: "一篇没有配图的新闻快讯",
      bodyHtml: "<p>这是一段满足长度要求、可以正常填入小黑盒编辑器的新闻快讯正文。</p>",
      community: "盒友杂谈",
      topics: ["AI"],
      images: [],
    },
  });

  assert.equal(result.canQueueFill, true);
  assert.equal(result.publishReady, true);
  assert.equal(result.warnings.some((warning) => warning.code === "PREFLIGHT_IMAGES_EMPTY"), true);
  assert.equal(result.capabilities.find((capability) => capability.id === "images")?.status, "warning");
});

test("an image post can intentionally omit topics without inventing tags", () => {
  const result = evaluatePublisherPreflight({
    minimumProtocolVersion: "0.1.16",
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.16",
      loggedIn: true,
      editorReady: true,
    },
    draft: {
      id: "draft-image-post",
      contentFormat: "image-post",
      title: "Codex 弹出 8 美元重置按钮",
      bodyHtml: "<p>额度耗尽后，页面直接出现了付费重置按钮。</p>",
      community: "盒友杂谈",
      topics: [],
      images: [{ id: "image", available: true, caption: "截图中的重置按钮" }],
    },
  });

  assert.equal(result.canQueueFill, true);
  assert.equal(result.publishReady, true);
  assert.equal(result.capabilities.find((capability) => capability.id === "topics")?.status, "warning");
  assert.match(result.warnings.find((warning) => warning.capability === "topics")?.message || "", /不会自动生成标签/);
});

test("an unprobed login and editor are described as fill-time checks, not user failures", () => {
  const result = evaluatePublisherPreflight({
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.21",
    },
    draft: {
      id: "draft-unprobed-browser",
      title: "小黑盒填入探针说明",
      bodyHtml: "<p>这是一段满足长度要求的正文，浏览器登录与编辑器将在真正填入时由扩展自动核验。</p>",
      community: "盒友杂谈",
      topics: ["AI"],
      images: [],
    },
  });

  assert.equal(result.canQueueFill, true);
  assert.equal(result.capabilities.find((item) => item.id === "login")?.detail, "尚未探测；填入时自动确认登录状态");
  assert.equal(result.capabilities.find((item) => item.id === "editor")?.detail, "尚未探测；填入时自动打开并确认文章编辑器");
  assert.equal(result.warnings.some((warning) => /等待页面探针/.test(warning.message)), false);
});

test("an image post accepts multiple available original images", () => {
  const result = evaluatePublisherPreflight({
    minimumProtocolVersion: "0.1.17",
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.17",
      loggedIn: true,
      editorReady: true,
    },
    draft: {
      id: "draft-image-post-too-many-images",
      contentFormat: "image-post",
      title: "图文稿图片数量检查",
      bodyHtml: "<p>这是一段满足长度要求、但错误插入了两张图片的图文稿正文。</p>",
      community: "盒友杂谈",
      topics: [],
      images: [
        { id: "image-one", available: true, caption: "第一张图" },
        { id: "image-two", available: true, caption: "第二张图" },
      ],
    },
  });

  assert.equal(result.canQueueFill, true);
  assert.equal(result.publishReady, true);
  assert.equal(
    result.blocking.some((issue) => issue.code === "PREFLIGHT_IMAGE_POST_IMAGE_COUNT"),
    false,
  );
});

test("CDP mode does not require the Chrome extension protocol version", () => {
  const result = evaluatePublisherPreflight({
    runtime: {
      mode: "cdp",
      connected: true,
      detail: "Chrome 已连接 · 1 个页面",
      loggedIn: true,
      editorReady: true,
    },
    draft: {
      id: "draft-cdp",
      title: "CDP 填入测试",
      bodyHtml: "<p>这是一段完整正文，用于确认专用 Chrome 模式不受扩展协议版本约束。</p>",
      community: "盒友杂谈",
      topics: ["科技"],
      images: [{ id: "image", available: true, caption: "测试图片" }],
    },
  });

  assert.equal(result.canQueueFill, true);
  assert.equal(result.capabilities.find((capability) => capability.id === "protocol")?.status, "pass");
  assert.match(result.capabilities.find((capability) => capability.id === "protocol")?.detail || "", /不适用/);
});

test("bridge status is converted into a versioned runtime snapshot with optional live probe", () => {
  const runtime = publisherRuntimeFromStatus(
    {
      mode: "chrome-extension",
      ok: true,
      detail: "常用 Chrome 填入助手已连接 · v0.1.14",
      connectedAt: "2026-08-13T00:00:00.000Z",
    },
    {
      loggedIn: true,
      editorReady: true,
      pageUrl: "https://www.xiaoheihe.cn/app/bbs/editor",
    },
  );

  assert.deepEqual(runtime, {
    mode: "chrome-extension",
    connected: true,
    detail: "常用 Chrome 填入助手已连接 · v0.1.14",
    protocolVersion: "0.1.14",
    loggedIn: true,
    editorReady: true,
    pageUrl: "https://www.xiaoheihe.cn/app/bbs/editor",
  });
});

test("a missing platform verification step yields a partial receipt, not a false success", () => {
  const preflight = evaluatePublisherPreflight({
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.14",
      loggedIn: true,
      editorReady: true,
    },
    draft: {
      id: "draft-partial",
      title: "发布回执缺项测试",
      bodyHtml: "<p>这是一段完整正文，用来确认扩展漏报话题步骤时不会产生虚假的成功回执。</p>",
      community: "盒友杂谈",
      topics: ["AI"],
      images: [{ id: "image", available: true, caption: "测试图片" }],
    },
  });
  const attempt = createPublisherAttempt(preflight, { attemptId: "attempt-partial" });
  const receipt = completePublisherAttempt(attempt, {
    steps: [
      { name: "标题", ok: true, detail: "已验证" },
      { name: "正文", ok: true, detail: "已验证" },
      { name: "配图", ok: true, detail: "已验证" },
      { name: "分区", ok: true, detail: "已验证" },
    ],
  });

  assert.equal(receipt.outcome, "partial");
  assert.deepEqual(receipt.blocking, [{ id: "topics", detail: "扩展没有返回话题核验结果" }]);
});

test("a browser page failure is preserved even when individual field reports look successful", () => {
  const preflight = evaluatePublisherPreflight({
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.14",
      loggedIn: true,
      editorReady: true,
    },
    draft: {
      id: "draft-page-error",
      title: "页面失败回执测试",
      bodyHtml: "<p>这是一段完整正文，用来确认页面级错误不会被后续字段成功结果错误覆盖。</p>",
      community: "盒友杂谈",
      topics: ["AI"],
      images: [{ id: "image", available: true, caption: "测试图片" }],
    },
  });
  const receipt = completePublisherAttempt(createPublisherAttempt(preflight), {
    steps: [
      { name: "标题", ok: true, detail: "已验证" },
      { name: "正文", ok: true, detail: "已验证" },
      { name: "配图", ok: true, detail: "已验证" },
      { name: "分区", ok: true, detail: "已验证" },
      { name: "话题", ok: true, detail: "已验证" },
      { name: "页面操作", ok: false, detail: "编辑器在核验期间跳转到了登录页" },
    ],
  });

  assert.equal(receipt.outcome, "partial");
  assert.equal(
    receipt.blocking.some((failure) => failure.id === "editor" && /登录页/.test(failure.detail)),
    true,
  );
});

test("successful editor writes confirm login and editor even when a later image step fails", () => {
  const preflight = evaluatePublisherPreflight({
    runtime: {
      mode: "chrome-extension",
      connected: true,
      protocolVersion: "0.1.21",
    },
    draft: {
      id: "draft-partial-page-proof",
      title: "编辑器实际填入状态测试",
      bodyHtml: "<p>标题和正文已经被页面接受，因此登录状态和文章编辑器不应继续显示为尚未确认。</p>",
      community: "盒友杂谈",
      topics: ["AI"],
      images: [{ id: "image", available: true, caption: "测试图片" }],
    },
  });
  const receipt = completePublisherAttempt(createPublisherAttempt(preflight), {
    steps: [
      { name: "标题", ok: true, detail: "标题已填入并验证" },
      { name: "正文", ok: true, detail: "正文已填入并验证" },
      { name: "配图", ok: false, detail: "图片模块未加载" },
      { name: "分区", ok: true, detail: "已选择盒友杂谈" },
      { name: "话题", ok: true, detail: "已选择 AI" },
    ],
  });

  assert.deepEqual(
    receipt.checks
      .filter((check) => check.id === "login" || check.id === "editor")
      .map((check) => ({ id: check.id, ok: check.ok, source: check.source })),
    [
      { id: "login", ok: true, source: "fill-inference" },
      { id: "editor", ok: true, source: "fill-inference" },
    ],
  );
});
