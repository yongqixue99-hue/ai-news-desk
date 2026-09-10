import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateScore,
  rawItemMatchesSearch,
  rawItemToCandidate,
  sortCandidates,
  titleSimilarity,
} from "./scoring.js";
import type { CandidateFeedback, RawHorizonItem } from "./types.js";

const item = (overrides: Partial<RawHorizonItem> = {}): RawHorizonItem => ({
  id: "rss:test:1",
  source_type: "rss",
  title: "OpenAI announces a new reasoning model and API release",
  url: "https://example.com/story",
  content: "The model launch changes pricing and developer access.",
  author: "OpenAI 官方",
  published_at: new Date(Date.now() - 60 * 60_000).toISOString(),
  fetched_at: new Date().toISOString(),
  metadata: { feed_name: "OpenAI 官方" },
  ...overrides,
});

test("official, timely AI announcements clear the editorial threshold", () => {
  const score = candidateScore(item(), "OpenAI 官方", 24);
  assert.ok(score.total >= 10);
  assert.equal(score.evidence, "一手来源");
  assert.equal(score.breakdown.relevance, 2);
});

test("an official versioned model release outranks a newer official event listing", () => {
  const modelRelease = rawItemToCandidate(item({
    id: "rss:anthropic:model-release",
    title: "Introducing Claude Fable 5.1 and Claude Mythos 5.1 - Anthropic",
    url: "https://www.anthropic.com/news/claude-fable-5-1",
    content: "Anthropic introduces Claude Fable 5.1 with updated model access and pricing.",
    published_at: new Date(Date.now() - 30 * 60 * 60_000).toISOString(),
    metadata: { feed_name: "Anthropic", source_role: "official" },
  }), 48, ["ai"]);
  const eventListing = rawItemToCandidate(item({
    id: "rss:anthropic:workshop",
    title: "Virtual Claude Code Workshop - Anthropic",
    url: "https://www.anthropic.com/events/virtual-claude-code-workshop",
    content: "Register for a virtual Claude Code workshop.",
    published_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    metadata: { feed_name: "Anthropic", source_role: "official" },
  }), 48, ["ai"]);

  const ranked = sortCandidates([eventListing, modelRelease]);

  assert.equal(ranked[0]?.id, modelRelease.id);
  assert.ok(modelRelease.score > eventListing.score);
  assert.equal(eventListing.scoreBreakdown.penalty, 2);
});

test("rumor-only wording receives a penalty", () => {
  const confirmed = candidateScore(item(), "BBC Technology", 24);
  const rumor = candidateScore(
    item({ title: "Anonymous sources reportedly say OpenAI may launch a model" }),
    "BBC Technology",
    24,
  );
  assert.equal(rumor.breakdown.penalty, 2);
  assert.ok(rumor.total < confirmed.total);
});

test("candidate mapping preserves provenance and sorting keeps high-value items first", () => {
  const high = rawItemToCandidate(item(), 24);
  const low = rawItemToCandidate(
    item({
      id: "rss:test:2",
      url: "https://example.com/other",
      title: "A general opinion column",
      content: "No new event.",
      author: "Unknown",
      metadata: { feed_name: "Unknown" },
    }),
    24,
  );
  const sorted = sortCandidates([low, high]);
  assert.equal(sorted[0].id, high.id);
  assert.equal(high.rawId, "rss:test:1");
  assert.equal(high.sourceName, "OpenAI 官方");
});

test("candidate mapping keeps an adapter-provided canonical URL for cross-source Story deduplication", () => {
  const candidate = rawItemToCandidate(item({
    id: "x:200",
    source_type: "x",
    url: "https://x.com/OpenAI/status/200",
    metadata: {
      feed_name: "AI 官方账号（X）",
      source_role: "official",
      canonical_url: "https://openai.com/index/model-x",
    },
  }), 24);

  assert.equal(candidate.canonicalUrl, "https://openai.com/index/model-x");
});

test("topic selection changes relevance instead of forcing every run through AI keywords", () => {
  const gamingItem = item({
    title: "Nintendo announces a new game and Switch release date",
    content: "The gaming launch arrives on Steam and consoles this fall.",
    author: "BBC",
    metadata: { feed_name: "BBC" },
  });
  assert.equal(candidateScore(gamingItem, "BBC", 24, ["gaming"]).breakdown.relevance, 2);
  assert.equal(candidateScore(gamingItem, "BBC", 24, ["ai"]).breakdown.relevance, 0);
});

test("multiple selected topics accept a story matching any chosen direction", () => {
  const politicsItem = item({
    title: "Parliament announces a new election policy",
    content: "The government and opposition will debate the law next week.",
  });
  const candidate = rawItemToCandidate(politicsItem, 24, ["science", "politics"]);
  assert.ok(candidate.scoreBreakdown.relevance > 0);
  assert.equal(sortCandidates([candidate]).length, 1);
});

test("short ASCII topic keywords only match complete words", () => {
  const unrelated = item({
    title: "World train map adds twelve railway routes",
    content: "The timetable is now available for passengers.",
  });
  assert.equal(candidateScore(unrelated, "Unknown", 24, ["ai"]).breakdown.relevance, 0);
});

test("manual date and keyword filters are applied before editorial scoring", () => {
  const matching = item({
    title: "OpenAI announces a new API",
    published_at: "2026-08-10T08:00:00.000Z",
  });
  assert.equal(rawItemMatchesSearch(matching, {
    dateFrom: "2026-08-10",
    dateTo: "2026-08-10",
    keywords: "Anthropic，OpenAI",
  }), true);
  assert.equal(rawItemMatchesSearch(matching, {
    dateFrom: "2026-08-11",
    dateTo: "2026-08-11",
    keywords: "OpenAI",
  }), false);
  assert.equal(rawItemMatchesSearch(matching, { keywords: "Nintendo" }), false);
});

