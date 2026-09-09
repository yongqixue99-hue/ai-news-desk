import assert from "node:assert/strict";
import test from "node:test";
import { defaultSources } from "./defaults.js";
import { parseQwenOfficialIndex, qwenOfficialIndexUrl } from "./official-news-index.js";
import { collectPortableStructuredSources } from "./structured-collector.js";
import { probeSource } from "./source-probe.js";

const source = defaultSources.find((source) => source.id === "qwen-official")!;
const now = "2026-09-08T00:00:00.000Z";
const payload = JSON.stringify({ data: { articles: [
  { title: "发布说明", path: "release-one", content: "<p>模型开放使用。</p><script>不可信页面脚本</script>", extra: { date: "2026-09-03T10:00:00+08:00", author: "Qwen" } },
  { title: "无日期的技术介绍", path: "technical-two", extra: { introduction: "<p>只读资料介绍。</p>" } },
  { title: "恶意地址", path: "https://evil.example/post", extra: { date: now } },
] } });

test("official index preserves article identity, attribution and actual dates without inventing recency", () => {
  const items = parseQwenOfficialIndex(payload, source, now);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.url, "https://qwen.ai/blog?id=release-one");
  assert.equal(items[0]?.published_at, "2026-09-03T02:00:00.000Z");
  assert.equal(items[0]?.author, "Qwen");
  assert.equal(items[0]?.content, "模型开放使用。");
  assert.equal(items[1]?.published_at, undefined);
  assert.equal(items[1]?.fetched_at, now);
  assert.throws(() => parseQwenOfficialIndex('{"data":{}}', source, now), /格式已变化/);
});

test("Qwen discovery and source testing use its own article index when news search fails", async () => {
  const fetcher = async (url: string | URL) => String(url) === qwenOfficialIndexUrl
    ? new Response(payload, { headers: { "content-type": "application/json" } })
    : new Response("unavailable", { status: 503 });
  const result = await collectPortableStructuredSources([source], { topicIds: ["ai"] }, { fetcher });
  assert.equal(result.items.length, 2);
  assert.equal(result.failures[source.id], undefined);
  assert.deepEqual(result.routeResults.map((route) => route.status), ["success", "error"]);
  const probe = await probeSource(source, { fetcher });
  assert.equal(probe.status, "healthy");
  assert.equal(probe.itemCount, 2);
  assert.equal(probe.targetUrl, qwenOfficialIndexUrl);
});

test("the official JSON adapter has a bounded larger response allowance than normal RSS", async () => {
  const large = payload.slice(0, -1) + ',"padding":"' + "x".repeat(4 * 1024 * 1024) + '"}';
  const direct = { ...source, routes: source.routes!.slice(0, 1) };
  const result = await collectPortableStructuredSources([direct], { topicIds: ["ai"] }, { fetcher: async () => new Response(large) });
  assert.equal(result.items.length, 2);
  const oversized = await collectPortableStructuredSources([direct], { topicIds: ["ai"] }, {
    fetcher: async () => new Response(payload, { headers: { "content-length": String(8 * 1024 * 1024 + 1) } }),
  });
  assert.match(oversized.failures[source.id] ?? "", /超过允许大小/);
});
