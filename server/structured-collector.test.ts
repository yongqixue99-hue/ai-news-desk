import assert from "node:assert/strict";
import test from "node:test";
import { collectPortableStructuredSources, parsePortableFeed } from "./structured-collector.js";
import type { SourceConfig } from "./types.js";

const source: SourceConfig = {
  id: "portable-feed",
  name: "Portable Feed",
  kind: "rss",
  url: "https://example.com/feed.xml",
  topicIds: ["ai"],
  enabled: true,
  selected: true,
  category: "ai-official",
  role: "official",
  discoveryOnly: false,
};

test("portable collector parses RSS and namespaced content without Mac-only helpers", () => {
  const items = parsePortableFeed(`
    <rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel>
        <item>
          <guid>story-1</guid>
          <title>Portable AI release</title>
          <link>https://example.com/news/portable</link>
          <pubDate>Sun, 30 Aug 2026 02:00:00 GMT</pubDate>
          <content:encoded><![CDATA[<p>A <strong>cross-platform</strong> collector shipped.</p>]]></content:encoded>
        </item>
      </channel>
    </rss>
  `, {
    feedUrl: source.url!,
    feedName: source.name,
    sourceId: source.id,
    sourceRole: "official",
    category: source.category,
    fetchedAt: "2026-08-30T03:00:00.000Z",
  });

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, "Portable AI release");
  assert.equal(items[0]?.content, "A cross-platform collector shipped.");
  assert.equal(items[0]?.published_at, "2026-08-30T02:00:00.000Z");
  assert.equal(items[0]?.metadata?.collector, "portable-typescript");
});

test("portable collector parses Atom alternate links and preserves the source boundary", () => {
  const items = parsePortableFeed(`
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <id>tag:example.com,2026:2</id>
        <title>Atom entry</title>
        <link rel="alternate" href="/posts/2" />
        <updated>2026-08-30T04:00:00Z</updated>
        <summary>Short summary</summary>
      </entry>
    </feed>
  `, {
    feedUrl: source.url!,
    feedName: source.name,
    sourceId: source.id,
    sourceRole: "official",
    category: source.category,
    fetchedAt: "2026-08-30T05:00:00.000Z",
  });

  assert.equal(items[0]?.url, "https://example.com/posts/2");
  assert.equal(items[0]?.content, "Short summary");
  assert.equal(items[0]?.metadata?.source_id, source.id);
});

test("portable collector parses a publisher sitemap as an incremental official index", () => {
  const items = parsePortableFeed(`
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url>
        <loc>https://www.anthropic.com/claude-fable-and-mythos-5-1</loc>
        <lastmod>2026-09-01T17:53:53Z</lastmod>
      </url>
      <url>
        <loc>https://www.anthropic.com/older-page</loc>
        <lastmod>2026-08-10</lastmod>
      </url>
    </urlset>
  `, {
    feedUrl: "https://www.anthropic.com/sitemap.xml",
    feedName: "Anthropic",
    sourceId: "anthropic-official",
    sourceRole: "official",
    category: "ai-official",
    fetchedAt: "2026-09-02T00:00:00.000Z",
  });

  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, "claude fable and mythos 5 1");
  assert.equal(items[0]?.url, "https://www.anthropic.com/claude-fable-and-mythos-5-1");
  assert.equal(items[0]?.published_at, "2026-09-01T17:53:53.000Z");
  assert.equal(items[0]?.metadata?.source_format, "sitemap");
});

test("portable collector does not treat a shared sitemap batch timestamp as each page's publication time", () => {
  const sharedLastmod = "2026-09-03T13:48:35.764Z";
  const batchedUrls = Array.from({ length: 10 }, (_, index) => `
    <url>
      <loc>https://www.anthropic.com/site-page-${index + 1}</loc>
      <lastmod>${sharedLastmod}</lastmod>
    </url>
  `).join("");
  const items = parsePortableFeed(`
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${batchedUrls}
      <url>
        <loc>https://www.anthropic.com/news/real-release</loc>
        <lastmod>2026-09-03T12:00:00Z</lastmod>
      </url>
    </urlset>
  `, {
    feedUrl: "https://www.anthropic.com/sitemap.xml",
    feedName: "Anthropic",
    sourceId: "anthropic-official",
    sourceRole: "official",
    category: "ai-official",
    fetchedAt: "2026-09-03T14:00:00.000Z",
  });

  const batched = items.filter((item) => item.url.includes("/site-page-"));
  const release = items.find((item) => item.url.endsWith("/news/real-release"));

  assert.equal(batched.length, 10);
  assert.ok(batched.every((item) => item.published_at === undefined));
  assert.ok(batched.every((item) => item.metadata?.sitemap_lastmod_status === "shared-batch"));
  assert.equal(release?.published_at, "2026-09-03T12:00:00.000Z");
  assert.equal(release?.metadata?.sitemap_lastmod_status, "declared");
});

