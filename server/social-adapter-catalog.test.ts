import assert from "node:assert/strict";
import test from "node:test";
import { createSocialAdapterCatalog } from "./social-adapter-catalog.js";

test("catalog lookup stays nonblocking, shares a request and expires with the connection", async () => {
  let generation = 1, calls = 0, release!: (value: unknown) => void;
  let pending = new Promise<unknown>(resolve => { release = resolve; });
  const catalog = createSocialAdapterCatalog({ generation: () => generation, fetch: () => { calls++; return pending; } });
  assert.equal(catalog.peek(), undefined);
  assert.equal(catalog.peek(), undefined); assert.equal(calls, 1);
  const read = catalog.read(); release([{ id: "toutiao", capabilities: ["article", "draft"] }]);
  const first = await read; assert.equal(catalog.peek(), first); assert.equal(calls, 1);
  generation++;
  pending = new Promise(resolve => { release = resolve; });
  assert.equal(catalog.peek(), undefined); assert.equal(calls, 2);
  const obsolete = catalog.read(); generation++; release([{ id: "old-extension" }]);
  await assert.rejects(obsolete, /连接已变化/u);
  pending = new Promise(() => {});
  assert.equal(catalog.peek(), undefined, "a previous connection cannot supply the next adapter catalog");
});

test("failed background discovery backs off and cached metadata expires without blocking the caller", async () => {
  let clock = 1_000, calls = 0, fail = true;
  const metadata = [{ id: "toutiao", capabilities: ["article", "draft"] }];
  const catalog = createSocialAdapterCatalog({ generation: () => 1, now: () => clock, fetch: async () => {
    calls++; if (fail) throw new Error("temporarily unavailable"); return metadata;
  } });
  assert.equal(catalog.peek(), undefined);
  await assert.rejects(catalog.read(), /temporarily unavailable/u);
  for (let index = 0; index < 10; index++) assert.equal(catalog.peek(), undefined);
  assert.equal(calls, 1);
  clock += 10_000; fail = false;
  assert.equal(catalog.peek(), undefined);
  assert.equal(await catalog.read(), metadata);
  assert.equal(catalog.peek(), metadata); assert.equal(calls, 2);
  clock += 300_000;
  assert.equal(catalog.peek(), undefined);
  await catalog.read(); assert.equal(calls, 3);
});
