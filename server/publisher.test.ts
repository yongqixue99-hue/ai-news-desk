import assert from "node:assert/strict";
import test from "node:test";
import { ensureCdpPage } from "./publisher.js";

test("a running Chrome with no remaining tabs is repaired before Playwright connects", async () => {
  const calls: Array<{ url: string; method?: string }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method });
    if (url.endsWith("/json/list")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/json/new?")) {
      return new Response(JSON.stringify({ id: "target-1", url: "about:blank" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  };

  const repaired = await ensureCdpPage(9222, "about:blank", fakeFetch);

  assert.equal(repaired, true);
  assert.deepEqual(calls, [
    { url: "http://127.0.0.1:9222/json/list", method: undefined },
    { url: "http://127.0.0.1:9222/json/new?about%3Ablank", method: "PUT" },
  ]);
});

test("an existing Chrome tab is left untouched", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    return new Response(JSON.stringify([{ id: "target-1", type: "page" }]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const repaired = await ensureCdpPage(9222, "about:blank", fakeFetch);

  assert.equal(repaired, false);
  assert.deepEqual(calls, ["http://127.0.0.1:9222/json/list"]);
});
