import assert from "node:assert/strict";
import test from "node:test";
import { retryableSocialPlatforms, type SocialDeliveryBatch } from "./social-delivery-types.js";

test("retry selects only failed supported channels, preserving reported and ambiguous remote attempts", () => {
  const batch: SocialDeliveryBatch = { id: "retry", createdAt: "", expiresAt: "", targets: [
    { platform: "zhihu", status: "reported", revisionHash: "1", detail: "" },
    { platform: "baijiahao", status: "blocked", revisionHash: "1", detail: "" },
    { platform: "toutiao", status: "blocked", revisionHash: "1", detail: "" },
  ] };
  assert.deepEqual(retryableSocialPlatforms(batch), ["baijiahao", "toutiao"]);
  for (const status of ["unknown", "sending", "waiting-login"] as const) {
    batch.targets[1].status = status;
    assert.deepEqual(retryableSocialPlatforms(batch), ["toutiao"]);
    batch.targets[2].status = status;
    assert.deepEqual(retryableSocialPlatforms(batch), []);
    batch.targets[2].status = "blocked";
  }
});
