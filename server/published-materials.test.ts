import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  evaluatePublishedImagePromotion,
  inspectDraftImageFile,
  isManagedDraftImagePath,
  isPathInsideManagedRoot,
  publicPublishedImagePromotionStatus,
} from "./published-materials.js";
import { publicationRevisionHash } from "./publication-state.js";
import { workflowMediaRoot } from "./storage.js";
import type { ArticleDraft, DraftImagePlacement, ImageMaterial } from "./types.js";

const placement = (): DraftImagePlacement => ({
  id: "placement_hero",
  afterParagraph: 0,
  caption: "发布会现场",
  image: {
    id: "image_hero",
    url: "/media/draft/image.png",
    localPath: "/workflow/media/draft/image.png",
    publicPath: "/media/draft/image.png",
    caption: "发布会现场",
    attribution: "OpenAI",
    sourceUrl: "https://openai.com/news/launch",
    selected: true,
    rights: "licensed",
    evidenceNote: "允许用于小黑盒",
    evidencePath: "/licenses/openai.pdf",
    allowedPlatforms: ["xiaoheihe"],
    expiresAt: "2027-08-13T23:59:59.999Z",
    entityTags: ["OpenAI"],
    fingerprint: "a".repeat(64),
  },
});

const draft = (): ArticleDraft => {
  const result: ArticleDraft = {
    id: "draft_1",
    runId: "run_1",
    candidateId: "candidate_1",
    createdAt: "2026-08-13T00:00:00.000Z",
    updatedAt: "2026-08-13T01:00:00.000Z",
    status: "published",
    title: "OpenAI 发布新模型",
    paragraphs: ["正文"],
    take: "结尾",
    bodyHtml: '<p>正文</p><img src="/media/draft/image.png" data-media-id="placement_hero">',
    sources: [],
    uncertainties: [],
    images: [placement()],
    community: "盒友杂谈",
    topics: ["OpenAI"],
    provenance: { originalUrl: "https://openai.com/news/launch", generatedBy: "test" },
    publicationConfirmedAt: "2026-08-13T02:00:00.000Z",
    publicationReceiptId: "receipt_1",
    publisherReceipt: {
      schemaVersion: "publisher-receipt/v1",
      attemptId: "receipt_1",
      draftId: "draft_1",
      mode: "chrome-extension",
      startedAt: "2026-08-13T01:30:00.000Z",
      completedAt: "2026-08-13T01:31:00.000Z",
      outcome: "filled",
      checks: [],
      blocking: [],
      warnings: [],
      usedImageIds: ["placement_hero"],
      safety: { operation: "fill-only", finalPublishAttempted: false, finalPublishPerformed: false },
      summary: "filled",
    },
  };
  result.publisherReceipt!.revisionHash = publicationRevisionHash(result, "xiaoheihe");
  return result;
};

const existingMaterial = (): ImageMaterial => ({
  id: "existing",
  title: "Already saved",
  fileName: "existing.png",
  localPath: "/materials/existing.png",
  publicPath: "/materials/existing.png",
  sourceUrl: "https://openai.com/news/launch",
  attribution: "OpenAI",
  tags: ["OpenAI"],
  rights: "licensed",
  evidenceNote: "允许用于小黑盒",
  evidencePath: "/licenses/openai.pdf",
  allowedPlatforms: ["xiaoheihe"],
  expiresAt: "2027-08-13T23:59:59.999Z",
  entityTags: ["OpenAI"],
  fingerprint: "a".repeat(64),
  createdAt: "2026-08-13T00:00:00.000Z",
});

test("a confirmed publication with an audited image can be manually promoted without changing rights", () => {
  const result = evaluatePublishedImagePromotion({
    draft: draft(),
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
    checkedAt: "2026-08-13T03:00:00.000Z",
  });

  assert.equal(result.status, "ready");
  assert.equal(result.canSave, true);
  assert.equal(result.candidate?.rights, "licensed");
  assert.equal(result.candidate?.promotion.receiptId, "receipt_1");
});

