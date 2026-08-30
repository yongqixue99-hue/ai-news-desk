import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { createDefaultState, upgradeState } from "./defaults.js";
import type { PublisherReceipt } from "./publisher-preflight.js";
import {
  assertPublicationRevision,
  attachWeChatDeliveryReceipt,
  attachXiaoheiheDeliveryReceipt,
  confirmDraftPublication,
  currentPublicationConfirmation,
  normalizeDraftPublicationState,
  publicationRevisionHash,
  reconcileDraftPublicationAfterEdit,
  recordXiaoheiheFillAttempt,
} from "./publication-state.js";
import type { ArticleDraft, PublisherResult, WeChatDraftSyncReceipt } from "./types.js";

const publicationFixtureRoot = mkdtempSync(path.join(tmpdir(), "ai-news-publication-images-"));
const publicationImagePath = path.join(publicationFixtureRoot, "codex.png");
writeFileSync(publicationImagePath, Buffer.from("image-bytes"));
after(() => rmSync(publicationFixtureRoot, { recursive: true, force: true }));

const draftFixture = (): ArticleDraft => ({
  id: "draft-publication",
  runId: "run-publication",
  candidateId: "candidate-publication",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  status: "filled",
  contentFormat: "article",
  title: "OpenAI 发布新的 Codex 功能",
  paragraphs: ["OpenAI 发布了新的 Codex 功能。"],
  take: "这次更新改善了本地开发工作流。",
  bodyHtml: '<p>OpenAI 发布了新的 Codex 功能。</p><img src="/media/cover.png" data-media-id="placement-cover"><p>图：Codex 界面（来源：OpenAI）</p>',
  layoutTheme: "news-clean",
  sources: [{ label: "OpenAI", url: "https://openai.com/news/codex", kind: "primary", verified: true }],
  factClaims: [],
  uncertainties: [],
  images: [{
    id: "placement-cover",
    afterParagraph: 0,
    caption: "Codex 界面",
    image: {
      id: "image-cover",
      url: "https://openai.com/codex.png",
      localPath: publicationImagePath,
      publicPath: "/media/codex.png",
      caption: "Codex 界面",
      attribution: "OpenAI",
      sourceUrl: "https://openai.com/news/codex",
      selected: true,
      rights: "official",
      allowedPlatforms: ["wechat", "xiaoheihe"],
      fingerprint: "2c8648d103e3dd7ad87660da0f126a1443b6d21ac1bd3ec000c5e24e2373a90c",
    },
  }],
  community: "数码硬件",
  topics: ["OpenAI", "Codex"],
  provenance: {
    originalUrl: "https://openai.com/news/codex",
    generatedBy: "test",
  },
});

const wechatReceiptFor = (draft: ArticleDraft, contentHash = "wechat-content-v1"): WeChatDraftSyncReceipt => ({
  schemaVersion: "wechat-draft-receipt/v1",
  draftId: draft.id,
  mediaId: "wechat-media-1",
  operation: "created",
  contentHash,
  revisionHash: publicationRevisionHash(draft, "wechat"),
  syncedAt: "2026-08-30T00:01:00.000Z",
  localDraftUpdatedAt: draft.updatedAt,
  imageCount: 1,
  coverPlacementId: "placement-cover",
});

const xiaoheiheReceiptFor = (draft: ArticleDraft): PublisherReceipt => ({
  schemaVersion: "publisher-receipt/v1",
  attemptId: "xiaoheihe-attempt-1",
  draftId: draft.id,
  mode: "chrome-extension",
  startedAt: "2026-08-30T00:01:00.000Z",
  completedAt: "2026-08-30T00:02:00.000Z",
  outcome: "filled",
  checks: [],
  blocking: [],
  warnings: [],
  usedImageIds: ["placement-cover"],
  safety: {
    operation: "fill-only",
    finalPublishAttempted: false,
    finalPublishPerformed: false,
  },
  summary: "已填入，等待人工发布",
  revisionHash: publicationRevisionHash(draft, "xiaoheihe"),
});

const confirmFixturePublication = (
  draft: ArticleDraft,
  platform: "wechat" | "xiaoheihe",
  confirmedAt: string,
) => confirmDraftPublication(draft, platform, confirmedAt, {
  actualImageFingerprints: Object.fromEntries(
    draft.images.map((placement) => [placement.id, placement.image.fingerprint]),
  ),
});