test("manual search treats compact, hyphenated, and spaced model versions as the same term", () => {
  const release = item({
    title: "OpenAI launches GPT-6 Astra",
    content: "The model is rolling out to paid users.",
  });

  const options = { windowHours: 24 };
  assert.equal(rawItemMatchesSearch(release, { keywords: "GPT6" }, options), true);
  assert.equal(rawItemMatchesSearch(release, { keywords: "GPT 6" }, options), true);
  assert.equal(rawItemMatchesSearch(release, { keywords: "GPT-6" }, options), true);
  assert.equal(rawItemMatchesSearch(release, { keywords: "GPT60" }, options), false);
});

test("automatic collection rejects stale, future, and undated records outside its configured window", () => {
  const currentTime = Date.parse("2026-08-31T12:00:00.000Z");
  const options = { windowHours: 24, now: currentTime };

  assert.equal(rawItemMatchesSearch(item({
    published_at: "2026-08-30T13:00:00.000Z",
  }), {}, options), true);
  assert.equal(rawItemMatchesSearch(item({
    published_at: "2026-08-30T11:00:00.000Z",
  }), {}, options), false);
  assert.equal(rawItemMatchesSearch(item({
    published_at: "2026-08-31T13:00:00.000Z",
  }), {}, options), false);
  assert.equal(rawItemMatchesSearch(item({
    published_at: undefined,
    fetched_at: "2026-08-31T11:30:00.000Z",
  }), {}, options), false);
});

test("an explicit historical search honors its calendar range instead of the automatic window", () => {
  const historical = item({
    published_at: "2026-06-15T08:00:00.000Z",
    fetched_at: "2026-08-31T11:30:00.000Z",
  });
  const currentTime = Date.parse("2026-08-31T12:00:00.000Z");

  assert.equal(rawItemMatchesSearch(historical, {
    dateFrom: "2026-06-15",
    dateTo: "2026-06-15",
  }, { windowHours: 24, now: currentTime }), true);
  assert.equal(rawItemMatchesSearch(historical, {
    dateFrom: "2026-06-16",
    dateTo: "2026-06-16",
  }, { windowHours: 24, now: currentTime }), false);
});

test("public Hacker News interaction is preserved as a real heat signal", () => {
  const candidate = rawItemToCandidate(item({
    source_type: "hackernews",
    author: "some-user",
    metadata: {
      score: 420,
      descendants: 180,
      discussion_url: "https://news.ycombinator.com/item?id=1",
    },
  }), 24);
  const [ranked] = sortCandidates([candidate]);
  assert.equal(ranked.sourceName, "Hacker News");
  assert.equal(ranked.engagement?.points, 420);
  assert.ok(ranked.heatBreakdown.engagement > 0);
});

test("a single-source article without public interaction gets no invented heat", () => {
  const candidate = rawItemToCandidate(item({
    metadata: { feed_name: "OpenAI 官方" },
  }), 24);
  const [ranked] = sortCandidates([candidate]);
  assert.equal(ranked.engagement, undefined);
  assert.equal(ranked.relatedSources.length, 1);
  assert.equal(ranked.heatScore, 0);
  assert.deepEqual(ranked.heatBreakdown, {
    engagement: 0,
    sourceReach: 0,
    crossSource: 0,
    freshness: 0,
  });
});

test("publisher suffix variants collapse into one story while preserving cluster evidence", () => {
  const india = rawItemToCandidate(item({
    id: "rss:ign:india",
    title: "The Elder Scrolls 4: Oblivion Remastered - Official Nintendo Switch 2 Launch Trailer - IGN India",
    url: "https://example.com/india",
    author: "IGN",
    metadata: { feed_name: "IGN" },
  }), 24, ["gaming"]);
  const global = rawItemToCandidate(item({
    id: "rss:ign:global",
    title: "The Elder Scrolls 4: Oblivion Remastered - Official Nintendo Switch 2 Launch Trailer - IGN",
    url: "https://example.com/global",
    author: "IGN",
    metadata: { feed_name: "IGN" },
  }), 24, ["gaming"]);
  assert.equal(titleSimilarity(india.title, global.title), 1);
  const ranked = sortCandidates([india, global]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].clusterSize, 2);
});

test("candidate sorting applies the bounded editorial preference as a separate signal", () => {
  const candidate = rawItemToCandidate(item(), 24, ["ai"]);
  const history: CandidateFeedback[] = [{
    id: "feedback-published",
    candidateId: "older-candidate",
    runId: "older-run",
    kind: "published",
    title: "OpenAI reasoning API",
    sourceName: candidate.sourceName,
    topicIds: ["ai"],
    keywords: ["openai", "reasoning"],
    createdAt: "2026-08-12T10:00:00.000Z",
  }];

  const [ranked] = sortCandidates([candidate], history, true);
  assert.ok(ranked.personalizationScore > 0);
  assert.ok(ranked.personalizationReasons.length > 0);
});

test("global news ranking does not reuse uncalibrated community point totals",()=>{
 const candidate=rawItemToCandidate(item({source_type:"hackernews",metadata:{score:9000,descendants:300,discussion_url:"https://news.ycombinator.com/item?id=1"}}),24);
 const [observed]=sortCandidates([candidate]);const [unknown]=sortCandidates([{...candidate,engagement:undefined}]);
 assert.equal(observed.recommendationScore,unknown.recommendationScore);
});
