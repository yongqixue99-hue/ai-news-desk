import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createStoryEvidenceDesk } from "./story-evidence-desk.js";
import { buildStories, storyById } from "./story-desk.js";
import type { Candidate, RawHorizonItem, WorkflowRun, WorkflowState } from "./types.js";

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "official-1",
  rawId: "official-1",
  sourceType: "rss",
  sourceName: "Acme Official",
  sourceRole: "official",
  title: "Acme launches Model X with a public API",
  url: "https://acme.example/news/model-x",
  canonicalUrl: "https://acme.example/news/model-x",
  excerpt: "Acme launched Model X and opened its public API.",
  publishedAt: "2026-08-30T01:00:00.000Z",
  fetchedAt: "2026-08-30T01:05:00.000Z",
  score: 12,
  scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  clusterSize: 1,
  relatedSources: ["Acme Official"],
  evidence: "一手来源",
  briefing: {
    titleZh: "Acme 发布 Model X 并开放 API",
    summaryZh: "Acme 发布 Model X，并同步开放公共 API。",
    basis: "full-source",
    generatedAt: "2026-08-30T01:10:00.000Z",
    providerId: "test",
  },
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (entry: Candidate): WorkflowRun => ({
  id: "run-official",
  createdAt: "2026-08-30T01:05:00.000Z",
  updatedAt: "2026-08-30T01:05:00.000Z",
  completedAt: "2026-08-30T01:10:00.000Z",
  status: "ready",
  stage: "完成",
  windowHours: 24,
  topicIds: ["ai"],
  sourceIds: ["acme-official"],
  scheduled: false,
  rawCount: 1,
  candidates: [entry],
  logs: [],
});

test("evidence supplementation upgrades a matching official story with an independent source", async () => {
  let state: WorkflowState = createDefaultState();
  state.runs = [run(candidate())];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  assert.equal(story.evidenceStrength, "moderate");

  const matching: RawHorizonItem = {
    id: "reuters-model-x",
    source_type: "rss",
    title: "Acme launches Model X and opens public API",
    url: "https://reuters.example/technology/acme-model-x",
    content: "Reuters independently reported that Acme launched Model X with a public API.",
    published_at: "2026-08-30T01:20:00.000Z",
    fetched_at: "2026-08-30T02:00:00.000Z",
    metadata: { feed_name: "Reuters", source_role: "verification" },
  };
  const unrelated: RawHorizonItem = {
    id: "unrelated",
    source_type: "rss",
    title: "Another company reports quarterly earnings",
    url: "https://news.example/unrelated",
    published_at: "2026-08-30T01:20:00.000Z",
    fetched_at: "2026-08-30T02:00:00.000Z",
    metadata: { feed_name: "News Example", source_role: "verification" },
  };
  const desk = createStoryEvidenceDesk({
    readState: async () => state,
    updateState: async (mutate) => {
      const result = mutate(state);
      state = state;
      return result;
    },
    search: async () => ({ items: [matching, unrelated], failures: {}, searchedSourceCount: 2 }),
    now: () => new Date("2026-08-30T02:00:00.000Z"),
  });

  const result = await desk.supplement(story.id);
  const updated = storyById(state, story.id, "2026-08-30T02:00:00.000Z");

  assert.equal(result.previousStrength, "moderate");
  assert.equal(result.evidenceStrength, "strong");
  assert.equal(result.addedSourceCount, 1);
  assert.deepEqual(result.addedSources, ["Reuters"]);
  assert.equal(updated?.factSourceCount, 2);
  assert.deepEqual(updated?.signals.map((signal) => signal.sourceName).sort(), ["Acme Official", "Reuters"]);
});