test("publication revisions include every image rights and evidence field", () => {
  const baseline = draftFixture();
  const baselineHash = publicationRevisionHash(baseline, "xiaoheihe");
  const changes: Array<[string, Record<string, unknown>]> = [
    ["rights", { rights: "licensed" }],
    ["evidenceNote", { evidenceNote: "2026 年商业转载授权" }],
    ["evidencePath", { evidencePath: "E:/workflow/evidence/license.pdf" }],
    ["licenseId", { licenseId: "commercial-license-2026" }],
    ["licenseUrl", { licenseUrl: "https://example.com/license/2026" }],
    ["modificationNote", { modificationNote: "仅裁切空白边缘" }],
    ["allowedPlatforms", { allowedPlatforms: ["wechat"] }],
    ["expiresAt", { expiresAt: "2026-09-30T00:00:00.000Z" }],
    ["fingerprint", { fingerprint: "different-image-sha256" }],
  ];

  for (const [field, patch] of changes) {
    const changed = draftFixture();
    Object.assign(changed.images[0].image, patch);
    assert.notEqual(
      publicationRevisionHash(changed, "xiaoheihe"),
      baselineHash,
      `${field} must be version-bound`,
    );
  }
});

test("a draft edited after preflight is rejected by the publication revision guard", () => {
  const snapshot = draftFixture();
  const expectedRevisionHash = publicationRevisionHash(snapshot, "xiaoheihe");
  const current = structuredClone(snapshot);
  current.title = "预检完成后被修改的标题";

  assert.throws(
    () => assertPublicationRevision(current, "xiaoheihe", expectedRevisionHash),
    (error: unknown) => error instanceof Error
      && "statusCode" in error
      && error.statusCode === 409
      && /预检后.*重新预检/u.test(error.message),
  );
});

test("publication confirmation rechecks rights expiry at confirmation time", () => {
  const draft = draftFixture();
  Object.assign(draft.images[0].image, {
    rights: "licensed",
    evidenceNote: "允许用于小黑盒至 00:03 UTC",
    licenseId: "commercial-license-2026",
    licenseUrl: "https://example.com/license/2026",
    modificationNote: "未修改",
    allowedPlatforms: ["xiaoheihe"],
    expiresAt: "2026-08-30T00:03:00.000Z",
  });
  attachXiaoheiheDeliveryReceipt(
    draft,
    xiaoheiheReceiptFor(draft),
    "2026-08-30T00:02:00.000Z",
  );

  assert.throws(
    () => confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:04:00.000Z"),
    /图片使用权限已到期/u,
  );
  assert.equal(draft.publicationConfirmations?.xiaoheihe, undefined);
});

