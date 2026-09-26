import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryDesk } from "./delivery-desk.js";

test("DeliveryDesk deduplicates concurrent syncs for one draft and channel", async () => {
  const desk = createDeliveryDesk();
  let calls = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const operation = async () => {
    calls += 1;
    await gate;
    return { mediaId: "media-1" };
  };
  const first = desk.sync({ draftId: "draft-1", channel: "wechat" }, operation);
  const second = desk.sync({ draftId: "draft-1", channel: "wechat" }, operation);
  release?.();
  assert.deepEqual(await Promise.all([first, second]), [{ mediaId: "media-1" }, { mediaId: "media-1" }]);
  assert.equal(calls, 1);
});

test("different delivery channels do not block each other", async () => {
  const desk = createDeliveryDesk();
  let calls = 0;
  await Promise.all([
    desk.sync({ draftId: "draft-1", channel: "wechat" }, async () => ++calls),
    desk.sync({ draftId: "draft-1", channel: "xiaoheihe" }, async () => ++calls),
  ]);
  assert.equal(calls, 2);
});

test("a concurrent changed version never borrows another version's successful receipt", async () => {
  const desk = createDeliveryDesk();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = desk.sync({ draftId: "draft", channel: "xiaoheihe", revision: "v1" }, async () => { await gate; return "v1 receipt"; });
  assert.equal(desk.isBusy("draft", "xiaoheihe"), true);
  await assert.rejects(desk.sync({ draftId: "draft", channel: "xiaoheihe", revision: "v2" }, async () => "must not run"), /另一个版本/);
  release();
  assert.equal(await first, "v1 receipt");
  assert.equal(desk.isBusy("draft", "xiaoheihe"), false);
});