test("evidence supplementation matches reordered Chinese news titles", async () => {
  let state: WorkflowState = createDefaultState();
  state.runs = [run(candidate({
    title: "索尼音乐起诉 AI 公司侵犯音乐版权",
    url: "https://sony.example/news/ai-copyright",
    canonicalUrl: "https://sony.example/news/ai-copyright",
    briefing: {
      titleZh: "索尼音乐起诉 AI 公司侵犯音乐版权",
      summaryZh: "索尼音乐针对训练数据中的音乐版权问题提起诉讼。",
      basis: "full-source",
      generatedAt: "2026-08-30T01:10:00.000Z",
      providerId: "test",
    },
  }))];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const desk = createStoryEvidenceDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    search: async () => ({
      items: [{
        id: "media-sony-lawsuit",
        source_type: "rss",
        title: "AI 公司因音乐版权问题遭索尼音乐提起诉讼",
        url: "https://media.example/sony-music-ai-lawsuit",
        content: "媒体独立报道了索尼音乐的诉讼。",
        published_at: "2026-08-30T01:30:00.000Z",
        fetched_at: "2026-08-30T02:00:00.000Z",
        metadata: { feed_name: "Independent Media", source_role: "verification" },
      }],
      failures: {},
      searchedSourceCount: 1,
    }),
    now: () => new Date("2026-08-30T02:00:00.000Z"),
  });

  const result = await desk.supplement(story.id);

  assert.equal(result.addedSourceCount, 1);
  assert.equal(result.evidenceStrength, "strong");
});

test("evidence supplementation attaches an official match to a community-discovered story", async () => {
  let state: WorkflowState = createDefaultState();
  state.runs = [run(candidate({
    id: "community-fable",
    rawId: "community-fable",
    sourceType: "hackernews",
    sourceName: "Hacker News",
    sourceRole: "community",
    title: "Claude Fable 5.1 and Claude Mythos 5.1",
    url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    canonicalUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    publishedAt: "2026-09-01T17:53:53.000Z",
    fetchedAt: "2026-09-01T18:00:00.000Z",
    briefing: {
      titleZh: "Claude Fable 5.1 与 Claude Mythos 5.1 发布",
      summaryZh: "目前由社区链接发现该发布页。",
      basis: "title",
      generatedAt: "2026-09-01T18:00:00.000Z",
      providerId: "test",
    },
    engagement: { points: 180, comments: 64, discussionUrl: "https://news.ycombinator.com/item?id=51" },
  }))];
  const story = buildStories(state, "2026-09-01T20:00:00.000Z")[0]!;
  assert.equal(story.factSourceCount, 0);

  const desk = createStoryEvidenceDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    search: async () => ({
      items: [{
        id: "aws-fable",
        source_type: "rss",
        title: "Introducing Claude Fable 5.1 on AWS",
        url: "https://aws.example/introducing-claude-fable-5-1",
        content: "AWS announced availability of Claude Fable 5.1.",
        published_at: "2026-09-01T19:12:43.000Z",
        fetched_at: "2026-09-01T19:20:00.000Z",
        metadata: { feed_name: "AWS Machine Learning", source_role: "official" },
      }],
      failures: {},
      searchedSourceCount: 1,
    }),
    now: () => new Date("2026-09-01T20:00:00.000Z"),
  });

  const result = await desk.supplement(story.id);
  const updated = storyById(state, story.id, "2026-09-01T20:00:00.000Z");

  assert.equal(result.addedSourceCount, 1);
  assert.equal(updated?.factSourceCount, 1);
  assert.equal(updated?.communitySourceCount, 1);
  assert.equal(updated?.signals.length, 2);
});

test("a strong model-release story can still fill a missing dossier facet from official docs", async () => {
  let state: WorkflowState = createDefaultState();
  const official = candidate({
    id: "fable-owner",
    rawId: "fable-owner",
    sourceName: "Anthropic",
    title: "Claude Fable 5.1 and Claude Mythos 5.1",
    url: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    canonicalUrl: "https://www.anthropic.com/claude-fable-and-mythos-5-1",
    excerpt: "Anthropic released Claude Fable 5.1 with a 1M context window and API model ID claude-fable-5-1.",
    publishedAt: "2026-09-01T13:00:00.000Z",
  });
  const verification = candidate({
    id: "fable-report",
    rawId: "fable-report",
    sourceName: "Independent Wire",
    sourceRole: "verification",
    title: "Anthropic releases Claude Fable 5.1",
    url: "https://wire.example/anthropic-fable-5-1",
    canonicalUrl: "https://wire.example/anthropic-fable-5-1",
    evidenceGroupUrl: official.url,
    evidenceRelation: "independent-report",
    publishedAt: "2026-09-01T13:30:00.000Z",
  });
  state.runs = [{ ...run(official), candidates: [official, verification], rawCount: 2 }];
  const story = buildStories(state, "2026-09-01T20:00:00.000Z")[0]!;
  assert.equal(story.evidenceStrength, "strong");
  assert.equal(story.releaseDossier?.facets.find((facet) => facet.id === "pricing")?.status, "missing");

  const desk = createStoryEvidenceDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    search: async () => ({
      items: [{
        id: "fable-price-docs",
        source_type: "rss",
        title: "API pricing",
        url: "https://platform.claude.com/docs/en/about-claude/pricing",
        content: "Claude Fable 5.1 costs $10 per million input tokens and $50 per million output tokens.",
        published_at: "2026-09-01T13:05:00.000Z",
        fetched_at: "2026-09-01T20:00:00.000Z",
        metadata: { feed_name: "Claude Platform Docs", source_role: "official" },
      }],
      failures: {},
      searchedSourceCount: 2,
    }),
    now: () => new Date("2026-09-01T20:00:00.000Z"),
  });

  const result = await desk.supplement(story.id);
  const updated = storyById(state, story.id, "2026-09-01T20:00:00.000Z");

  assert.equal(result.addedSourceCount, 1);
  assert.equal(updated?.releaseDossier?.facets.find((facet) => facet.id === "pricing")?.status, "ready");
  assert.ok(updated?.signals.some((signal) => signal.url.includes("/pricing")));
});