test("WeChat and Xiaoheihe publication confirmations are independent and revision-bound", () => {
  const draft = draftFixture();
  attachWeChatDeliveryReceipt(draft, wechatReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  attachXiaoheiheDeliveryReceipt(draft, xiaoheiheReceiptFor(draft), "2026-08-30T00:02:00.000Z");

  const wechat = confirmFixturePublication(draft, "wechat", "2026-08-30T00:03:00.000Z");
  const xiaoheihe = confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:04:00.000Z");

  assert.equal(wechat.alreadyConfirmed, false);
  assert.equal(xiaoheihe.alreadyConfirmed, false);
  assert.equal(draft.publicationConfirmations?.wechat?.receiptId, "wechat-media-1");
  assert.equal(draft.publicationConfirmations?.xiaoheihe?.receiptId, "xiaoheihe-attempt-1");
  assert.equal(draft.publicationConfirmedAt, "2026-08-30T00:04:00.000Z");
});

test("editing publishable content marks old confirmations stale instead of authorizing the new revision", () => {
  const draft = draftFixture();
  attachWeChatDeliveryReceipt(draft, wechatReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  attachXiaoheiheDeliveryReceipt(draft, xiaoheiheReceiptFor(draft), "2026-08-30T00:02:00.000Z");
  confirmFixturePublication(draft, "wechat", "2026-08-30T00:03:00.000Z");
  confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:04:00.000Z");

  const before = structuredClone(draft);
  draft.title = "OpenAI 发布新的 Codex 功能：完整更新";
  draft.bodyHtml = "<p>这是编辑后的正文，不能继承上一版发布确认。</p>";
  reconcileDraftPublicationAfterEdit(before, draft, "2026-08-30T00:05:00.000Z");

  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, "2026-08-30T00:05:00.000Z");
  assert.equal(draft.publicationConfirmations?.xiaoheihe?.staleAt, "2026-08-30T00:05:00.000Z");
  assert.equal(draft.publicationConfirmedAt, undefined);
  assert.equal(draft.publicationReceiptId, undefined);
  assert.equal(draft.status, "editing");
});

test("changing Xiaoheihe-only metadata does not stale a current WeChat publication", () => {
  const draft = draftFixture();
  attachWeChatDeliveryReceipt(draft, wechatReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  attachXiaoheiheDeliveryReceipt(draft, xiaoheiheReceiptFor(draft), "2026-08-30T00:02:00.000Z");
  confirmFixturePublication(draft, "wechat", "2026-08-30T00:03:00.000Z");
  confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:04:00.000Z");

  const before = structuredClone(draft);
  draft.topics = ["AI"];
  reconcileDraftPublicationAfterEdit(before, draft, "2026-08-30T00:05:00.000Z");

  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, undefined);
  assert.equal(draft.publicationConfirmations?.xiaoheihe?.staleAt, "2026-08-30T00:05:00.000Z");
  assert.equal(draft.publicationReceiptId, "wechat-media-1");
  assert.equal(draft.status, "published");
});

test("a matching legacy WeChat confirmation migrates safely, while an unversioned Xiaoheihe receipt does not", () => {
  const wechatDraft = draftFixture();
  const legacyWechatReceipt = { ...wechatReceiptFor(wechatDraft) };
  delete legacyWechatReceipt.revisionHash;
  wechatDraft.wechatDraft = legacyWechatReceipt;
  wechatDraft.status = "published";
  wechatDraft.publicationConfirmedAt = "2026-08-30T00:03:00.000Z";
  wechatDraft.publicationReceiptId = legacyWechatReceipt.mediaId;

  normalizeDraftPublicationState(wechatDraft);

  assert.equal(wechatDraft.publicationConfirmations?.wechat?.staleAt, undefined);
  assert.equal(
    wechatDraft.publicationConfirmations?.wechat?.revisionHash,
    publicationRevisionHash(wechatDraft, "wechat"),
  );

  const xiaoheiheDraft = draftFixture();
  const legacyXiaoheiheReceipt = { ...xiaoheiheReceiptFor(xiaoheiheDraft) };
  delete legacyXiaoheiheReceipt.revisionHash;
  xiaoheiheDraft.publisherReceipt = legacyXiaoheiheReceipt;
  xiaoheiheDraft.fillResult = { ok: true, at: legacyXiaoheiheReceipt.completedAt, steps: [], receipt: legacyXiaoheiheReceipt } as never;
  xiaoheiheDraft.status = "published";
  xiaoheiheDraft.publicationConfirmedAt = "2026-08-30T00:03:00.000Z";
  xiaoheiheDraft.publicationReceiptId = legacyXiaoheiheReceipt.attemptId;

  normalizeDraftPublicationState(xiaoheiheDraft);

  assert.equal(xiaoheiheDraft.publicationConfirmations?.xiaoheihe?.staleAt !== undefined, true);
  assert.equal(xiaoheiheDraft.publicationConfirmedAt, undefined);
  assert.equal(xiaoheiheDraft.status, "filled");
  assert.throws(
    () => confirmDraftPublication(xiaoheiheDraft, "xiaoheihe", "2026-08-30T00:04:00.000Z"),
    /重新填入小黑盒/,
  );
});

test("updating the remote WeChat draft invalidates an older manual confirmation when its payload changed", () => {
  const draft = draftFixture();
  const originalReceipt = wechatReceiptFor(draft, "wechat-content-v1");
  attachWeChatDeliveryReceipt(draft, originalReceipt, "2026-08-30T00:01:00.000Z");
  confirmFixturePublication(draft, "wechat", "2026-08-30T00:02:00.000Z");

  const updatedReceipt = {
    ...originalReceipt,
    operation: "updated" as const,
    contentHash: "wechat-content-v2",
    syncedAt: "2026-08-30T00:03:00.000Z",
  };
  attachWeChatDeliveryReceipt(draft, updatedReceipt, "2026-08-30T00:03:00.000Z");

  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, "2026-08-30T00:03:00.000Z");
  assert.equal(draft.publicationConfirmedAt, undefined);
  assert.equal(draft.status, "editing");
});

