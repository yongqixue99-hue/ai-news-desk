import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { defaultSources } from "./defaults.js";
import { createSourceRouteReader } from "./source-route-cache.js";
import { collectPortableStructuredSources, parsePortableFeed, resolveOfficialFeedLinks } from "./structured-collector.js";
import type { SourceConfig } from "./types.js";
import { collectDiscoveryCandidates } from "./discovery-funnel.js";
import { buildTodayView } from "./story-desk.js";
import { createDefaultState } from "./defaults.js";
import { extractOfficialUpdateSection } from "./official-update-index.js";
import { rawItemToCandidate } from "./scoring.js";

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

const claudeFeed = `<rss><channel><item>
  <title>Claude Platform release notes — September 3, 2026</title>
  <link>https://platform.claude.com/docs/en/release-notes/overview#september-3-2026</link>
  <pubDate>Thu, 03 Sep 2026 00:00:00 GMT</pubDate><description>CLI maintenance update.</description>
  </item><item><title>Claude Platform release notes — September 1, 2026</title>
  <link>https://platform.claude.com/docs/en/release-notes/overview#september-1-2026</link>
  <pubDate>Tue, 01 Sep 2026 00:00:00 GMT</pubDate>
  <description><![CDATA[<ul><li>We've launched <strong>Claude Fable 5.1</strong> (<code>claude-fable-5-1</code>).</li></ul>]]></description>
  </item></channel></rss>`;

test("Claude's real dated feed reaches Today on reconnect when sitemap and search fail", async () => {
  const anthropic = defaultSources.find((entry) => entry.id === "anthropic-official")!;
  const clock = "2026-09-07T12:00:00.000Z";
  const result = await collectPortableStructuredSources([anthropic], { topicIds: ["ai"] }, {
    now: () => new Date(clock),
    fetcher: async (url) => String(url) === "https://platform.claude.com/docs/en/release-notes/feed.xml"
      ? new Response(claudeFeed) : new Response(null, { status: 503 }),
  });
  const { candidates } = collectDiscoveryCandidates(result.items, { windowHours: 48, topicIds: ["ai"], now: Date.parse(clock) });
  const release = candidates.find((entry) => entry.title.includes("Fable 5.1"));
  assert.ok(release, "the dated launch must be discovered without sitemap dates or an AI rewrite");
  assert.equal(release.publishedAt, "2026-09-01T00:00:00.000Z");
  assert.equal(release.technicalArticle, undefined);
  assert.equal(release.publicationEvidence?.precision, "day");
  assert.equal(release.publicationEvidence?.originalFeedTitle, "Claude Platform release notes — September 1, 2026");
  const state = createDefaultState();
  state.runs = [{ id: "reconnect", createdAt: clock, updatedAt: clock, status: "ready", stage: "完成", windowHours: 48,
    sourceIds: [anthropic.id], scheduled: false, rawCount: result.items.length, candidates, logs: [] }];
  const view = buildTodayView(state, clock);
  assert.ok(view.releaseHighlights?.some((story) => story.originalTitle.includes("Fable 5.1")));
  assert.equal(result.failures[anthropic.id], undefined);
});

test("Claude date links freeze only that day's evidence, excluding neighbouring changes", () => {
  const html = `<main><article id="content-container"><div class="docs-prose">
    <h3 id="september-3-2026">September 3, 2026<button>Copy</button></h3><ul><li>Unrelated CLI update.</li></ul>
    <h3 id="september-1-2026">September 1, 2026<button>Copy</button></h3><ul><li>We've launched Claude Fable 5.1.</li></ul>
    <h3 id="august-27-2026">August 27, 2026</h3><p>Unrelated account change.</p>
    </div></article></main>`;
  const section = extractOfficialUpdateSection(html, "https://platform.claude.com/docs/en/release-notes/overview#september-1-2026");
  assert.equal(section?.publishedAt, "2026-09-01T00:00:00.000Z");
  assert.match(section!.html, /Fable 5.1/u);
  assert.doesNotMatch(section!.html, /Unrelated/u);
});

test("official RSS publication wins over the same announcement's later search-index date", () => {
  const openai = defaultSources.find((entry) => entry.id === "openai-official")!;
  const parse = (feedUrl: string, link: string, date: string) => parsePortableFeed(
    `<rss><channel><item><title>GPT-6 Astra: A new generation of intelligence - OpenAI</title><link>${link}</link><pubDate>${date}</pubDate></item></channel></rss>`,
    { feedUrl, feedName: openai.name, sourceId: openai.id, sourceRole: "official", category: openai.category, fetchedAt: "2026-09-08T12:00:00Z" },
  )[0];
  const original = parse("https://openai.com/news/rss.xml", "https://openai.com/index/gpt-6-astra", "Thu, 03 Sep 2026 11:00:00 GMT");
  const indexed = parse("https://news.google.com/rss/search?q=OpenAI", "https://news.google.com/rss/articles/index-copy?oc=5", "Tue, 08 Sep 2026 09:00:00 GMT");
  const resolved = resolveOfficialFeedLinks([original, indexed], openai)[1];
  assert.equal(resolved.published_at, original.published_at);
  assert.equal(resolved.metadata?.indexed_at, indexed.published_at);
  assert.equal(resolved.metadata?.date_source_url, original.url);
  const candidate = rawItemToCandidate(resolved, 48, ["ai"], Date.parse("2026-09-08T12:00:00Z"));
  assert.equal(candidate.publicationEvidence?.indexedAt, "2026-09-08T09:00:00.000Z");
  assert.equal(candidate.publicationEvidence?.sourceUrl, original.url);
  assert.equal(indexed.published_at, "2026-09-08T09:00:00.000Z");
});

