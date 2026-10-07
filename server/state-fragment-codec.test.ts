import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { decodeStateFragment, encodeStateFragment, MAX_RUN_FRAGMENT_BYTES } from "./state-fragment-codec.js";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
test("large lean runs have a lossless bounded representation and old raw fragments remain readable", () => {
  const value = [{ id: "example", logs: [{ message: "完整历史".repeat(30_000) }] }];
  const raw = JSON.stringify(value), stored = encodeStateFragment("runs", raw);
  assert.ok(Buffer.byteLength(stored) < Buffer.byteLength(raw));
  assert.deepEqual(decodeStateFragment("runs", stored), value);
  assert.deepEqual(decodeStateFragment("runs", raw), value);
  assert.equal(encodeStateFragment("settings", raw), raw);
  assert.equal(encodeStateFragment("runs", "[]"), "[]");
});
test("invalid compressed bytes, hash, declared size, kind and output bombs fail closed", () => {
  const raw = JSON.stringify([{ logs: ["example".repeat(10_000)] }]);
  const wrapped = JSON.parse(encodeStateFragment("runs", raw));
  for (const replacement of [{ sha256: "0".repeat(64) }, { data: wrapped.data + "\n" }, { bytes: wrapped.bytes + 1 }, { bytes: MAX_RUN_FRAGMENT_BYTES + 1 }, { bytes: 1 }, { extra: true }, { format: "unknown" }]) {
    assert.throws(() => decodeStateFragment("runs", JSON.stringify({ ...wrapped, ...replacement })));
  }
  assert.throws(() => decodeStateFragment("settings", JSON.stringify(wrapped)), /仅适用于运行切片/);
  const object = "{}";
  assert.throws(() => decodeStateFragment("runs", JSON.stringify({ format: wrapped.format, bytes: 2, sha256: sha(object), data: gzipSync(object).toString("base64") })), /必须是数组/);
});
