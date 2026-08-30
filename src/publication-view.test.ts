import assert from "node:assert/strict";
import test from "node:test";
import { currentPlatformPublicationConfirmation, withoutPlatformPublicationConfirmation } from "./publication-view.js";
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
