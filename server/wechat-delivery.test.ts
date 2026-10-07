import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { createDeliveryDesk } from "./delivery-desk.js";
import { reviewDraftQuality } from "./draft-quality-review.js";
import { publicationRevisionHash } from "./publication-state.js";
import { createWeChatDelivery } from "./wechat-delivery.js";
import type { WeChatDraftArticlePayload } from "./wechat-draft.js";
import { wechatMetadataFor } from "./wechat-metadata.js";

const fixture = async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-wechat-delivery-"));
  const imagePath = path.join(root, "cover.png");
  await writeFile(imagePath, "image-bytes");
  let state = createDefaultState();
  Object.assign(state.settings.wechat, { appId: "wx-one", appSecretConfigured: true });
  const draft = createBlankDraftInState(state);
  draft.title = "新模型发布";
  draft.bodyHtml = '<p>发布了新模型，<a href="https://example.com/source">原文</a>说明了适用范围。</p>';
  draft.images = [{ id: "cover", afterParagraph: -1, caption: "封面", image: { id: "image", url: "/media/cover.png", publicPath: "/media/cover.png", localPath: imagePath, selected: true, rights: "owned", allowedPlatforms: ["wechat"], caption: "封面", attribution: "作者", sourceUrl: "https://example.com/source" } }];
  draft.wechatMetadata = { author: "作者", digest: "", contentSourceUrl: "", coverPlacementId: "cover" };
  let remote: WeChatDraftArticlePayload;
  const counts = { adds: 0, updates: 0, uploads: 0 };
  let loseUpdateResponse = false;
  let duringUpload = () => {};
  const dependencies = {
    deliveryDesk: createDeliveryDesk(), read: async () => structuredClone(state),
    update: async <T>(mutate: (value: typeof state) => T | Promise<T>) => mutate(state),
    review: async (value: typeof draft) => reviewDraftQuality(value, { getContentPackage: () => undefined, getSourceSnapshot: () => undefined }),
    loadImage: async () => ({ bytes: new Uint8Array([1]), fileName: "cover.png", contentType: "image/png" as const }),
    gateway: async () => ({ countDrafts: async () => 1, getDraft: async () => remote,
      uploadContentImage: async () => { throw new Error("cover is not in the body"); },
      uploadPermanentImage: async () => { counts.uploads++; duringUpload(); return { mediaId: "cover-media" }; },
      addDraft: async (article: WeChatDraftArticlePayload) => { counts.adds++; remote = structuredClone(article); return { mediaId: "remote-draft" }; },
      updateDraft: async (_id: string, article: WeChatDraftArticlePayload) => { counts.updates++; remote = structuredClone(article); if (loseUpdateResponse) throw new Error("response lost"); },
    }),
  };
  return { root, draft, counts, dependencies, state: () => state, remote: () => remote,
    restart: () => { state = structuredClone(state); dependencies.deliveryDesk = createDeliveryDesk(); },
    loseUpdate: () => { loseUpdateResponse = true; }, duringUpload: (run: () => void) => { duringUpload = run; } };
};

test("the real delivery operation recovers a lost update response after restart without uploading or writing again", async () => {
  const f = await fixture();
  try {
    const service = createWeChatDelivery(f.dependencies);
    await service.deliver(f.draft.id, f.draft.updatedAt);
    f.draft.title = "更新后的标题";
    f.draft.updatedAt = "2026-10-02T01:00:00Z";
    f.loseUpdate();
    await assert.rejects(service.deliver(f.draft.id, f.draft.updatedAt), /response lost/);
    const pending = f.state().drafts[0]!.wechatSyncAttempts![0]!;
    assert.equal(pending.status, "unknown");
    assert.ok(pending.checkpoint?.remoteContentFingerprint);
    f.restart();
    const recovered = await createWeChatDelivery(f.dependencies).deliver(f.draft.id, f.draft.updatedAt);
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.receipt.verification, "verified");
    assert.equal(recovered.receipt.revisionHash, publicationRevisionHash(f.state().drafts[0]!, "wechat"));
    assert.equal(f.state().drafts[0]!.wechatSyncAttempts![0]!.status, "complete");
    assert.deepEqual(f.counts, { adds: 1, updates: 1, uploads: 2 });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("automatic recovery keeps a conflicting remote edit uncertain and never duplicates the article", async () => {
  const f = await fixture();
  try {
    const service = createWeChatDelivery(f.dependencies);
    await service.deliver(f.draft.id);
    f.draft.title = "新标题";
    f.loseUpdate();
    await assert.rejects(service.deliver(f.draft.id), /response lost/);
    f.remote().content = f.remote().content.replace("https://example.com/source", "https://example.com/changed");
    await assert.rejects(service.deliver(f.draft.id), /只检查原稿.*未重复发送/);
    assert.equal(f.draft.wechatSyncAttempts![0]!.status, "unknown");
    assert.deepEqual(f.counts, { adds: 1, updates: 1, uploads: 2 });
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test("changes to the draft, account or default metadata during preparation prevent the remote write", async () => {
  for (const change of [
    (f: Awaited<ReturnType<typeof fixture>>) => { f.draft.title = "另一个窗口修改的标题"; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.state().settings.wechat.appId = "wx-other"; },
    (f: Awaited<ReturnType<typeof fixture>>) => { f.draft.wechatMetadata!.author = "其他作者"; },
  ]) {
    const f = await fixture();
    try {
      f.duringUpload(() => change(f));
      await assert.rejects(createWeChatDelivery(f.dependencies).deliver(f.draft.id), /变化|版本/);
      assert.equal(f.counts.adds + f.counts.updates, 0);
      assert.equal(f.draft.wechatSyncAttempts?.length ?? 0, 0);
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});

test("batch delivery binds content and settings while another channel may acknowledge the same content", async () => {
  for (const change of ["receipt", "content", "account", "metadata"]) {
    const f = await fixture();
    try {
      const key = `${publicationRevisionHash(f.draft, "wechat")}:${f.state().settings.wechat.appId}:${createHash("sha256").update(JSON.stringify(wechatMetadataFor(f.draft, f.state().settings.wechat))).digest("hex")}`;
      f.draft.updatedAt = new Date(Date.parse(f.draft.updatedAt) + 1).toISOString();
      if (change === "content") f.draft.title = "批量排队后编辑的标题";
      if (change === "account") f.state().settings.wechat.appId = "wx-other";
      if (change === "metadata") f.draft.wechatMetadata!.author = "其他作者";
      const operation = createWeChatDelivery(f.dependencies).deliver(f.draft.id, undefined, key);
      if (change === "receipt") assert.equal((await operation).receipt.verification, "verified");
      else {
        await assert.rejects(operation, /版本|账号|设置/);
        assert.equal(f.counts.adds + f.counts.updates + f.counts.uploads, 0);
      }
    } finally { await rm(f.root, { recursive: true, force: true }); }
  }
});
