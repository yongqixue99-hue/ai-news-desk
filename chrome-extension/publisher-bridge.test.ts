import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublisherBridgeClient,
  planEditorTab,
  startPublisherBridgePolling,
  XIAOHEIHE_PAGE_SCRIPTS,
} from "./publisher-bridge.js";

test("an article fill returns an existing Xiaoheihe tab to the configured creator entry", () => {
  assert.deepEqual(planEditorTab([
    {
      id: 17,
      active: true,
      windowId: 3,
      url: "https://xiaoheihe.cn/creator/editor/draft/image_text/local-1",
    },
  ], "https://xiaoheihe.cn/community/user/post_list"), {
    type: "navigate",
    tabId: 17,
    windowId: 3,
    url: "https://xiaoheihe.cn/community/user/post_list",
  });
});

test("fallback injection loads the image-integrity module before the page runner", () => {
  assert.deepEqual(XIAOHEIHE_PAGE_SCRIPTS, [
    "xiaoheihe-dom.js",
    "xiaoheihe-image-post-dom.js",
    "xiaoheihe-publisher-job.js",
    "xiaoheihe.js",
  ]);
});

test("the background bridge polls within two seconds while the service worker is awake", () => {
  const intervals: number[] = [];
  let runs = 0;
  const timer = startPublisherBridgePolling(
    () => { runs += 1; },
    (callback, milliseconds) => {
      intervals.push(milliseconds);
      callback();
      return 123;
    },
  );

  assert.equal(timer, 123);
  assert.equal(runs, 2);
  assert.deepEqual(intervals, [1_500]);
});

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
