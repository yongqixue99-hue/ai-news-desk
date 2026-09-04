import assert from "node:assert/strict";
import test from "node:test";
import { createPublisherBridgeClient } from "./publisher-bridge.js";

test("the background publisher bridge repairs pairing after the local service restarts", async () => {
  const calls: Array<{ path: string; token: string }> = [];
  let bootstrapCount = 0;
  const fetcher = async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    calls.push({ path: url.pathname, token: headers.get("x-ai-news-extension-token") ?? "" });

    if (url.pathname.endsWith("/bootstrap")) {
      bootstrapCount += 1;
      return Response.json({ token: bootstrapCount === 1 ? "token-a" : "token-b" });
    }
    if (url.pathname.endsWith("/heartbeat")) {
      return calls.filter((entry) => entry.path.endsWith("/heartbeat")).length === 1
        ? new Response(null, { status: 500 })
        : Response.json({ ok: true });
    }
    if (url.pathname.endsWith("/jobs/next")) return new Response(null, { status: 204 });
    throw new Error(`Unexpected request: ${url.pathname}`);
  };

  const client = createPublisherBridgeClient({
    origin: "http://127.0.0.1:4317",
    clientId: "extension-id",
    version: "0.1.21",
    fetcher,
    runJob: async () => ({ pageUrl: "", steps: [] }),
  });

  assert.deepEqual(await client.tick(), { status: "disconnected" });
  assert.deepEqual(await client.tick(), { status: "connected" });
  assert.equal(bootstrapCount, 2);
  assert.deepEqual(
    calls.filter((entry) => entry.path.endsWith("/heartbeat")).map((entry) => entry.token),
    ["token-a", "token-b"],
  );
});