test("portable collector keeps leading shared-batch sitemap pages inside the bounded discovery set", () => {
  const sharedLastmod = "2026-09-04T12:30:45.046Z";
  const leadingBatch = Array.from({ length: 20 }, (_, index) => `
    <url>
      <loc>${index === 10
        ? "https://www.anthropic.com/claude-fable-and-mythos-5-1"
        : `https://www.anthropic.com/shared-page-${index + 1}`}</loc>
      <lastmod>${sharedLastmod}</lastmod>
    </url>
  `).join("");
  const individuallyDated = Array.from({ length: 120 }, (_, index) => `
    <url>
      <loc>https://www.anthropic.com/dated-page-${index + 1}</loc>
      <lastmod>2026-08-${String(31 - (index % 28)).padStart(2, "0")}T12:00:00Z</lastmod>
    </url>
  `).join("");

  const items = parsePortableFeed(`
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      ${leadingBatch}
      ${individuallyDated}
    </urlset>
  `, {
    feedUrl: "https://www.anthropic.com/sitemap.xml",
    feedName: "Anthropic",
    sourceId: "anthropic-official",
    sourceRole: "official",
    category: "ai-official",
    fetchedAt: "2026-09-04T13:00:00.000Z",
  });

  const launch = items.find((item) => item.url.endsWith("/claude-fable-and-mythos-5-1"));
  assert.equal(items.length, 100);
  assert.ok(launch, "a newly listed first-party launch must not be pushed out by older declared dates");
  assert.equal(launch.published_at, undefined);
  assert.equal(launch.metadata?.sitemap_lastmod_status, "shared-batch");
});

test("official sitemap resolves a matching discovery link without inventing a publication date", async () => {
  const official: SourceConfig = { ...source, homepageUrl: "https://openai.com", routes: [
    { topicId: "ai", label: "Sitemap", homepageUrl: "https://openai.com", url: "https://openai.com/sitemap.xml" },
    { topicId: "ai", label: "Search", homepageUrl: "https://openai.com", query: "site:openai.com GPT" },
  ] };
  const result = await collectPortableStructuredSources([official], { topicIds: ["ai"] }, {
    fetcher: async (url) => new Response(String(url).includes("sitemap")
      ? '<urlset><url><loc>https://openai.com/index/gpt-6-astra/</loc></url><url><loc>https://evil.example/gpt-6-astra/</loc></url></urlset>'
      : '<rss><channel><item><title>GPT-6 Astra: A new generation of intelligence - OpenAI</title><link>https://news.google.com/rss/articles/release</link><pubDate>Thu, 03 Sep 2026 18:00:00 GMT</pubDate></item><item><title>Legora reviewed 41 documents in minutes with GPT-6 Astra - OpenAI</title><link>https://news.google.com/rss/articles/case</link></item></channel></rss>'),
  });
  const launch = result.items.find((item) => item.url.endsWith("/release"));
  assert.equal(launch?.metadata?.canonical_url, "https://openai.com/index/gpt-6-astra/");
  assert.equal(launch?.url, "https://news.google.com/rss/articles/release");
  assert.equal(launch?.published_at, "2026-09-03T18:00:00.000Z");
  assert.equal(result.items.find((item) => item.url.endsWith("/case"))?.metadata?.canonical_url, undefined);
});

test("one unavailable portable source is reported without discarding a healthy source", async () => {
  const unavailable = { ...source, id: "unavailable", name: "Unavailable", url: "https://unavailable.example/feed" };
  const result = await collectPortableStructuredSources([source, unavailable], {
    topicIds: ["ai"],
  }, {
    now: () => new Date("2026-08-30T06:00:00.000Z"),
    fetcher: async (url) => String(url).includes("unavailable.example")
      ? new Response("down", { status: 503 })
      : new Response("<rss><channel><item><title>Healthy</title><link>https://example.com/healthy</link></item></channel></rss>", {
        status: 200,
        headers: { "content-type": "application/rss+xml" },
      }),
  });

  assert.equal(result.items.length, 1);
  assert.match(result.failures.unavailable ?? "", /503/);
  assert.equal(result.failures[source.id], undefined);
});

test("portable collector bounds simultaneous source fetches", async () => {
  const sources = Array.from({ length: 8 }, (_, index) => ({
    ...source,
    id: `feed-${index}`,
    name: `Feed ${index}`,
    url: `https://example.com/feed-${index}.xml`,
  }));
  let active = 0;
  let maximumActive = 0;
  await collectPortableStructuredSources(sources, { topicIds: ["ai"] }, {
    fetcher: async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return new Response("<rss><channel></channel></rss>", { status: 200 });
    },
  });

  assert.ok(maximumActive <= 4, `expected at most four simultaneous sources, saw ${maximumActive}`);
});

test("Hacker News Ask/Show posts preserve the original self text as source material", async () => {
  const hackerNewsSource: SourceConfig = {
    ...source,
    id: "hackernews",
    name: "Hacker News",
    kind: "hackernews",
    url: "https://news.ycombinator.com",
    role: "community",
  };
  const result = await collectPortableStructuredSources([hackerNewsSource], { topicIds: ["ai"] }, {
    now: () => new Date("2026-09-01T03:00:00.000Z"),
    fetcher: async (url) => String(url).includes("topstories.json")
      ? new Response(JSON.stringify([42]), { status: 200 })
      : new Response(JSON.stringify({
          id: 42,
          type: "story",
          by: "builder",
          title: "Show HN: A detailed launch note",
          text: "<p>I built this after testing three approaches.</p><p>The important tradeoff is latency.</p>",
          score: 20,
          descendants: 8,
          time: 1_788_236_400,
        }), { status: 200 }),
  });

  assert.equal(result.items.length, 1);
  assert.equal(result.items[0]?.content, "I built this after testing three approaches. The important tradeoff is latency.");
  assert.equal(result.items[0]?.url, "https://news.ycombinator.com/item?id=42");
});
