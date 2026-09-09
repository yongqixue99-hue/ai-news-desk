import assert from "node:assert/strict";
import test from "node:test";
import { defaultSources } from "./defaults.js";
import {
  buildDiscoveryQuery,
  eligibleSourcesForTopics,
  dynamicTopicQuery,
  routedFeedsForSource,
  sourceRoleFor,
  sourceSupportsTopics,
} from "./source-routing.js";

test("Gemini and Qwen retain a first-party route when Google News is unreachable", () => {
  for (const topic of ["ai", "technology"] as const) {
    const gemini = defaultSources.find((source) => source.id === "gemini-official")!;
    assert.ok(routedFeedsForSource(gemini, [topic]).some((feed) => feed.url === "https://blog.google/products-and-platforms/products/gemini/rss/"));
  }
  const qwen = defaultSources.find((source) => source.id === "qwen-official")!;
  assert.ok(routedFeedsForSource(qwen, ["ai"]).some((feed) => feed.format === "qwen-json" && new URL(feed.url).hostname === "qwen.ai"));
  const deepseek = defaultSources.find((source) => source.id === "deepseek-official")!;
  assert.equal(routedFeedsForSource(deepseek, ["ai"])[0]?.format, "deepseek-updates");
  assert.ok(routedFeedsForSource(defaultSources.find((source) => source.id === "gemini-official")!, ["ai"])
    .some((feed) => feed.format === "gemini-changelog"));
});

test("model-version discovery expands compact search terms without requiring exact punctuation", () => {
  const compact = buildDiscoveryQuery("artificial intelligence", { keywords: "GPT6" });
  const hyphenated = buildDiscoveryQuery("artificial intelligence", { keywords: "GPT-6" });

  for (const query of [compact, hyphenated]) {
    assert.match(query, /GPT6/u);
    assert.match(query, /"GPT-6"/u);
    assert.match(query, /"GPT 6"/u);
  }
});

test("comprehensive discovery queries cover both English and Chinese terms", () => {
  const query = dynamicTopicQuery(["ai"]);
  assert.match(query, /artificial intelligence/);
  assert.match(query, /人工智能/);
  assert.match(query, /大模型/);
});

test("Google News comprehensive search is routed through the proven RSS collector", () => {
  const source = defaultSources.find((entry) => entry.id === "google-news-ai");
  assert.ok(source);
  const feeds = routedFeedsForSource(source, ["science"], { keywords: "量子计算" });
  assert.equal(feeds.length, 1);
  assert.match(feeds[0].url, /^https:\/\/news\.google\.com\/rss\/search\?/);
  const query = new URL(feeds[0].url).searchParams.get("q") ?? "";
  assert.match(query, /science/);
  assert.match(query, /科学/);
  assert.match(query, /量子计算/);
  assert.doesNotMatch(query, /OpenAI OR Anthropic/);
});

test("a collection only admits enabled sources that support its selected topics", () => {
  const sources = [
    defaultSources.find((source) => source.id === "openai-official"),
    defaultSources.find((source) => source.id === "lpl-official"),
    defaultSources.find((source) => source.id === "reuters-ai"),
  ];
  assert.ok(sources.every(Boolean));

  const eligible = eligibleSourcesForTopics(sources, ["ai"]);

  assert.deepEqual(eligible.map((source) => source.id), ["openai-official", "reuters-ai"]);
});

test("legacy and user-added sources receive a stable editorial classification", () => {
  const official = defaultSources.find((source) => source.id === "openai-official");
  const community = defaultSources.find((source) => source.id === "zhihu-community");
  const hackerNews = defaultSources.find((source) => source.id === "hackernews");
  assert.ok(official);
  assert.ok(community);
  assert.ok(hackerNews);
  assert.equal(sourceRoleFor(official), "official");
  assert.equal(sourceRoleFor(community), "community");
  assert.equal(sourceRoleFor(hackerNews), "community");
  assert.equal(sourceRoleFor({ ...official, role: undefined, discoveryOnly: true }), "discovery");
  assert.equal(sourceRoleFor({ ...official, id: "custom-science", role: undefined, category: "science" }), "research");
});

