import assert from "node:assert/strict";
import test from "node:test";
import { weChatSecretHint, xBearerTokenHint } from "./secrets.js";

test("the persisted WeChat secret hint cannot reconstruct the AppSecret", () => {
  const secret = "1234567890abcdef1234567890abcdef";
  const hint = weChatSecretHint(secret);

  assert.equal(hint, "••••••cdef");
  assert.equal(hint.includes(secret), false);
});

test("the persisted X token hint reveals only its final four characters", () => {
  const token = "AAAAAAAAAAAAAAAAAAAAAAAA-secret-1234";
  const hint = xBearerTokenHint(token);
  assert.equal(hint, "••••••1234");
  assert.equal(hint.includes("secret"), false);
});