test("an old draft without an image-aware receipt is blocked instead of being grandfathered in", () => {
  const oldDraft = draft();
  delete oldDraft.publisherReceipt?.usedImageIds;
  const result = evaluatePublishedImagePromotion({
    draft: oldDraft,
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.canSave, false);
  assert.match(result.blockers.join(" "), /旧回执|逐图/);
});

test("publication confirmation must belong to the same fill receipt", () => {
  const mismatchedDraft = draft();
  mismatchedDraft.publicationReceiptId = "receipt_older";
  const result = evaluatePublishedImagePromotion({
    draft: mismatchedDraft,
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /发布确认.*本次填入回执/);
});

test("image promotion uses the Xiaoheihe confirmation even when WeChat is the latest global mirror", () => {
  const platformDraft = draft();
  const revisionHash = publicationRevisionHash(platformDraft, "xiaoheihe");
  platformDraft.publisherReceipt!.revisionHash = revisionHash;
  platformDraft.publicationConfirmations = {
    xiaoheihe: {
      platform: "xiaoheihe",
      confirmedAt: "2026-08-13T02:00:00.000Z",
      receiptId: "receipt_1",
      revisionHash,
    },
  };
  platformDraft.publicationConfirmedAt = "2026-08-13T02:30:00.000Z";
  platformDraft.publicationReceiptId = "wechat-media-newer";

  const result = evaluatePublishedImagePromotion({
    draft: platformDraft,
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "ready");
  assert.equal(result.candidate?.promotion.receiptId, "receipt_1");
});

test("a stale Xiaoheihe confirmation cannot be rescued by a current global mirror", () => {
  const platformDraft = draft();
  const revisionHash = publicationRevisionHash(platformDraft, "xiaoheihe");
  platformDraft.publisherReceipt!.revisionHash = revisionHash;
  platformDraft.publicationConfirmations = {
    xiaoheihe: {
      platform: "xiaoheihe",
      confirmedAt: "2026-08-13T02:00:00.000Z",
      receiptId: "receipt_1",
      revisionHash,
      staleAt: "2026-08-13T02:10:00.000Z",
    },
  };

  const result = evaluatePublishedImagePromotion({
    draft: platformDraft,
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /确认.*发布/);
});

test("a new receipt still blocks an image it did not confirm as actually used", () => {
  const unusedDraft = draft();
  unusedDraft.publisherReceipt!.usedImageIds = [];
  const result = evaluatePublishedImagePromotion({
    draft: unusedDraft,
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /没有记录.*实际使用/);
});

test("owned rights do not silently grant a platform authorization", () => {
  const ownedPlacement = placement();
  ownedPlacement.image.rights = "owned";
  delete ownedPlacement.image.allowedPlatforms;
  const result = evaluatePublishedImagePromotion({
    draft: { ...draft(), images: [ownedPlacement] },
    placement: ownedPlacement,
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /尚未记录你确认可用于 xiaoheihe/);
});

test("an exact fingerprint duplicate is reported rather than copied again", () => {
  const result = evaluatePublishedImagePromotion({
    draft: draft(),
    placement: placement(),
    existingMaterials: [existingMaterial()],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "duplicate");
  assert.equal(result.canSave, false);
  assert.equal(result.duplicateOf, "existing");
});

test("a changed local file cannot be promoted as the image bound to the successful receipt", () => {
  const result = evaluatePublishedImagePromotion({
    draft: draft(),
    placement: placement(),
    existingMaterials: [],
    fingerprint: "b".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.canSave, false);
  assert.match(result.blockers.join(" "), /文件.*变化|指纹.*不一致/u);
});

test("an image with no reviewed SHA-256 cannot be promoted after publication", () => {
  const inputDraft = draft();
  delete inputDraft.images[0]!.image.fingerprint;
  inputDraft.publisherReceipt!.revisionHash = publicationRevisionHash(inputDraft, "xiaoheihe");
  const result = evaluatePublishedImagePromotion({
    draft: inputDraft,
    placement: inputDraft.images[0]!,
    existingMaterials: [],
    fingerprint: "b".repeat(64),
    localFileAvailable: true,
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.canSave, false);
  assert.match(result.blockers.join(" "), /缺少已审核.*SHA-256.*重新插入/u);
});

test("missing publication confirmation, missing local file and duplicates remain independently visible", () => {
  const input = draft();
  delete input.publicationConfirmedAt;
  const result = evaluatePublishedImagePromotion({
    draft: input,
    placement: placement(),
    existingMaterials: [existingMaterial()],
    fingerprint: "a".repeat(64),
    localFileAvailable: false,
  });

  assert.equal(result.status, "blocked");
  assert.match(result.blockers.join(" "), /确认.*发布/);
  assert.match(result.blockers.join(" "), /本地文件/);
});

test("promotion never reads an arbitrary local path from mutable draft state", () => {
  assert.equal(isManagedDraftImagePath("/etc/passwd"), false);
  assert.equal(isManagedDraftImagePath(path.join(workflowMediaRoot, "draft", "image.png")), true);
  assert.equal(isManagedDraftImagePath(`${workflowMediaRoot}-escape/image.png`), false);
});

test("Windows containment is case-insensitive without accepting sibling or traversal paths", () => {
  const root = "C:\\Users\\Editor\\.workflow\\media";

  assert.equal(
    isPathInsideManagedRoot(root, "c:\\users\\EDITOR\\.WORKFLOW\\MEDIA\\draft\\image.png", "win32"),
    true,
  );
  assert.equal(isPathInsideManagedRoot(root, root.toLowerCase(), "win32"), false);
  assert.equal(
    isPathInsideManagedRoot(root, "C:\\Users\\Editor\\.workflow\\media-escape\\image.png", "win32"),
    false,
  );
  assert.equal(
    isPathInsideManagedRoot(root, "C:\\Users\\Editor\\.workflow\\media\\..\\outside.png", "win32"),
    false,
  );
  assert.equal(
    isPathInsideManagedRoot(root, "D:\\Users\\Editor\\.workflow\\media\\image.png", "win32"),
    false,
  );
});

test("a symlink cannot escape the managed draft media directory", async () => {
  await mkdir(workflowMediaRoot, { recursive: true });
  const managedDirectory = await mkdtemp(path.join(workflowMediaRoot, "promotion-test-"));
  const outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "promotion-outside-"));
  try {
    const outsideFile = path.join(outsideDirectory, "outside.png");
    await writeFile(outsideFile, Buffer.from("not-a-real-image"));
    const linkedFile = process.platform === "win32"
      ? path.join(managedDirectory, "linked-directory", "outside.png")
      : path.join(managedDirectory, "linked.png");
    if (process.platform === "win32") {
      // Directory junctions exercise the same realpath escape boundary without
      // requiring Windows Developer Mode or an elevated test process.
      await symlink(outsideDirectory, path.dirname(linkedFile), "junction");
    } else {
      await symlink(outsideFile, linkedFile);
    }
    const linkedPlacement = placement();
    linkedPlacement.image.localPath = linkedFile;

    const inspected = await inspectDraftImageFile(linkedPlacement, true);
    assert.equal(inspected.available, false);
    assert.match(inspected.reason ?? "", /越过.*受管目录/);
    assert.equal(inspected.bytes, undefined);
  } finally {
    await rm(managedDirectory, { recursive: true, force: true });
    await rm(outsideDirectory, { recursive: true, force: true });
  }
});

test("the browser status never exposes a candidate containing an absolute local path", () => {
  const status = evaluatePublishedImagePromotion({
    draft: draft(),
    placement: placement(),
    existingMaterials: [],
    fingerprint: "a".repeat(64),
    localFileAvailable: true,
  });
  const publicStatus = publicPublishedImagePromotionStatus(status);

  assert.equal("candidate" in publicStatus, false);
  assert.equal(JSON.stringify(publicStatus).includes("/workflow/media"), false);
});