test("workspace upgrade normalizes legacy publication state before APIs can consume it", () => {
  const draft = draftFixture();
  const receipt = { ...wechatReceiptFor(draft) };
  delete receipt.revisionHash;
  draft.wechatDraft = receipt;
  draft.status = "published";
  draft.publicationConfirmedAt = "2026-08-30T00:03:00.000Z";
  draft.publicationReceiptId = receipt.mediaId;
  const state = createDefaultState();
  state.drafts = [draft];

  const upgraded = upgradeState(state);

  assert.equal(upgraded.drafts[0].publicationConfirmations?.wechat?.receiptId, receipt.mediaId);
  assert.equal(upgraded.drafts[0].wechatDraft?.revisionHash, publicationRevisionHash(draft, "wechat"));
});

test("the first edit of a legacy WeChat publication compares against the migrated old revision", () => {
  const draft = draftFixture();
  const receipt = { ...wechatReceiptFor(draft) };
  delete receipt.revisionHash;
  draft.wechatDraft = receipt;
  draft.status = "published";
  draft.publicationConfirmedAt = "2026-08-30T00:03:00.000Z";
  draft.publicationReceiptId = receipt.mediaId;

  const before = structuredClone(draft);
  draft.title = "已修改标题";
  reconcileDraftPublicationAfterEdit(before, draft, "2026-08-30T00:04:00.000Z");

  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, "2026-08-30T00:04:00.000Z");
  assert.equal(draft.status, "editing");
});

test("changing the default WeChat digest invalidates WeChat but not Xiaoheihe", () => {
  const draft = draftFixture();
  attachWeChatDeliveryReceipt(draft, wechatReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  attachXiaoheiheDeliveryReceipt(draft, xiaoheiheReceiptFor(draft), "2026-08-30T00:02:00.000Z");
  confirmFixturePublication(draft, "wechat", "2026-08-30T00:03:00.000Z");
  confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:04:00.000Z");

  const before = structuredClone(draft);
  draft.take = "修改后的公众号摘要";
  reconcileDraftPublicationAfterEdit(before, draft, "2026-08-30T00:05:00.000Z");

  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, "2026-08-30T00:05:00.000Z");
  assert.equal(draft.publicationConfirmations?.xiaoheihe?.staleAt, undefined);
  assert.equal(draft.status, "published");
});

test("a new Xiaoheihe fill stales only Xiaoheihe and preserves a current WeChat publication", () => {
  const draft = draftFixture();
  attachWeChatDeliveryReceipt(draft, wechatReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  attachXiaoheiheDeliveryReceipt(draft, xiaoheiheReceiptFor(draft), "2026-08-30T00:02:00.000Z");
  confirmFixturePublication(draft, "wechat", "2026-08-30T00:03:00.000Z");
  confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:04:00.000Z");

  const refill = { ...xiaoheiheReceiptFor(draft), attemptId: "xiaoheihe-attempt-2" };
  attachXiaoheiheDeliveryReceipt(draft, refill, "2026-08-30T00:05:00.000Z");

  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, undefined);
  assert.equal(draft.publicationConfirmations?.xiaoheihe?.staleAt, "2026-08-30T00:05:00.000Z");
  assert.equal(draft.publicationReceiptId, "wechat-media-1");
  assert.equal(draft.status, "published");
});

test("a fill receipt produced from an older concurrent draft revision cannot mark the edited draft filled", () => {
  const oldDraft = draftFixture();
  const receipt = xiaoheiheReceiptFor(oldDraft);
  const editedDraft = structuredClone(oldDraft);
  editedDraft.title = "并发编辑后的标题";
  editedDraft.status = "filled";

  attachXiaoheiheDeliveryReceipt(editedDraft, receipt, "2026-08-30T00:05:00.000Z");

  assert.equal(editedDraft.status, "editing");
  assert.throws(
    () => confirmDraftPublication(editedDraft, "xiaoheihe", "2026-08-30T00:06:00.000Z"),
    /重新填入小黑盒/,
  );
});