test("model-release research never admits another vendor's first-party documentation", async () => {
  let state: WorkflowState = createDefaultState();
  const official = candidate({
    id: "fable-owner-vendor-guard",
    rawId: "fable-owner-vendor-guard",
    sourceName: "Anthropic",
    title: "Anthropic releases Claude Fable 5.1",
    url: "https://www.anthropic.com/claude-fable-5-1",
    canonicalUrl: "https://www.anthropic.com/claude-fable-5-1",
    excerpt: "Anthropic released Claude Fable 5.1.",
    publishedAt: "2026-09-01T13:00:00.000Z",
  });
  state.runs = [run(official)];
  const story = buildStories(state, "2026-09-01T20:00:00.000Z")[0]!;
  const desk = createStoryEvidenceDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    search: async () => ({
      items: [{
        id: "openai-docs-contamination",
        source_type: "model-research",
        title: "Models | OpenAI API",
        url: "https://developers.openai.com/api/docs/models",
        content: "OpenAI API pricing documentation compares Claude Fable 5.1 pricing and benchmark results.",
        published_at: "2026-09-01T13:05:00.000Z",
        fetched_at: "2026-09-01T20:00:00.000Z",
        metadata: { feed_name: "OpenAI API Docs", source_role: "official" },
      }],
      failures: {},
      searchedSourceCount: 1,
    }),
    now: () => new Date("2026-09-01T20:00:00.000Z"),
  });

  const result = await desk.supplement(story.id);
  const updated = storyById(state, story.id, "2026-09-01T20:00:00.000Z");

  assert.equal(result.addedSourceCount, 0);
  assert.deepEqual(updated?.signals.map((signal) => signal.sourceName), ["Anthropic"]);
});

test("evidence supplementation rejects discovery feeds and same-publisher syndication", async () => {
  let state: WorkflowState = createDefaultState();
  state.runs = [run(candidate())];
  const story = buildStories(state, "2026-08-30T02:00:00.000Z")[0]!;
  const desk = createStoryEvidenceDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    search: async () => ({
      items: [{
        id: "discovery-copy",
        source_type: "rss",
        title: "Acme launches Model X and opens public API",
        url: "https://aggregator.example/acme-model-x",
        content: "Acme launched Model X and opened its public API.",
        published_at: "2026-08-30T01:20:00.000Z",
        fetched_at: "2026-08-30T02:00:00.000Z",
        metadata: { feed_name: "News Aggregator", source_role: "discovery" },
      }, {
        id: "same-publisher-copy",
        source_type: "rss",
        title: "Acme launches Model X and opens public API",
        url: "https://press.acme.example/press/model-x-copy",
        content: "Acme launched Model X and opened its public API.",
        published_at: "2026-08-30T01:25:00.000Z",
        fetched_at: "2026-08-30T02:00:00.000Z",
        metadata: { feed_name: "Acme Press", source_role: "verification" },
      }],
      failures: {},
      searchedSourceCount: 2,
    }),
    now: () => new Date("2026-08-30T02:00:00.000Z"),
  });

  const result = await desk.supplement(story.id);

  assert.equal(result.addedSourceCount, 0);
  assert.equal(result.evidenceStrength, "moderate");
  assert.equal(buildStories(state, "2026-08-30T02:00:00.000Z").length, 1);
});
