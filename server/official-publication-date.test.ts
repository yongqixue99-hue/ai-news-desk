import assert from "node:assert/strict";
import test from "node:test";
import { verifyOfficialPublicationDates } from "./official-publication-date.js";
import { createSourceRouteReader, type SourceRouteReader } from "./source-route-cache.js";
import { parsePortableFeed } from "./structured-collector.js";
import { rawItemTimeRejectionReason } from "./scoring.js";
import type { RawHorizonItem } from "./types.js";

const now = new Date("2026-09-08T12:00:00Z");
const release = (index = 0): RawHorizonItem => ({
  id: `release-${index}`, source_type: "rss", title: `Introducing model ${index}`, url: `https://official.example/news/model-${index}`,
  content: `Official website update: Introducing model ${index}`, fetched_at: now.toISOString(),
  metadata: { source_id: "official", source_role: "official", source_format: "sitemap", sitemap_lastmod_status: "shared-batch", feed_name: "Official" },
});
const html = (date = "2026-09-07T10:00:00Z", extra = "") => `<html><head>
  <meta property="article:published_time" content="${date}"><meta property="og:title" content="Introducing Example 2.0">
  <meta name="description" content="Example 2.0 is now available through the official API."><meta name="author" content="Example Research">${extra}
  </head><body><article><h1>Introducing Example 2.0</h1><p>The new model adds a larger context window.</p></article></body></html>`;
const readerFor = (body: string) => createSourceRouteReader({ now: () => now, fetcher: async () => new Response(body) });

test("shared sitemap build dates are recovered from the original publication before time filtering", async () => {
  const xml = `<urlset>${Array.from({ length: 10 }, (_, index) => `<url><loc>https://official.example/news/introducing-model-${index}</loc><lastmod>2026-09-08T00:00:00Z</lastmod></url>`).join("")}</urlset>`;
  const raw = parsePortableFeed(xml, { feedUrl: "https://official.example/sitemap.xml", feedName: "Official", sourceId: "official", sourceRole: "official", category: "AI", fetchedAt: now.toISOString() });
  assert.equal(raw.every((entry) => entry.published_at === undefined), true);
  assert.equal(rawItemTimeRejectionReason(raw[0], {}, { windowHours: 48, now: now.getTime() }), "missing-published-at");
  const verified = await verifyOfficialPublicationDates(raw, { routeReader: readerFor(html()), now: () => now, maxChecks: 1 });
  assert.equal(verified[0].published_at, "2026-09-07T10:00:00.000Z");
  assert.equal(rawItemTimeRejectionReason(verified[0], {}, { windowHours: 48, now: now.getTime() }), undefined);
  assert.equal(verified[0].title, "Introducing Example 2.0");
  assert.equal(verified[0].author, "Example Research");
  assert.match(verified[0].content!, /official API/);
  assert.equal(verified[0].metadata?.date_verification, "verified");
  assert.equal(verified[0].metadata?.sitemap_original_title, raw[0].title);
  assert.equal(verified[0].url, raw[0].url);
  assert.equal(verified[0].id, raw[0].id);
  assert.equal(raw[0].published_at, undefined);
  assert.equal(verified[1].metadata?.date_verification, "pending-limit");
});

test("only undated official sitemap items are read and release titles take priority", async () => {
  const visited: string[] = [];
  const reader = createSourceRouteReader({ fetcher: async (url) => { visited.push(url); return new Response(html()); } });
  const items = [
    { ...release(0), title: "Our offices" }, release(1),
    { ...release(2), metadata: { ...release().metadata, source_role: "community" } },
    { ...release(3), metadata: { ...release().metadata, source_format: "rss" } },
    { ...release(4), published_at: "2026-09-06T00:00:00Z" },
  ];
  const result = await verifyOfficialPublicationDates(items, { routeReader: reader, maxChecks: 1 });
  assert.deepEqual(visited, [release(1).url]);
  assert.equal(result[0].metadata?.date_verification, "pending-limit");
  assert.equal(result[2], items[2]);
  assert.equal(result[3], items[3]);
  assert.equal(result[4], items[4]);
});

test("at most six article pages are read with at most two requests in flight", async () => {
  let active = 0;
  let highest = 0;
  let calls = 0;
  const reader = createSourceRouteReader({ fetcher: async () => {
    active += 1; highest = Math.max(highest, active); calls += 1;
    await new Promise<void>((resolve) => setImmediate(resolve));
    active -= 1;
    return new Response(html());
  } });
  const result = await verifyOfficialPublicationDates(Array.from({ length: 12 }, (_, index) => release(index)), { routeReader: reader, maxChecks: 99 });
  assert.equal(calls, 6);
  assert.equal(highest, 2);
  assert.equal(result.filter((entry) => entry.metadata?.date_verification === "pending-limit").length, 6);
});

test("modified dates, generic time elements, and invalid calendar dates never establish publication", async () => {
  for (const body of [
    '<meta property="article:modified_time" content="2026-09-07T10:00:00Z"><time datetime="2026-09-07">updated</time>',
    '<script type="application/ld+json">{"@type":"NewsArticle","dateModified":"2026-09-07"}</script>',
    html("2026-02-30"), html("2026-09-07T25:00:00Z"), html("2026-09-07T10:00:00"),
  ]) {
    const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(body) });
    assert.equal(result.published_at, undefined);
    assert.equal(result.metadata?.date_verification, "unavailable");
  }
});

