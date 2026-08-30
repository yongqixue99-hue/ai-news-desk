import assert from "node:assert/strict";
import test from "node:test";
import { assertDraftTransition, canTransitionDraft } from "./draft-lifecycle.js";
import type { ArticleDraft } from "./types.js";

const draft = (status: ArticleDraft["status"]): ArticleDraft => ({
  id: "draft-lifecycle",
  runId: "run-lifecycle",
  candidateId: "candidate-lifecycle",
  createdAt: "2026-08-31T00:00:00.000Z",
  updatedAt: "2026-08-31T00:00:00.000Z",
  status,
  title: "测试标题",
  paragraphs: ["正文"],
  take: "摘要",
  bodyHtml: "<p>正文</p>",
  sources: [],
  uncertainties: [],
  images: [],
  community: "盒友杂谈",
  topics: ["测试"],
  provenance: { originalUrl: "https://example.com", generatedBy: "test" },
});

test("draft lifecycle keeps editorial review reversible but protects delivery states", () => {
  assert.equal(canTransitionDraft("editing", "reviewing"), true);
  assert.equal(canTransitionDraft("reviewing", "ready"), true);
  assert.equal(canTransitionDraft("editing", "published"), false);
  assert.equal(canTransitionDraft("shelved", "filled"), false);
});

test("saving an unchanged lifecycle status never re-validates its original delivery transition", async () => {
  assert.doesNotThrow(() => assertDraftTransition({ status: "filled" } as never, "filled"));
  assert.doesNotThrow(() => assertDraftTransition({ status: "published" } as never, "published"));
});

test("an old Xiaoheihe receipt cannot manually mark a newer draft revision filled", () => {
  const input = draft("ready");
  input.publisherReceipt = {
    schemaVersion: "publisher-receipt/v1",
    attemptId: "old-attempt",
    draftId: input.id,
    mode: "chrome-extension",
    startedAt: input.createdAt,
    completedAt: input.updatedAt,
    outcome: "filled",
    checks: [],
    blocking: [],
    warnings: [],
    safety: { operation: "fill-only", finalPublishAttempted: false, finalPublishPerformed: false },
    summary: "旧回执",
  };

  assert.throws(() => assertDraftTransition(input, "filled"), /当前版本|重新填入/);
});

test("a stale platform confirmation cannot manually restore published status", () => {
  const input = draft("filled");
  input.publicationConfirmedAt = "2026-08-31T00:01:00.000Z";
  input.publicationReceiptId = "old-attempt";
  input.publicationConfirmations = {
    xiaoheihe: {
      platform: "xiaoheihe",
      confirmedAt: input.publicationConfirmedAt,
      receiptId: "old-attempt",
      revisionHash: "old-revision",
      staleAt: "2026-08-31T00:02:00.000Z",
    },
  };

  assert.throws(() => assertDraftTransition(input, "published"), /当前版本|确认/);
});