test("blocked and failed fill attempts preserve the last confirmed successful receipt", () => {
  for (const outcome of ["blocked", "failed"] as const) {
    const draft = draftFixture();
    const successfulReceipt = xiaoheiheReceiptFor(draft);
    attachXiaoheiheDeliveryReceipt(draft, successfulReceipt, "2026-08-30T00:02:00.000Z");
    confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:03:00.000Z");
    const failedReceipt: PublisherReceipt = {
      ...xiaoheiheReceiptFor(draft),
      attemptId: `xiaoheihe-${outcome}-attempt`,
      outcome,
      summary: `${outcome} retry`,
    };
    const failedResult: PublisherResult = {
      at: "2026-08-30T00:05:00.000Z",
      ok: false,
      revisionHash: failedReceipt.revisionHash,
      steps: [],
      receipt: failedReceipt,
    };

    const attached = recordXiaoheiheFillAttempt(
      draft,
      failedResult,
      failedReceipt,
      failedResult.at,
    );

    assert.equal(attached, false);
    assert.equal(draft.fillResult?.receipt?.attemptId, failedReceipt.attemptId);
    assert.equal(draft.publisherReceipt?.attemptId, successfulReceipt.attemptId);
    assert.equal(currentPublicationConfirmation(draft, "xiaoheihe")?.staleAt, undefined);
    assert.equal(
      confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:06:00.000Z").alreadyConfirmed,
      true,
    );
  }
});

test("a filled receipt for a non-current revision remains audit-only", () => {
  const draft = draftFixture();
  const successfulReceipt = xiaoheiheReceiptFor(draft);
  attachXiaoheiheDeliveryReceipt(draft, successfulReceipt, "2026-08-30T00:02:00.000Z");
  confirmFixturePublication(draft, "xiaoheihe", "2026-08-30T00:03:00.000Z");
  const staleReceipt: PublisherReceipt = {
    ...xiaoheiheReceiptFor(draft),
    attemptId: "xiaoheihe-stale-filled-attempt",
    revisionHash: "older-preflight-revision",
  };
  const staleResult: PublisherResult = {
    at: "2026-08-30T00:05:00.000Z",
    ok: true,
    revisionHash: staleReceipt.revisionHash,
    steps: [],
    receipt: staleReceipt,
  };

  const attached = recordXiaoheiheFillAttempt(draft, staleResult, staleReceipt, staleResult.at);

  assert.equal(attached, false);
  assert.equal(draft.publisherReceipt?.attemptId, successfulReceipt.attemptId);
  assert.equal(currentPublicationConfirmation(draft, "xiaoheihe")?.receiptId, successfulReceipt.attemptId);
});

test("normalization preserves an explicitly shelved published draft", () => {
  const draft = draftFixture();
  attachWeChatDeliveryReceipt(draft, wechatReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  confirmFixturePublication(draft, "wechat", "2026-08-30T00:02:00.000Z");
  draft.status = "shelved";

  normalizeDraftPublicationState(draft);

  assert.equal(draft.status, "shelved");
  assert.equal(draft.publicationConfirmations?.wechat?.staleAt, undefined);
});

test("editing a filled Xiaoheihe draft visibly downgrades the old delivery", () => {
  const draft = draftFixture();
  attachXiaoheiheDeliveryReceipt(draft, xiaoheiheReceiptFor(draft), "2026-08-30T00:01:00.000Z");
  const before = structuredClone(draft);
  draft.bodyHtml = "<p>填入之后又修改的正文</p>";

  reconcileDraftPublicationAfterEdit(before, draft, "2026-08-30T00:02:00.000Z");

  assert.equal(draft.status, "editing");
  assert.throws(
    () => confirmDraftPublication(draft, "xiaoheihe", "2026-08-30T00:03:00.000Z"),
    /重新填入小黑盒/,
  );
});

test("publication confirmation rejects a local image replaced after the successful delivery", () => {
  const draft = draftFixture();
  attachXiaoheiheDeliveryReceipt(
    draft,
    xiaoheiheReceiptFor(draft),
    "2026-08-30T00:02:00.000Z",
  );

  assert.throws(
    () => confirmDraftPublication(
      draft,
      "xiaoheihe",
      "2026-08-30T00:03:00.000Z",
      { actualImageFingerprints: { "placement-cover": "b".repeat(64) } },
    ),
    /文件.*变化|重新插入/u,
  );
  assert.equal(draft.publicationConfirmations?.xiaoheihe, undefined);
});

test("publication confirmation blocks an inserted image with no reviewed SHA-256", () => {
  const draft = draftFixture();
  delete draft.images[0]!.image.fingerprint;
  attachXiaoheiheDeliveryReceipt(
    draft,
    xiaoheiheReceiptFor(draft),
    "2026-08-30T00:02:00.000Z",
  );

  assert.throws(
    () => confirmDraftPublication(
      draft,
      "xiaoheihe",
      "2026-08-30T00:03:00.000Z",
      { actualImageFingerprints: { "placement-cover": "b".repeat(64) } },
    ),
    /缺少已审核.*SHA-256.*重新插入/u,
  );
});
