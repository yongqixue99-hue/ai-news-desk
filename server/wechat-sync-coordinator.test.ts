import assert from "node:assert/strict";
import test from "node:test";
import { createWeChatSyncCoordinator } from "./wechat-sync-coordinator.js";

test("concurrent requests for one local draft share a single WeChat write", async () => {
  const coordinator = createWeChatSyncCoordinator();
  let writes = 0;
  let release: ((value: { mediaId: string }) => void) | undefined;
  const operation = () => {
    writes += 1;
    return new Promise<{ mediaId: string }>((resolve) => { release = resolve; });
  };

  const first = coordinator.run("draft-1", operation);
  const second = coordinator.run("draft-1", operation);
  await Promise.resolve();
  assert.equal(writes, 1);
  release?.({ mediaId: "one-wechat-draft" });

  assert.deepEqual(await first, { mediaId: "one-wechat-draft" });
  assert.deepEqual(await second, { mediaId: "one-wechat-draft" });
  await coordinator.run("draft-1", async () => {
    writes += 1;
    return { mediaId: "later-update" };
  });
  assert.equal(writes, 2, "a completed request should release the draft lock for later updates");
});
