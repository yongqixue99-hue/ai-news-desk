import test from "node:test";
import assert from "node:assert/strict";
import { applySourceProbeResult, probeSource } from "./source-probe.js";
import type { SourceConfig } from "./types.js";

const rssSource = (patch: Partial<SourceConfig> = {}): SourceConfig => ({
  id: "source-1",
  name: "Example feed",
  kind: "rss",
  url: "https://example.com/feed.xml",
  enabled: true,
  selected: true,
  category: "technology",
  discoveryOnly: false,
  ...patch,
});

test("RSS probe reports items and resets the failure streak", async () => {
  const receivedSignals: AbortSignal[] = [];
  const result = await probeSource(rssSource({ consecutiveFailures: 3 }), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    fetcher: async (_url, init) => {
      receivedSignals.push(init.signal as AbortSignal);
      return new Response("<rss><channel><item/><item/></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      });
    },
  });

  assert.equal(receivedSignals.length, 1);
  assert.equal(receivedSignals[0] instanceof AbortSignal, true);
  assert.deepEqual(result, {
    sourceId: "source-1",
    status: "healthy",
    checkedAt: "2026-08-13T12:00:00.000Z",
    successfulAt: "2026-08-13T12:00:00.000Z",
    consecutiveFailures: 0,
    itemCount: 2,
    detail: "RSS 可访问，读取到 2 个条目",
    targetUrl: "https://example.com/feed.xml",
    httpStatus: 200,
  });
});

test("an empty RSS feed is a warning and increments the failure streak", async () => {
  const result = await probeSource(rssSource({
    consecutiveFailures: 1,
    lastSuccessfulAt: "2026-08-12T12:00:00.000Z",
  }), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    fetcher: async () => new Response("<rss><channel /></rss>", { status: 200 }),
  });

  assert.equal(result.status, "warning");
  assert.equal(result.consecutiveFailures, 2);
  assert.equal(result.successfulAt, "2026-08-12T12:00:00.000Z");
  assert.match(result.detail, /没有发现条目/);
});

test("a valid publisher feed larger than 512 KB is inspected within the bounded feed allowance", async () => {
  const largeDescription = "x".repeat(600 * 1024);
  const result = await probeSource(rssSource(), {
    fetcher: async () => new Response(`<rss><channel><item><description>${largeDescription}</description></item></channel></rss>`, {
      status: 200,
      headers: { "content-type": "application/rss+xml" },
    }),
  });

  assert.equal(result.status, "healthy");
  assert.equal(result.itemCount, 1);
});

test("an HTTP failure becomes an error without erasing the last success", async () => {
  const result = await probeSource(rssSource({
    consecutiveFailures: 2,
    lastSuccessfulAt: "2026-08-10T12:00:00.000Z",
  }), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    fetcher: async () => new Response("no", { status: 503 }),
  });

  assert.equal(result.status, "error");
  assert.equal(result.consecutiveFailures, 3);
  assert.equal(result.successfulAt, "2026-08-10T12:00:00.000Z");
  assert.equal(result.httpStatus, 503);
  assert.match(result.detail, /HTTP 503/);
});

test("probe results persist health, last success and failure streak on the source", () => {
  const source = rssSource({
    health: "healthy",
    lastSuccessfulAt: "2026-08-12T12:00:00.000Z",
    consecutiveFailures: 0,
  });

  applySourceProbeResult(source, {
    sourceId: source.id,
    status: "error",
    checkedAt: "2026-08-13T12:00:00.000Z",
    successfulAt: "2026-08-12T12:00:00.000Z",
    consecutiveFailures: 1,
    itemCount: 0,
    detail: "来源返回 HTTP 503",
    targetUrl: source.url!,
    httpStatus: 503,
  });

  assert.equal(source.health, "error");
  assert.equal(source.lastCheckedAt, "2026-08-13T12:00:00.000Z");
  assert.equal(source.lastSuccessfulAt, "2026-08-12T12:00:00.000Z");
  assert.equal(source.consecutiveFailures, 1);
  assert.equal(source.lastRawCount, 0);
  assert.equal(source.lastHealthDetail, "来源返回 HTTP 503");
});

test("source probing rejects private targets through the shared SSRF guard", async () => {
  const result = await probeSource(rssSource({ url: "http://127.0.0.1:4317/feed.xml" }), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });

  assert.equal(result.status, "error");
  assert.match(result.detail, /私网|回环|保留/);
});

test("a site-scoped discovery source probes its official homepage instead of Google News", async () => {
  let requestedUrl = "";
  const result = await probeSource(rssSource({
    id: "lpl-official",
    name: "LPL 官方",
    homepageUrl: "https://lpl.qq.com/",
    topicIds: ["esports"],
    routes: [{
      topicId: "esports",
      label: "LPL 赛事资讯",
      query: "site:lpl.qq.com LPL",
      category: "esports",
    }],
  }), {
    now: () => new Date("2026-08-13T12:00:00.000Z"),
    fetcher: async (url) => {
      requestedUrl = String(url);
      return new Response("<html><title>LPL</title></html>", { status: 200 });
    },
  });

  assert.equal(requestedUrl, "https://lpl.qq.com/");
  assert.equal(result.status, "healthy");
  assert.equal(result.detail, "官网可访问");
});

test("last30days probe reports an explicit setup boundary without attempting an HTTP request", async () => {
  let fetched = false;
  const result = await probeSource(rssSource({
    id: "last30days-community",
    name: "Last30days 社区趋势",
    kind: "last30days",
    url: undefined,
    homepageUrl: "https://github.com/mvanhorn/last30days-skill",
    role: "community",
    discoveryOnly: true,
    consecutiveFailures: 2,
  }), {
    now: () => new Date("2026-08-27T12:00:00.000Z"),
    fetcher: async () => {
      fetched = true;
      return new Response("unexpected");
    },
    last30DaysStatus: async () => ({
      installed: true,
      setupComplete: false,
      browserConsent: false,
      ready: false,
      detail: "尚未完成首次初始化；不会读取浏览器 Cookie",
      skillDir: "/tmp/last30days",
    }),
  });

  assert.equal(fetched, false);
  assert.equal(result.status, "warning");
  assert.equal(result.consecutiveFailures, 2);
  assert.match(result.detail, /不会读取浏览器 Cookie/);
});
