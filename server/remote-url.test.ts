import test from "node:test";
import assert from "node:assert/strict";
import { isDisallowedRemoteAddress, validateRemoteUrl } from "./remote-url.js";

test("private, loopback and reserved addresses are rejected", () => {
  for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.2", "169.254.1.1", "::1", "fd00::1", "fe80::1"]) {
    assert.equal(isDisallowedRemoteAddress(address), true, address);
  }
  assert.equal(isDisallowedRemoteAddress("8.8.8.8"), false);
  assert.equal(isDisallowedRemoteAddress("2606:4700:4700::1111"), false);
});

test("unsafe schemes, credentials and literal local URLs are rejected before fetching", async () => {
  await assert.rejects(() => validateRemoteUrl("file:///etc/passwd"), /HTTP\/HTTPS/);
  await assert.rejects(() => validateRemoteUrl("http://user:pass@example.com"), /用户名或密码/);
  await assert.rejects(() => validateRemoteUrl("http://127.0.0.1:4317"), /私网|回环|保留/);
});
