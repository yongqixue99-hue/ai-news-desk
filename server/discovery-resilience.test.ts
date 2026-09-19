import assert from "node:assert/strict";
import test from "node:test";
import { defaultSources } from "./defaults.js";
import { collectPortableStructuredSources, parsePortableFeed } from "./structured-collector.js";
import { collectDiscoveryCandidates } from "./discovery-funnel.js";
import { collectionCoverageWarning, sourceResultsForRun } from "./source-health.js";

const source = { ...defaultSources.find((entry) => entry.id === "google-news-ai")!,
  query: "(artificial intelligence OR AI) (OpenAI OR Anthropic OR Google DeepMind OR Microsoft OR Meta OR Nvidia)" };
const now = () => new Date("2026-09-18T04:40:00Z");
// Minimal captured shape of Bing's Jev result; text is a synthetic regression fixture.
const publisher = "https://www.heise.de/en/news/AI-model-Jev-to-make-machines-decide-faster-11457071.html";
const feed = (target = publisher) => `<rss version="2.0"><channel><item><title>AI model Jev makes structured decisions</title><link>https://www.bing.com/news/apiclick.aspx?url=${encodeURIComponent(target)}</link><description>TypeSafe AI introduces a decision model.</description><pubDate>Thu, 17 Sep 2026 09:21:00 GMT</pubDate></item></channel></rss>`;

for (const keywords of ["jev", "新AI模型「Jev」"]) {
  test(`unknown-model search survives Google outage: ${keywords}`, async () => {
    const collected = await collectPortableStructuredSources([source], {
      topicIds: ["ai"], filters: { keywords, dateFrom: "2026-09-17", dateTo: "2026-09-18" },
    }, { now, fetcher: async (url) => {
      if (new URL(url).hostname === "news.google.com") throw new Error("simulated search outage");
      assert.equal(new URL(url).hostname, "www.bing.com");
      assert.match(new URL(url).searchParams.get("q") ?? "", /jev/i);
      assert.doesNotMatch(new URL(url).searchParams.get("q") ?? "", /OpenAI|Anthropic/);
      return new Response(feed());
    } });
    const result = collectDiscoveryCandidates(collected.items, {
      windowHours: 48, topicIds: ["ai"], now: now().getTime(), sources: [source],
      filters: { keywords, dateFrom: "2026-09-17", dateTo: "2026-09-18" },
    });
    assert.equal(result.candidates.length, 1, "publisher result must survive the actual discovery funnel");
    assert.equal(result.candidates[0].url, publisher);
    assert.equal(result.candidates[0].sourceRole, "discovery");
    assert.equal(collected.items[0].metadata?.date_basis, "news-index");
    assert.ok(collected.routeResults.some((route) => route.status === "error"));
    assert.ok(collected.routeResults.some((route) => route.status === "success"));
    assert.equal(collected.failures[source.id], undefined);
  });
}

test("news search retains strict user dates and never turns fetch time into publication time", () => {
  const items = parsePortableFeed(feed(), { feedUrl: "https://www.bing.com/news/search?q=Jev&format=rss", feedName: source.name, sourceId: source.id, sourceRole: "discovery", category: source.category, fetchedAt: now().toISOString() });
  const result = collectDiscoveryCandidates(items, { windowHours: 48, topicIds: ["ai"], now: now().getTime(), filters: { dateFrom: "2026-09-18", dateTo: "2026-09-18", keywords: "jev" } });
  assert.equal(result.candidates.length, 0);
  assert.equal(items[0].published_at, "2026-09-17T09:21:00.000Z");
});

test("failed discovery is distinguishable from a successful empty search", () => {
  const failed = sourceResultsForRun([source], [], [], { [source.id]: "network unavailable" });
  assert.match(collectionCoverageWarning({ sourceResults: failed }) ?? "", /不能据此判断没有相关新闻/);
  assert.equal(collectionCoverageWarning({ sourceResults: sourceResultsForRun([source], [], []) }), undefined);
});

test("Bing wrappers cannot introduce credentials, private URLs or non-web protocols", () => {
  for (const target of ["http://127.0.0.1/private", "http://localhost/private", "http://[::1]/private", "https://user:password@example.com/article", "file:///etc/passwd", "javascript:alert(1)"]) {
    assert.equal(parsePortableFeed(feed(target), { feedUrl: "https://www.bing.com/news/search?q=Jev&format=rss", feedName: source.name, sourceId: source.id, sourceRole: "discovery", category: source.category, fetchedAt: now().toISOString() }).length, 0);
  }
});
