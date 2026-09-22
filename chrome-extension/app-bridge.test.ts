import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("an invalidated content bridge stops polling after the extension reloads", async () => {
  const script = await readFile(new URL("./app-bridge.js", import.meta.url), "utf8");
  const runtime = { id: "extension-id", getManifest: () => ({ version: "0.1.24" }) };
  let requests = 0;
  const context = vm.createContext({
    chrome: { runtime }, URL, window: { location: { href: "http://127.0.0.1:4317/" } },
    document: { addEventListener() {} }, setInterval() {}, console,
    fetch: async () => { requests++; return { ok: false, status: 503 }; },
  });
  vm.runInContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  requests = 0;
  runtime.id = "";
  await context.bridgeTick();
  assert.equal(requests, 0, "a stale bridge must not claim work or send misleading heartbeats");
});
