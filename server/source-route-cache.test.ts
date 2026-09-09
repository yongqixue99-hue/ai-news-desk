import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createSourceRouteReader, SourceRouteReadError, type SourceRouteCacheStorage, type SourceRouteReadRequest } from "./source-route-cache.js";
import type { RawHorizonItem } from "./types.js";

const start = Date.parse("2026-09-08T00:00:00Z");
const item: RawHorizonItem = {
  id: "release", source_type: "rss", title: "A model release", url: "https://official.example/releases/one",
  published_at: "2026-09-07T00:00:00Z", fetched_at: new Date(start).toISOString(), metadata: { source_id: "official" },
};
const request = { sourceId: "official", url: "https://official.example/rss", maxBytes: 1024, parse: () => [item] };

test("a publication-date page redirected to another article cannot donate its date", async () => {
  const reader = createSourceRouteReader({ fetcher: async () => {
    const response = new Response("new article");
    Object.defineProperty(response, "url", { value: "https://official.example/another-article" });
    return response;
  } });
  await assert.rejects(reader.read({ ...request, samePageOnly: true }), /其他页面/u);
});
const ok = (headers?: HeadersInit) => new Response("feed", { headers });
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const memoryStorage = () => {
  let value: string | undefined;
  const storage: SourceRouteCacheStorage = { read: async () => value, write: async (next) => { value = next; } };
  return { storage, get: () => value, set: (next: string) => { value = next; } };
};

test("conditional validation reuses parsed records and preserves event dates", async () => {
  let now = start;
  let parsed = 0;
  const headers: Headers[] = [];
  const reader = createSourceRouteReader({ now: () => now, fetcher: async (_url, init) => {
    headers.push(new Headers(init?.headers));
    return headers.length === 1 ? ok({ etag: '"one"', "last-modified": "Mon, 07 Sep 2026 00:00:00 GMT" }) : new Response(null, { status: 304 });
  } });
  const input = { ...request, parse: () => { parsed += 1; return [item]; } };
  const fresh = await reader.read(input);
  now += 60_000;
  const cached = await reader.read(input);
  assert.equal(fresh.cacheStatus, "fresh");
  assert.equal(cached.cacheStatus, "not-modified");
  assert.equal(parsed, 1);
  assert.equal(headers[1].get("if-none-match"), '"one"');
  assert.equal(headers[1].get("if-modified-since"), "Mon, 07 Sep 2026 00:00:00 GMT");
  assert.equal(cached.items[0].published_at, item.published_at);
  assert.equal(cached.items[0].fetched_at, new Date(now).toISOString());
  assert.equal(cached.lastSuccessfulAt, new Date(now).toISOString());
});

test("an orphan 304 retries once without caller-supplied conditional headers", async () => {
  const headers: Headers[] = [];
  const reader = createSourceRouteReader({ fetcher: async (_url, init) => {
    headers.push(new Headers(init?.headers));
    return headers.length === 1 ? new Response(null, { status: 304 }) : ok();
  } });
  const result = await reader.read({ ...request, init: { headers: { "if-none-match": '"invalid"' } } });
  assert.equal(result.items.length, 1);
  assert.equal(headers.length, 2);
  assert.equal(headers[1].has("if-none-match"), false);
});

test("repeated orphan 304 fails clearly instead of silently returning no news", async () => {
  let calls = 0;
  const reader = createSourceRouteReader({ fetcher: async () => { calls += 1; return new Response(null, { status: 304 }); } });
  await assert.rejects(reader.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.code === "invalid-not-modified");
  assert.equal(calls, 2);
});

test("malformed fresh content cannot replace the last valid parsed response", async () => {
  let calls = 0;
  const reader = createSourceRouteReader({ fetcher: async () => {
    calls += 1;
    return calls === 3 ? new Response(null, { status: 304 }) : ok({ etag: calls === 1 ? '"valid"' : '"broken"' });
  } });
  await reader.read(request);
  await assert.rejects(reader.read({ ...request, parse: () => { throw new Error("untrusted content containing secret"); } }), /来源内容解析失败/);
  assert.equal((await reader.read(request)).items[0].id, item.id);
});

test("429 Retry-After blocks attempts without reporting stale success", async () => {
  let now = start;
  let calls = 0;
  const reader = createSourceRouteReader({ now: () => now, fetcher: async () => {
    calls += 1;
    return calls === 1 ? new Response(null, { status: 429, headers: { "retry-after": "120" } }) : ok();
  } });
  await assert.rejects(reader.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.statusCode === 429 && error.retryAt === new Date(start + 120_000).toISOString());
  now += 119_000;
  await assert.rejects(reader.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.code === "backoff");
  assert.equal(calls, 1);
  now += 1000;
  assert.equal((await reader.read(request)).cacheStatus, "fresh");
});

test("Retry-After dates are supported and excessive server delays are capped", async () => {
  for (const [value, expected] of [[new Date(start + 90_000).toUTCString(), 90_000], ["999999", 1_800_000]] as const) {
    const reader = createSourceRouteReader({ now: () => start, fetcher: async () => new Response(null, { status: 503, headers: { "retry-after": value } }) });
    await assert.rejects(reader.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.retryAt === new Date(start + expected).toISOString());
  }
});

