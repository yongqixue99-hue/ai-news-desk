import assert from "node:assert/strict";
import test from "node:test";
import { readDeliverySelection, rememberDeliverySelection } from "./delivery-selection.js";

test("delivery does not choose an account for a first-time or unavailable preference store", () => {
  assert.deepEqual(readDeliverySelection({ getItem: () => null }), []);
  assert.deepEqual(readDeliverySelection({ getItem: () => { throw new Error("denied"); } }), []);
  assert.deepEqual(readDeliverySelection({ getItem: () => '{invalid' }), []);
});
test("the chosen platform combination survives ten new drafts without duplicate or unknown targets", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  rememberDeliverySelection(storage, ["xiaoheihe", "wechat"]);
  for (let draft = 0; draft < 10; draft++) assert.deepEqual(readDeliverySelection(storage), ["wechat", "xiaoheihe"]);
  data.set("newsdesk.social-platforms.v1", '["zhihu","zhihu","unavailable","baijiahao"]');
  assert.deepEqual(readDeliverySelection(storage), ["baijiahao", "zhihu"]);
  rememberDeliverySelection(storage, []);
  assert.deepEqual(readDeliverySelection(storage), []);
});