test("conflicting original publication records cannot silently overwrite the index date", () => {
  const openai = defaultSources.find((entry) => entry.id === "openai-official")!;
  const original = { id: "one", source_type: "rss", title: "GPT-6 Astra: A new generation of intelligence",
    url: "https://openai.com/index/gpt-6-astra", published_at: "2026-09-03T11:00:00Z", metadata: { date_basis: "feed-published" } };
  const index = { ...original, id: "index", url: "https://news.google.com/rss/articles/indexed", published_at: "2026-09-08T00:00:00Z", metadata: { date_basis: "news-index" } };
  const result = resolveOfficialFeedLinks([original, { ...original, id: "conflict", published_at: "2026-09-04T11:00:00Z" }, index], openai)[2];
  assert.equal(result.published_at, index.published_at);
  assert.equal(result.metadata?.indexed_at, undefined);
});

test("an invalid publication claim cannot borrow a valid modification time", () => {
  const [entry] = parsePortableFeed('<feed><entry><title>Introducing a model</title><link href="https://example.com/model"/><published>not-a-date</published><updated>2026-09-08T12:00:00Z</updated></entry></feed>', {
    feedUrl: "https://example.com/feed", feedName: "Example", sourceId: "example", sourceRole: "official", category: "AI", fetchedAt: "2026-09-08T13:00:00Z",
  });
  assert.equal(entry.published_at, undefined);
  assert.equal(entry.metadata?.modified_at, "2026-09-08T12:00:00.000Z");
});

test("DeepSeek dated updates survive index failure and reuse a validated 304 without losing dates", async () => {
  const deepseek = defaultSources.find((entry) => entry.id === "deepseek-official")!;
  const content = await readFile(new URL("./fixtures/official-update-deepseek-updates.html", import.meta.url), "utf8");
  let reads = 0;
  const reader = createSourceRouteReader({ fetcher: async (url, init) => {
    if (url.includes("news.google.com")) return new Response(null, { status: 503, headers: { "retry-after": "300" } });
    reads += 1;
    if (reads === 2) {
      assert.equal(new Headers(init.headers).get("if-none-match"), '"dated"');
      return new Response(null, { status: 304 });
    }
    return new Response(content, { headers: { etag: '"dated"' } });
  } });
  const first = await collectPortableStructuredSources([deepseek], { topicIds: ["ai"] }, { routeReader: reader });
  const second = await collectPortableStructuredSources([deepseek], { topicIds: ["ai"] }, { routeReader: reader });
  assert.ok(first.items.length > 1);
  assert.deepEqual(second.items.map((item) => [item.url, item.published_at]), first.items.map((item) => [item.url, item.published_at]));
  assert.equal(second.routeResults[0]?.cacheStatus, "not-modified");
  assert.equal(second.routeResults[1]?.errorCode, "backoff");
  assert.ok(second.routeResults[1]?.retryAt);
  assert.deepEqual(second.failures, {});
});

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

test("a working feed cannot hide a failed discovery route for the same publisher", async () => {
  const publisher = { ...source, routes: [
    { topicId: "ai" as const, label: "Feed", homepageUrl: "https://example.com", url: "https://example.com/feed.xml" },
    { topicId: "ai" as const, label: "Index", homepageUrl: "https://example.com", url: "https://example.com/sitemap.xml" },
  ] };
  const result = await collectPortableStructuredSources([publisher], { topicIds: ["ai"] }, {
    fetcher: async (url) => new Response(String(url).includes("sitemap") ? "down"
      : "<rss><channel><item><title>Healthy</title><link>https://example.com/news</link></item></channel></rss>",
    { status: String(url).includes("sitemap") ? 503 : 200 }),
  });
  assert.equal(result.items.length, 1);
  assert.equal(result.failures[source.id], undefined);
  assert.deepEqual(result.routeResults?.map(({ status, rawCount }) => ({ status, rawCount })), [
    { status: "success", rawCount: 1 }, { status: "error", rawCount: 0 },
  ]);
  assert.match(result.routeResults?.[1]?.detail ?? "", /503/);
});

test("HTML challenges and unsupported sitemap indexes are errors, while an empty RSS feed is valid", async () => {
  for (const body of ["<html><body>Please verify you are human</body></html>", "<sitemapindex><sitemap><loc>https://example.com/child.xml</loc></sitemap></sitemapindex>"]) {
    const result = await collectPortableStructuredSources([source], { topicIds: ["ai"] }, { fetcher: async () => new Response(body) });
    assert.ok(result.failures[source.id], "a 200 response alone does not establish successful feed parsing");
  }
  const empty = await collectPortableStructuredSources([source], { topicIds: ["ai"] }, {
    fetcher: async () => new Response("<rss><channel></channel></rss>"),
  });
  assert.deepEqual(empty.failures, {});
});

test("passing a collection cancellation signal does not disable feed and HN request deadlines", async () => {
  const controller = new AbortController();
  const signals: AbortSignal[] = [];
  await collectPortableStructuredSources([source, { ...source, id: "hn", kind: "hackernews" }], {
    topicIds: ["ai"], signal: controller.signal,
  }, { fetcher: async (url, init) => {
    signals.push(init.signal!);
    if (String(url).includes("topstories")) return new Response("[42]");
    if (String(url).includes("item/42")) return new Response(JSON.stringify({ id: 42, title: "AI news", type: "story" }));
    return new Response("<rss><channel></channel></rss>");
  } });
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal !== controller.signal), "each request needs a deadline combined with cancellation");
  controller.abort();
  assert.ok(signals.every((signal) => signal.aborted));
});
