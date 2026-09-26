import assert from "node:assert/strict";
import test from "node:test";
import { currentDraftDeliverySnapshot, currentPlatformPublicationConfirmation, platformDeliveryView, withoutPlatformPublicationConfirmation } from "./publication-view.js";
import type { ArticleDraft } from "./types.js";

const confirmations: NonNullable<ArticleDraft["publicationConfirmations"]> = {
  wechat: {
    platform: "wechat",
    confirmedAt: "2026-08-31T00:00:00.000Z",
    receiptId: "wechat-receipt",
    revisionHash: "wechat-v1",
  },
  xiaoheihe: {
    platform: "xiaoheihe",
    confirmedAt: "2026-08-31T00:01:00.000Z",
    receiptId: "xiaoheihe-receipt",
    revisionHash: "xiaoheihe-v1",
    staleAt: "2026-08-31T00:02:00.000Z",
  },
};

test("publication UI reads current confirmation per platform and ignores stale entries", () => {
  assert.equal(currentPlatformPublicationConfirmation({ publicationConfirmations: confirmations }, "wechat")?.receiptId, "wechat-receipt");
  assert.equal(currentPlatformPublicationConfirmation({ publicationConfirmations: confirmations }, "xiaoheihe"), undefined);
});

test("invalidating one platform keeps the other platform confirmation", () => {
  const next = withoutPlatformPublicationConfirmation({ publicationConfirmations: confirmations }, "xiaoheihe");
  assert.equal(next?.wechat?.receiptId, "wechat-receipt");
  assert.equal(next?.xiaoheihe, undefined);
});

test("opening delivery while its persisted status loads does not claim the filled draft changed or was never sent", () => {
  const view = platformDeliveryView({ platform: "xiaoheihe" });
  assert.equal(view.status, "checking");
  assert.equal(view.label, "正在核对");
  assert.equal(view.stale, false);
});

test("a failed status read is an unknown delivery result, not evidence of changed content", () => {
  const view = platformDeliveryView({ platform: "xiaoheihe", loadFailed: true });
  assert.equal(view.status, "unknown");
  assert.equal(view.label, "待核对结果");
  assert.equal(view.stale, false);
});

test("only saved revision changes or unsaved edits to a delivered revision require another fill", () => {
  assert.equal(platformDeliveryView({ platform: "xiaoheihe", status: "current" }).stale, false);
  assert.equal(platformDeliveryView({ platform: "xiaoheihe", status: "changed" }).stale, true);
  assert.equal(platformDeliveryView({ platform: "xiaoheihe", status: "current", dirty: true }).status, "changed");
  assert.equal(platformDeliveryView({ platform: "xiaoheihe", status: "never", dirty: true }).status, "never");
  assert.equal(platformDeliveryView({ platform: "xiaoheihe", status: "failed" }).stale, false);
  assert.equal(platformDeliveryView({ platform: "wechat", status: "pending" }).label, "待回读核对");
});

test("delivery snapshots cannot bleed into another draft or a newly saved revision", () => {
  const snapshot = { draftId: "filled-draft", updatedAt: "2026-09-26T08:00:00Z", value: { status: "current" } };
  assert.equal(currentDraftDeliverySnapshot({ id: snapshot.draftId, updatedAt: snapshot.updatedAt }, snapshot), snapshot);
  assert.equal(currentDraftDeliverySnapshot({ id: "new-draft", updatedAt: snapshot.updatedAt }, snapshot), undefined);
  assert.equal(currentDraftDeliverySnapshot({ id: snapshot.draftId, updatedAt: "2026-09-26T08:01:00Z" }, snapshot), undefined);
  assert.equal(currentDraftDeliverySnapshot(undefined, snapshot), undefined);
});