test("a parent news site routes each channel to its configured submodule", () => {
  const bbc = defaultSources.find((source) => source.id === "bbc-technology");
  assert.ok(bbc);
  assert.equal(bbc.name, "BBC");
  assert.equal(bbc.homepageUrl, "https://www.bbc.com/");
  const politicsFeeds = routedFeedsForSource(bbc, ["politics"]);
  assert.equal(politicsFeeds.length, 1);
  assert.equal(politicsFeeds[0].url, "https://feeds.bbci.co.uk/news/politics/rss.xml");
  assert.equal(sourceSupportsTopics(bbc, ["gaming"]), false);
});

test("site-scoped discovery routes include manual keywords and inclusive date range", () => {
  const reuters = defaultSources.find((source) => source.id === "reuters-ai");
  assert.ok(reuters);
  const feeds = routedFeedsForSource(reuters, ["ai"], {
    dateFrom: "2026-08-01",
    dateTo: "2026-08-11",
    keywords: "OpenAI, Anthropic",
  });
  assert.equal(feeds.length, 1);
  const query = new URL(feeds[0].url).searchParams.get("q") ?? "";
  assert.match(query, /site:reuters\.com\/technology\/artificial-intelligence/);
  assert.match(query, /OpenAI OR Anthropic/);
  assert.match(query, /after:2026-08-01/);
  assert.match(query, /before:2026-08-12/);
});

test("Anthropic official discovery covers root announcements through sitemap and broad site search", () => {
  const anthropic = defaultSources.find((source) => source.id === "anthropic-official");
  assert.ok(anthropic);

  const feeds = routedFeedsForSource(anthropic, ["ai"]);

  assert.equal(anthropic.discoveryOnly, false);
  assert.ok(feeds.some((feed) => feed.url === "https://www.anthropic.com/sitemap.xml"));
  const searchFeed = feeds.find((feed) => feed.url.includes("news.google.com/rss/search"));
  assert.ok(searchFeed);
  const query = new URL(searchFeed.url).searchParams.get("q") ?? "";
  assert.match(query, /site:anthropic\.com/u);
  assert.doesNotMatch(query, /site:anthropic\.com\/news/u);
});

test("esports sources cover LoL China and Korea, Dota 2 and Counter-Strike with visible notes", () => {
  const expected = [
    ["lpl-official", "英雄联盟 · LPL 国服"],
    ["lolesports-official", "英雄联盟 · LCK 韩服"],
    ["dota2-official", "DOTA2 · 全球赛事"],
    ["dota2-cn-official", "DOTA2 · 国服赛事"],
    ["counter-strike-official", "CS2 · 全球赛事"],
    ["cs2-cn-official", "CS2 · 国服赛事"],
    ["hltv", "CS2 · 专业赛事媒体"],
    ["inven-global-lol", "英雄联盟 · LCK 韩服媒体"],
  ] as const;
  for (const [sourceId, note] of expected) {
    const source = defaultSources.find((entry) => entry.id === sourceId);
    assert.ok(source, `${sourceId} should exist`);
    assert.ok(source.topicIds?.includes("esports"));
    assert.match(source.note ?? "", new RegExp(note.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(routedFeedsForSource(source, ["esports"]).length, 1);
  }
  assert.equal(
    routedFeedsForSource(defaultSources.find((entry) => entry.id === "dota2-official")!, ["esports"])[0]?.url,
    "https://store.steampowered.com/feeds/news/app/570/?cc=US&l=english",
  );
  assert.equal(
    routedFeedsForSource(defaultSources.find((entry) => entry.id === "counter-strike-official")!, ["esports"])[0]?.url,
    "https://store.steampowered.com/feeds/news/app/730/?cc=US&l=english",
  );
  for (const sourceId of ["lpl-official", "lolesports-official", "dota2-official", "counter-strike-official"]) {
    assert.equal(defaultSources.find((entry) => entry.id === sourceId)?.selected, true);
  }
});