test("only the current article JSON-LD can establish a publication date", async () => {
  const body = `<script type="application/ld+json">${JSON.stringify({ "@graph": [
    { "@type": "WebSite", datePublished: "2001-01-01" },
    { "@type": "NewsArticle", url: "https://other.example/news", datePublished: "2026-09-06" },
    { "@type": "NewsArticle", mainEntityOfPage: { "@id": release().url }, datePublished: "2026-09-07", headline: "Example 2.0 launches", description: "A new API model is available.", author: { "@type": "Organization", name: "Example Research" } },
  ] })}</script>`;
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(body) });
  assert.equal(result.published_at, "2026-09-07T00:00:00.000Z");
  assert.equal(result.title, "Example 2.0 launches");
  assert.equal(result.author, "Example Research");
  assert.equal(result.metadata?.date_verification, "verified");
});

test("a related-article list is not publication evidence for the current page", async () => {
  const body = '<script type="application/ld+json">{"@type":"WebPage","mainEntity":{"@type":"ItemList","itemListElement":[{"@type":"NewsArticle","datePublished":"2026-09-07","headline":"Another release"}]}}</script>';
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(body) });
  assert.equal(result.published_at, undefined);
  assert.equal(result.metadata?.date_verification, "unavailable");
});

test("conflicting first publication evidence fails closed", async () => {
  for (const extra of [
    '<meta property="article:published_time" content="2026-09-06T10:00:00Z">',
    '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"2026-09-06"}</script>',
    '<script type="application/ld+json">{"@type":"NewsArticle","datePublished":"invalid"}</script>',
  ]) {
    const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(html("2026-09-07T10:00:00Z", extra)) });
    assert.equal(result.published_at, undefined);
    assert.equal(result.metadata?.date_verification, "unavailable");
  }
});

test("a calendar publication day can agree with a precise publication timestamp", async () => {
  const body = html("2026-09-07T10:00:00+08:00", '<script type="application/ld+json">{"@type":"BlogPosting","datePublished":"2026-09-07"}</script>');
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(body) });
  assert.equal(result.published_at, "2026-09-07T02:00:00.000Z");
});

test("future original publication dates are preserved for the downstream future-date gate", async () => {
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(html("2026-09-10T00:00:00Z")) });
  assert.equal(result.published_at, "2026-09-10T00:00:00.000Z");
  assert.equal(rawItemTimeRejectionReason(result, {}, { windowHours: 48, now: now.getTime() }), "future-published-at");
});

test("cross-site canonical and linked article metadata cannot rewrite the original identity", async () => {
  const body = html("2026-09-07T10:00:00Z", '<link rel="canonical" href="https://unrelated.example/elsewhere"><script type="application/ld+json">{"@type":"NewsArticle","url":"https://unrelated.example/elsewhere","datePublished":"2026-09-01"}</script>');
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: readerFor(body) });
  assert.equal(result.url, release().url);
  assert.equal(result.published_at, "2026-09-07T10:00:00.000Z");
  assert.equal(result.metadata?.canonical_url, undefined);
});

test("article page conditional requests reuse a verified date without changing its meaning", async () => {
  let calls = 0;
  const reader = createSourceRouteReader({ now: () => now, fetcher: async (_url, init) => {
    calls += 1;
    if (calls === 2) {
      assert.equal(new Headers(init.headers).get("if-none-match"), '"page"');
      return new Response(null, { status: 304 });
    }
    return new Response(html(), { headers: { etag: '"page"' } });
  } });
  await verifyOfficialPublicationDates([release()], { routeReader: reader, now: () => now });
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: reader, now: () => now });
  assert.equal(result.published_at, "2026-09-07T10:00:00.000Z");
  assert.equal(result.metadata?.date_verification_cache_status, "not-modified");
});

test("a cached record for a different original URL is rejected", async () => {
  const routeReader: SourceRouteReader = { read: async () => ({ items: [{ ...release(), url: "https://elsewhere.example/news", published_at: "2026-09-07T10:00:00Z" }], cacheStatus: "not-modified", lastSuccessfulAt: now.toISOString() }) };
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader });
  assert.equal(result.published_at, undefined);
  assert.equal(result.metadata?.date_verification, "unavailable");
});

test("network failures retain undated records and cancellation still propagates", async () => {
  const reader = createSourceRouteReader({ fetcher: async () => { throw new TypeError("private error detail"); } });
  const [result] = await verifyOfficialPublicationDates([release()], { routeReader: reader });
  assert.equal(result.published_at, undefined);
  assert.equal(result.metadata?.date_verification, "unavailable");
  assert.equal(JSON.stringify(result).includes("private error detail"), false);
  const controller = new AbortController();
  const cancelling = createSourceRouteReader({ fetcher: async () => { controller.abort(); return new Response(html()); } });
  await assert.rejects(verifyOfficialPublicationDates([release()], { routeReader: cancelling, signal: controller.signal }), { name: "AbortError" });
});
