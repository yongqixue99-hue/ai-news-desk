import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-user-media-"));
process.env.AI_NEWS_DESK_WORKFLOW_ROOT = root;
const { saveUploadedDraftImage } = await import("./media.js");
const { createDefaultState, upgradeState } = await import("./defaults.js");
const { createBlankDraftInState } = await import("./draft-library.js");
const { evaluateDraftReadiness } = await import("./draft-readiness.js");
const { prepareJob } = await import("./publisher-extension.js");
const { evaluatePublisherPreflight } = await import("./publisher-preflight.js");
after(() => rm(root, { recursive: true, force: true }));

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRZkAAAAASUVORK5CYII=", "base64");
const fixture = async () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state);
  draft.title = "本地图片交付测试";
  const placement = await saveUploadedDraftImage(draft.id, png, "image/png", "test.png");
  draft.images = [placement];
  draft.bodyHtml = `<p>这是用户自己编辑的文章，图片由用户主动上传并插入正文。</p><img data-media-id="${placement.id}" src="${placement.image.publicPath}">`;
  return { state, draft, placement };
};

test("a personally uploaded image can be delivered without a second rights or platform checkbox", async () => {
  const { draft, placement } = await fixture();
  assert.equal(placement.image.rights, "user-provided");
  for (const platform of ["xiaoheihe", "wechat", "baijiahao"]) {
    const result = evaluateDraftReadiness(draft, platform);
    assert.deepEqual(result.imageReviews[0].blockers, []);
  }
  const job = await prepareJob(draft, "https://www.xiaoheihe.cn/creator/editor/draft/article");
  assert.equal(job.images.length, 1);
  assert.deepEqual(await readFile(placement.image.localPath!), png);
});

test("existing unreviewed local uploads are upgraded without changing the article or original media", async () => {
  const { state, draft, placement } = await fixture();
  placement.image.rights = "check-required";
  delete placement.image.allowedPlatforms;
  delete placement.image.evidenceNote;
  const originalBody = draft.bodyHtml;
  const upgraded = upgradeState(state).drafts.find(item => item.id === draft.id)!;
  assert.equal(upgraded.images[0].image.rights, "user-provided");
  assert.deepEqual(upgraded.images[0].image.allowedPlatforms, ["*"]);
  assert.equal(upgraded.bodyHtml, originalBody);
  assert.deepEqual(await readFile(placement.image.localPath!), png);
});

test("automatic source images and explicit user restrictions are not reclassified as personal uploads", async () => {
  for (const patch of [
    { sourceUrl: "https://example.com/source" },
    { allowedPlatforms: [] },
    { expiresAt: "2026-01-01T00:00:00Z" },
    { rights: "expired" as const },
  ]) {
    const { state, draft, placement } = await fixture();
    placement.image.rights = "check-required";
    delete placement.image.allowedPlatforms;
    delete placement.image.evidenceNote;
    Object.assign(placement.image, patch);
    const upgraded = upgradeState(state).drafts.find(item => item.id === draft.id)!;
    assert.equal(evaluateDraftReadiness(upgraded, "xiaoheihe").ready, false);
    assert.notEqual(upgraded.images[0].image.rights, "user-provided");
  }
});

test("personal uploads still require the actual matching file before transfer", async () => {
  const { draft, placement } = await fixture();
  await writeFile(placement.image.localPath!, Buffer.concat([png, Buffer.from("changed")]));
  await assert.rejects(prepareJob(draft, "https://www.xiaoheihe.cn/creator/editor/draft/article"), /指纹/);
  await rm(placement.image.localPath!);
  assert.match(evaluateDraftReadiness(draft, "xiaoheihe").blockers.join("\n"), /不存在/);
});

test("a personal upload may have no public caption without blocking a complete article", async () => {
  const { draft, placement } = await fixture();
  placement.caption = placement.image.caption = "image";
  const job = await prepareJob(draft, "https://www.xiaoheihe.cn/creator/editor/draft/article");
  assert.equal(job.images[0].caption, "");
  const result = evaluatePublisherPreflight({
    runtime: { mode: "chrome-extension", connected: true, protocolVersion: "0.1.24" },
    draft: { ...draft, topics: ["AI"], bodyHtml: job.bodyHtml, images: [{ id: placement.id, available: true, caption: "", captionRequired: false }] },
  });
  assert.equal(result.canQueueFill, true, JSON.stringify(result.blocking));
});
