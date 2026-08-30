import assert from "node:assert/strict";
import test from "node:test";
import { weChatSecretHint } from "./secrets.js";

test("the persisted WeChat secret hint cannot reconstruct the AppSecret", () => {
  const secret = "1234567890abcdef1234567890abcdef";
  const hint = weChatSecretHint(secret);

  assert.equal(hint, "••••••cdef");
  assert.equal(hint.includes(secret), false);
});
