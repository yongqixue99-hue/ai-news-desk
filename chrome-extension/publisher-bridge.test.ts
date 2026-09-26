import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublisherBridgeClient,
  planEditorTab,
  startPublisherBridgePolling,
  XIAOHEIHE_PAGE_SCRIPTS,
} from "./publisher-bridge.js";
import { ExtensionPublisherBridge, MINIMUM_EXTENSION_VERSION, type ExtensionPublisherJob } from "../server/publisher-extension.js";

const receiptJob = {
  id: "receipt-job", draftId: "draft", createdAt: "2026-09-26T00:00:00Z",
  editorUrl: "https://www.xiaoheihe.cn/creator/editor/draft/article", contentFormat: "article",
  title: "测试", bodyHtml: "<p>正文</p>", community: "盒友杂谈", topics: ["AI"], images: [],
} satisfies ExtensionPublisherJob;
const receipt = { pageUrl: `${receiptJob.editorUrl}/local-result`, steps: [{ name: "标题", ok: true, detail: "已填入" }] };

for (const failure of ["network", "http", "negative-ack", "invalid-json"] as const) {
  test(`a ${failure} receipt failure retries the report without running the platform job again`, async () => {
    const calls: string[] = [];
    const reports: string[] = [];
    let runs = 0;
    const client = createPublisherBridgeClient({
      origin: "http://127.0.0.1:4317", clientId: "extension-id", version: MINIMUM_EXTENSION_VERSION,
      fetcher: async (input, init) => {
        const path = new URL(String(input)).pathname;
        calls.push(path);
        if (path.endsWith("/bootstrap")) return Response.json({ token: "paired" });
        if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
        if (path.endsWith("/jobs/next")) return calls.filter(item => item.endsWith("/jobs/next")).length === 1
          ? Response.json(receiptJob) : new Response(null, { status: 204 });
        reports.push(String(init?.body));
        if (reports.length === 1) {
          if (failure === "network") throw new Error("connection reset");
          if (failure === "http") return new Response(null, { status: 503 });
          if (failure === "negative-ack") return Response.json({ ok: false });
          return new Response("invalid JSON");
        }
        return Response.json({ ok: true });
      },
      runJob: async () => { runs++; return receipt; },
    });
    assert.deepEqual(await client.tick().catch(() => ({ status: "disconnected" })), { status: "disconnected" });
    assert.deepEqual(await client.tick(), { status: "completed" });
    assert.equal(runs, 1);
    assert.equal(reports.length, 2);
    assert.equal(reports[0], reports[1]);
    assert.equal(calls.filter(path => path.endsWith("/jobs/next")).length, 1);
    assert.deepEqual(await client.tick(), { status: "connected" });
  });
}

test("a lost response after server acceptance is acknowledged on retry without refilling", async () => {
  const bridge = new ExtensionPublisherBridge(Date.now, 1_000);
  const clientId = "extension-id";
  bridge.heartbeat(bridge.token, clientId, MINIMUM_EXTENSION_VERSION);
  const completion = bridge.submit(receiptJob);
  let reports = 0;
  let runs = 0;
  const client = createPublisherBridgeClient({
    origin: "http://127.0.0.1:4317", clientId, version: MINIMUM_EXTENSION_VERSION,
    fetcher: async (input, init) => {
      const path = new URL(String(input)).pathname;
      const token = new Headers(init?.headers).get("x-ai-news-extension-token") ?? undefined;
      if (path.endsWith("/bootstrap")) return Response.json(bridge.bootstrap());
      if (path.endsWith("/heartbeat")) return Response.json(bridge.heartbeat(token, clientId, MINIMUM_EXTENSION_VERSION));
      if (path.endsWith("/jobs/next")) {
        const claimed = bridge.claim(token, clientId);
        return claimed ? Response.json(claimed) : new Response(null, { status: 204 });
      }
      reports++;
      const result = bridge.complete(token, clientId, receiptJob.id, JSON.parse(String(init?.body)));
      if (reports === 1) throw new Error("response lost after commit");
      return Response.json(result);
    },
    runJob: async () => { runs++; return receipt; },
  });
  await client.tick().catch(() => undefined);
  assert.deepEqual(await completion, receipt);
  assert.deepEqual(await client.tick(), { status: "completed" });
  assert.equal(reports, 2);
  assert.equal(runs, 1);
});

