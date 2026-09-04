import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import {
  ExtensionPublisherBridge,
  MINIMUM_EXTENSION_VERSION,
  fillViaChromeExtension,
  prepareJob,
  type ExtensionPublisherJob,
} from "./publisher-extension.js";
import { publicationRevisionHash } from "./publication-state.js";
import { workflowMediaRoot } from "./storage.js";
import type { ArticleDraft } from "./types.js";

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

test("the app rejects extension versions from before reliable article routing", () => {
  assert.equal(MINIMUM_EXTENSION_VERSION, "0.1.22");
});

test("an article job targets Xiaoheihe's direct article editor instead of the content list", async () => {
  const draft: ArticleDraft = {
    id: "draft-direct-article-editor",
    runId: "run-1",
    candidateId: "candidate-1",
    createdAt: "2026-09-05T00:00:00.000Z",
    updatedAt: "2026-09-05T00:00:00.000Z",
    status: "ready",
    title: "文章编辑器直达测试",
    paragraphs: ["这是一段用于核验小黑盒文章编辑器直达路由的正文。"],
    take: "",
    bodyHtml: "<p>这是一段用于核验小黑盒文章编辑器直达路由的正文。</p>",
    sources: [],
    uncertainties: [],
    images: [],
    community: "盒友杂谈",
    topics: ["AI"],
    provenance: {
      originalUrl: "https://example.com/source",
      generatedBy: "test",
    },
  };

  const prepared = await prepareJob(draft, "https://xiaoheihe.cn/community/user/post_list");
  assert.equal(prepared.editorUrl, "https://www.xiaoheihe.cn/creator/editor/draft/article");
});

test("preparing an extension job rejects an inserted image whose local file is missing", async () => {
  const missingPath = path.join(workflowMediaRoot, "publisher-extension-test", "missing.png");
  const draft: ArticleDraft = {
    id: "draft-with-missing-image",
    runId: "run-1",
    candidateId: "candidate-1",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    status: "ready",
    title: "发布图片缺失测试",
    paragraphs: ["这是一段满足发布长度要求的正文，用来验证图片缺失时任务会中止。"],
    take: "",
    bodyHtml: '<p>这是一段满足发布长度要求的正文。</p><img src="/media/missing.png" data-media-id="placement_missing">',
    sources: [],
    uncertainties: [],
    images: [{
      id: "placement_missing",
      afterParagraph: 0,
      caption: "缺失图片",
      image: {
        id: "image_missing",
        url: "/media/missing.png",
        localPath: missingPath,
        publicPath: "/media/missing.png",
        caption: "缺失图片",
        attribution: "测试素材",
        sourceUrl: "https://example.com/source",
        selected: true,
        rights: "owned",
      },
    }],
    community: "盒友杂谈",
    topics: ["AI"],
    provenance: {
      originalUrl: "https://example.com/source",
      generatedBy: "test",
    },
  };

  await assert.rejects(
    prepareJob(draft, "https://xiaoheihe.cn/community/user/post_list"),
    /placement_missing.*(?:不存在|无法读取)/u,
  );
});

test("a preflight snapshot is rejected when the stored draft changes before extension dispatch", async () => {
  const snapshot: ArticleDraft = {
    id: "draft-preflight-snapshot",
    runId: "run-1",
    candidateId: "candidate-1",
    createdAt: "2026-08-31T00:00:00.000Z",
    updatedAt: "2026-08-31T00:00:00.000Z",
    status: "ready",
    title: "预检时的标题",
    paragraphs: ["这是预检时冻结的正文快照。"],
    take: "",
    bodyHtml: "<p>这是预检时冻结的正文快照，长度足够用于发布填入测试。</p>",
    sources: [],
    uncertainties: [],
    images: [],
    community: "盒友杂谈",
    topics: ["AI"],
    provenance: {
      originalUrl: "https://example.com/source",
      generatedBy: "test",
    },
  };
  const expectedRevisionHash = publicationRevisionHash(snapshot, "xiaoheihe");
  const current = structuredClone(snapshot);
  current.title = "用户在预检后保存的新标题";
  let submitted = false;

  await assert.rejects(
    fillViaChromeExtension(
      snapshot,
      expectedRevisionHash,
      "https://xiaoheihe.cn/community/user/post_list",
      {
        loadCurrentDraft: async () => current,
        submit: async () => {
          submitted = true;
          return { steps: [] };
        },
      },
    ),
    /预检后.*重新预检/u,
  );
  assert.equal(submitted, false);
});

test("extension bridge becomes ready only after an authenticated heartbeat", () => {
  let now = 1_000;
  const bridge = new ExtensionPublisherBridge(() => now, 500);
  assert.equal(bridge.status().ok, false);
  assert.throws(() => bridge.heartbeat("wrong", "client-1", "0.1.0"), /配对/);

  const status = bridge.heartbeat(bridge.token, "client-1", MINIMUM_EXTENSION_VERSION);
  assert.equal(status.ok, true);
  assert.match(status.detail, /常用 Chrome/);

  now += 45_001;
  assert.equal(bridge.status().ok, false);
});

test("an outdated page bridge cannot overwrite the current compatible extension", () => {
  const bridge = new ExtensionPublisherBridge(Date.now, 500);
  bridge.heartbeat(bridge.token, "extension-id", MINIMUM_EXTENSION_VERSION);

  assert.throws(
    () => bridge.heartbeat(bridge.token, "extension-id", "0.1.21"),
    /版本.*过低/u,
  );
  assert.match(bridge.status().detail, new RegExp(`v${MINIMUM_EXTENSION_VERSION.replaceAll(".", "\\.")}`));
});

test("extension bridge gives a job to one client and resolves its report", async () => {
  const bridge = new ExtensionPublisherBridge(Date.now, 1_000);
  bridge.heartbeat(bridge.token, "client-1", MINIMUM_EXTENSION_VERSION);
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
