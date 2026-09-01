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