test("connection failures back off exponentially and a successful response resets failures", async () => {
  let now = start;
  let broken = true;
  const reader = createSourceRouteReader({ now: () => now, fetcher: async () => {
    if (broken) throw new TypeError("fetch failed: credentials must never be exposed");
    return ok();
  } });
  for (const delay of [30_000, 60_000, 120_000, 240_000, 480_000, 960_000, 1_800_000, 1_800_000]) {
    await assert.rejects(reader.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.retryAt === new Date(now + delay).toISOString() && !error.message.includes("credentials"));
    now += delay;
  }
  broken = false;
  await reader.read(request);
  broken = true;
  await assert.rejects(reader.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.retryAt === new Date(now + 30_000).toISOString());
});

test("user cancellation never adds backoff", async () => {
  const controller = new AbortController();
  let calls = 0;
  const reader = createSourceRouteReader({ fetcher: async (_url, init) => {
    calls += 1;
    if (calls === 1) { controller.abort(); init?.signal?.throwIfAborted(); }
    return ok();
  } });
  await assert.rejects(reader.read({ ...request, init: { signal: controller.signal } }), { name: "AbortError" });
  assert.equal((await reader.read(request)).items.length, 1);
  assert.equal(calls, 2);
});

test("response bodies are cancellable even when a custom fetcher returns its own stream", async () => {
  const controller = new AbortController();
  let cancelled = false;
  let calls = 0;
  const reader = createSourceRouteReader({ fetcher: async () => {
    calls += 1;
    return calls === 1 ? new Response(new ReadableStream({ cancel() { cancelled = true; } })) : ok();
  } });
  const pending = reader.read({ ...request, init: { signal: controller.signal } });
  await tick();
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(cancelled, true);
  assert.equal((await reader.read(request)).items.length, 1);
});

test("host concurrency is two and cancelling queued work never sends it", async () => {
  const releases: Array<() => void> = [];
  const visited: string[] = [];
  const reader = createSourceRouteReader({ fetcher: async (url) => {
    visited.push(String(url));
    await new Promise<void>((resolve) => releases.push(resolve));
    return ok();
  } });
  const first = reader.read({ ...request, url: "https://official.example/one" });
  const second = reader.read({ ...request, url: "https://official.example/two" });
  const controller = new AbortController();
  const cancelled = reader.read({ ...request, url: "https://official.example/three", init: { signal: controller.signal } });
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  const fourth = reader.read({ ...request, url: "https://official.example/four" });
  await tick();
  assert.equal(visited.length, 2);
  controller.abort();
  await rejected;
  releases.shift()!();
  await first;
  await tick();
  assert.deepEqual(visited, ["https://official.example/one", "https://official.example/two", "https://official.example/four"]);
  releases.splice(0).forEach((release) => release());
  await Promise.all([second, fourth]);
});

test("unrelated hosts do not share a request queue", async () => {
  const releases: Array<() => void> = [];
  const reader = createSourceRouteReader({ fetcher: async () => { await new Promise<void>((resolve) => releases.push(resolve)); return ok(); } });
  const pending = ["one", "two", "three"].map((host) => reader.read({ ...request, url: `https://${host}.example/rss` }));
  await tick();
  assert.equal(releases.length, 3);
  releases.forEach((release) => release());
  await Promise.all(pending);
});