for (const reason of ["restart", "expired"] as const) {
  test(`a ${reason} server job releases its unacknowledged receipt and allows the user's next job`, async () => {
    let serverNow = 1_000;
    let bridge = new ExtensionPublisherBridge(() => serverNow, 1_000);
    const clientId = "extension-id";
    bridge.heartbeat(bridge.token, clientId, MINIMUM_EXTENSION_VERSION);
    const firstCompletion = bridge.submit(receiptJob);
    const ran: string[] = [];
    let reports = 0;
    const client = createPublisherBridgeClient({
      origin: "http://127.0.0.1:4317", clientId, version: MINIMUM_EXTENSION_VERSION,
      now: () => 1_000,
      fetcher: async (input, init) => {
        const path = new URL(String(input)).pathname;
        const token = new Headers(init?.headers).get("x-ai-news-extension-token") ?? undefined;
        try {
          if (path.endsWith("/bootstrap")) return Response.json(bridge.bootstrap());
          if (path.endsWith("/heartbeat")) return Response.json(bridge.heartbeat(token, clientId, MINIMUM_EXTENSION_VERSION));
          if (path.endsWith("/jobs/next")) {
            const next = bridge.claim(token, clientId);
            return next ? Response.json(next) : new Response(null, { status: 204 });
          }
          const jobId = path.split("/").at(-2)!;
          const acknowledged = bridge.complete(token, clientId, jobId, JSON.parse(String(init?.body)));
          if (++reports === 1) throw new Error("ACK lost before restart or expiration");
          return Response.json(acknowledged);
        } catch (error) {
          const status = error instanceof Error && "status" in error && typeof error.status === "number" ? error.status : 500;
          return Response.json({ ok: false }, { status });
        }
      },
      runJob: async job => { ran.push(job.id); return receipt; },
    });
    assert.deepEqual(await client.tick(), { status: "disconnected" });
    await firstCompletion;
    if (reason === "restart") bridge = new ExtensionPublisherBridge(() => serverNow, 1_000);
    else serverNow += 5 * 60_000 + 1;
    bridge.heartbeat(bridge.token, clientId, MINIMUM_EXTENSION_VERSION);
    const nextJob = { ...receiptJob, id: "new-user-request" };
    const nextCompletion = bridge.submit(nextJob);
    try {
      await assert.rejects(client.tick(), /任务已结束.*不要重复填入/);
      assert.deepEqual(await client.tick(), { status: "completed" });
      await nextCompletion;
      assert.deepEqual(ran, [receiptJob.id, nextJob.id]);
      assert.equal(reports, 2);
    } finally {
      // Complete any queued fixture on a red run rather than leaking its timeout.
      const pending = bridge.claim(bridge.token, clientId);
      if (pending) bridge.complete(bridge.token, clientId, pending.id, receipt);
      await nextCompletion;
    }
  });
}

test("an unacknowledged report expires without success or rerunning the old job", async () => {
  let now = 1_000;
  let runs = 0;
  let claims = 0;
  let reports = 0;
  const client = createPublisherBridgeClient({
    origin: "http://127.0.0.1:4317", clientId: "extension-id", version: MINIMUM_EXTENSION_VERSION,
    now: () => now,
    fetcher: async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/bootstrap")) return Response.json({ token: "paired" });
      if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
      if (path.endsWith("/jobs/next")) return ++claims === 1 ? Response.json(receiptJob) : new Response(null, { status: 204 });
      reports++;
      return Response.json({ ok: false });
    },
    runJob: async () => { runs++; return receipt; },
  });
  assert.deepEqual(await client.tick(), { status: "disconnected" });
  client.reset();
  assert.deepEqual(await client.tick(), { status: "disconnected" }, "repairing pairing must not discard the pending report");
  now += 240_001;
  await assert.rejects(client.tick(), /未获工作台确认/);
  assert.equal(reports, 2);
  assert.equal(runs, 1);
  assert.equal(claims, 1);
  assert.deepEqual(await client.tick(), { status: "connected" });
});

test("overlapping polling cannot replace an unacknowledged receipt with another job", async () => {
  let release: (() => void) | undefined;
  let reports = 0;
  let claims = 0;
  const client = createPublisherBridgeClient({
    origin: "http://127.0.0.1:4317", clientId: "extension-id", version: MINIMUM_EXTENSION_VERSION,
    fetcher: async input => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith("/bootstrap")) return Response.json({ token: "paired" });
      if (path.endsWith("/heartbeat")) return Response.json({ ok: true });
      if (path.endsWith("/jobs/next")) { claims++; return Response.json(receiptJob); }
      if (++reports === 1) return new Response(null, { status: 503 });
      await new Promise<void>(resolve => { release = resolve; });
      return Response.json({ ok: true });
    },
    runJob: async () => receipt,
  });
  await client.tick();
  const retry = client.tick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await client.tick(), { status: "busy" });
  release?.();
  assert.deepEqual(await retry, { status: "completed" });
  assert.equal(claims, 1);
  assert.equal(reports, 2);
});

test("an article fill preserves another open draft and creates a new editor", () => {
  assert.deepEqual(planEditorTab([
    {
      id: 17,
      active: true,
      windowId: 3,
      url: "https://xiaoheihe.cn/creator/editor/draft/image_text/local-1",
    },
  ], "https://xiaoheihe.cn/community/user/post_list"), {
    type: "create",
    url: "https://xiaoheihe.cn/community/user/post_list",
  });
});

test("fallback injection loads the image-integrity module before the page runner", () => {
  assert.deepEqual(XIAOHEIHE_PAGE_SCRIPTS, [
    "xiaoheihe-dom.js",
    "xiaoheihe-image-post-dom.js",
    "xiaoheihe-publisher-job.js",
    "xiaoheihe-settings.js",
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