test("a new reader can restore validated cached entries from its own directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "news-route-cache-"));
  try {
    await createSourceRouteReader({ cacheDirectory: directory, fetcher: async () => ok({ etag: '"persisted"' }) }).read(request);
    let etag: string | null = null;
    const reader = createSourceRouteReader({ cacheDirectory: directory, fetcher: async (_url, init) => {
      etag = new Headers(init?.headers).get("if-none-match");
      return new Response(null, { status: 304 });
    } });
    const result = await reader.read({ ...request, parse: () => { throw new Error("must not parse again"); } });
    assert.equal(etag, '"persisted"');
    assert.equal(result.items[0].id, item.id);
    assert.equal(JSON.parse(await readFile(join(directory, "source-routes-v1.json"), "utf8")).schema, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("corrupt or incompatible storage is ignored and I/O errors never block collection", async () => {
  for (const content of ["broken", '{"schema":999,"entries":[]}', '{"schema":1,"entries":[{"key":"bad","items":[]}]}']) {
    const { storage, set } = memoryStorage();
    set(content);
    const reader = createSourceRouteReader({ storage, fetcher: async () => ok() });
    assert.equal((await reader.read(request)).items.length, 1);
  }
  const reader = createSourceRouteReader({ storage: { read: async () => { throw new Error("disk"); }, write: async () => { throw new Error("disk"); } }, fetcher: async () => ok() });
  assert.equal((await reader.read(request)).items.length, 1);
});

test("a malformed cached validator is ignored instead of preventing a fresh request", async () => {
  const { storage, get, set } = memoryStorage();
  await createSourceRouteReader({ storage, fetcher: async () => ok({ etag: '"one"' }) }).read(request);
  const data = JSON.parse(get()!);
  data.entries[0].etag = "损坏的标头";
  set(JSON.stringify(data));
  let validator: string | null = "initial";
  const reader = createSourceRouteReader({ storage, fetcher: async (_url, init) => {
    validator = new Headers(init.headers).get("if-none-match");
    return ok();
  } });
  assert.equal((await reader.read(request)).cacheStatus, "fresh");
  assert.equal(validator, null);
});

test("a request can be cancelled while cache storage is still loading", async () => {
  let finishRead!: (value: string | undefined) => void;
  const controller = new AbortController();
  const reader = createSourceRouteReader({ storage: {
    read: () => new Promise((resolve) => { finishRead = resolve; }), write: async () => undefined,
  }, fetcher: async () => ok() });
  const pending = reader.read({ ...request, init: { signal: controller.signal } });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  await tick();
  controller.abort();
  const result = await Promise.race([rejected.then(() => "cancelled"), tick().then(() => "still waiting")]);
  finishRead(undefined);
  await rejected;
  assert.equal(result, "cancelled");
});

test("cache identity separates sources, formats, URLs, parser versions, and request representations", async () => {
  const sent: Headers[] = [];
  const reader = createSourceRouteReader({ fetcher: async (_url, init) => { sent.push(new Headers(init?.headers)); return ok({ etag: '"one"' }); } });
  await reader.read(request);
  const changes: Partial<SourceRouteReadRequest>[] = [
    { sourceId: "another" }, { format: "another" }, { url: `${request.url}?topic=another` }, { parserVersion: "v2" },
    { init: { headers: { accept: "application/json" } } }, { init: { headers: { "accept-language": "zh-CN" } } },
    { init: { headers: { authorization: "Bearer private-key" } } },
  ];
  for (const changed of changes) await reader.read({ ...request, ...changed });
  assert.equal(sent.slice(1).every((headers) => !headers.has("if-none-match")), true);
});

test("persisted backoff survives a reader restart without making another request", async () => {
  const { storage, get } = memoryStorage();
  const first = createSourceRouteReader({ storage, now: () => start, fetcher: async () => new Response(null, { status: 429, headers: { "retry-after": "60" } }) });
  await assert.rejects(first.read(request));
  let called = false;
  const second = createSourceRouteReader({ storage, now: () => start + 10_000, fetcher: async () => { called = true; return ok(); } });
  await assert.rejects(second.read(request), (error: unknown) => error instanceof SourceRouteReadError && error.code === "backoff");
  assert.equal(called, false);
  assert.equal(get()!.includes("official.example/rss"), false);
});

test("serialized cache capacity is bounded independently of route count", async () => {
  const { storage, get } = memoryStorage();
  const reader = createSourceRouteReader({ storage, fetcher: async () => ok({ etag: '"one"' }) });
  const large = { ...item, content: "a".repeat(900_000) };
  for (let index = 0; index < 12; index += 1) await reader.read({ ...request, url: `https://official.example/large-${index}`, parse: () => [large] });
  assert.ok(Buffer.byteLength(get()!, "utf8") <= 8 * 1024 * 1024);
  assert.ok(JSON.parse(get()!).entries.length < 12);
});

test("stored entries are bounded to 64 and cannot be mutated through returned objects", async () => {
  const { storage, get } = memoryStorage();
  const reader = createSourceRouteReader({ storage, fetcher: async () => ok({ etag: '"one"' }) });
  for (let index = 0; index < 70; index += 1) await reader.read({ ...request, url: `https://official.example/${index}` });
  assert.equal(JSON.parse(get()!).entries.length, 64);
  const first = await reader.read(request);
  first.items[0].metadata!.source_id = "modified";
  const restored = createSourceRouteReader({ storage, fetcher: async () => new Response(null, { status: 304 }) });
  assert.equal((await restored.read(request)).items[0].metadata!.source_id, "official");
});

test("no-store responses remove previously stored validators", async () => {
  let calls = 0;
  const sent: Headers[] = [];
  const reader = createSourceRouteReader({ fetcher: async (_url, init) => {
    calls += 1;
    sent.push(new Headers(init?.headers));
    return ok({ etag: '"one"', ...(calls === 2 ? { "cache-control": "no-store" } : {}) });
  } });
  await reader.read(request);
  await reader.read(request);
  await reader.read(request);
  assert.equal(sent[2].has("if-none-match"), false);
});

test("oversized bodies and invalid parsed records are rejected before caching", async () => {
  const { storage, get } = memoryStorage();
  const reader = createSourceRouteReader({ storage, fetcher: async () => ok() });
  await assert.rejects(reader.read({ ...request, maxBytes: 2 }), /超过允许大小/);
  await assert.rejects(reader.read({ ...request, parse: () => [{ ...item, url: "javascript:alert(1)" }] }), /来源内容解析失败/);
  assert.equal(get(), undefined);
});
