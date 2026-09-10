import assert from "node:assert/strict";
import test from "node:test";
import { collectDiscoveryCandidates } from "./discovery-funnel.js";
import type { RawHorizonItem } from "./types.js";

const now = Date.parse("2026-09-08T10:00:00Z");
const item = (id: string, overrides: Partial<RawHorizonItem> = {}): RawHorizonItem => ({
  id, source_type: "rss", title: "Aster releases an AI model", content: "AI model API is now available.",
  url: `https://example.com/${id}`, published_at: "2026-09-08T01:00:00Z", fetched_at: new Date(now).toISOString(),
  metadata: { feed_name: "Official", source_role: "official" }, ...overrides,
});

test("dated Gemini API releases enter the news pipeline, not evergreen learning", () => {
  const result = collectDiscoveryCandidates([item("gemini", {
    title: "Gemini 3.8 Flash is now available", url: "https://ai.google.dev/gemini-api/docs/changelog#09-02-2026",
  })], { now, windowHours: 24, topicIds: ["ai"] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].technicalArticle, undefined);
});

test("collection diagnostics account for each raw row once at its first rejection", () => {
  const rows = [item("keep"), item("old", { published_at: "2026-08-01T00:00:00Z" }),
    item("missing", { published_at: undefined }), item("future", { published_at: "2027-01-01T00:00:00Z" }),
    item("keyword", { title: "Aster releases a GPU", content: "New hardware" }),
    item("copy", { url: "https://example.com/keep?utm_source=news" }),
    item("syndicated", { url: "https://reporter.example/news" })];
  const { candidates, funnel } = collectDiscoveryCandidates(rows, { now, windowHours: 24, topicIds: ["ai"], filters: { keywords: "model" } });
  assert.equal(candidates.length, 1);
  assert.equal(funnel.dateAcceptedCount, 4);
  assert.equal(funnel.matchedCount, 3);
  assert.equal(funnel.uniqueUrlCount, 2);
  assert.equal(funnel.rejections.reduce((sum, reason) => sum + reason.count, 0) + funnel.candidateCount, rows.length);
  assert.deepEqual(new Set(funnel.rejections.map((reason) => reason.code)), new Set([
    "missing-published-at", "future-published-at", "outside-window", "keyword-mismatch", "duplicate-url", "merged-event",
  ]));
});

test("similar titles in separate official date sections do not disappear during scoring", () => {
  const result = collectDiscoveryCandidates([item("a", { url: "https://ai.google.dev/gemini-api/docs/changelog#one" }),
    item("b", { url: "https://ai.google.dev/gemini-api/docs/changelog#two" })], { now, windowHours: 24, topicIds: ["ai"] });
  assert.equal(result.candidates.length, 2);
});

test("a dated AI vendor index can establish topic relevance for a new product name", () => {
  const result = collectDiscoveryCandidates([item("new-name", {
    title: "Lyra music generation is now available", content: "Released a music generation model with API access.",
    url: "https://ai.google.dev/gemini-api/docs/changelog#new-product",
    metadata: { feed_name: "Gemini 官方", source_role: "official", source_format: "gemini-changelog" },
  })], { now, windowHours: 24, topicIds: ["ai"] });
  assert.equal(result.candidates.length, 1);
});

test("official releases get a bounded seven-day catch-up before the ordinary 48-hour gate", () => {
  const rows = [item("release", {
    title: "GPT-6 Astra: A new generation of intelligence", content: "Introducing GPT-6 Astra.",
    url: "https://openai.com/index/gpt-6-astra", published_at: "2026-09-03T11:00:00Z",
    metadata: { source_role: "official", feed_name: "OpenAI", date_basis: "feed-published" },
  }), item("digest", { title: "GPT-6 weekly roundup", published_at: "2026-09-03T11:00:00Z" }),
  item("too-old", { title: "OpenAI releases GPT-5", url: "https://openai.com/old", published_at: "2026-08-01T11:00:00Z" })];
  const result = collectDiscoveryCandidates(rows, { now, windowHours: 48, topicIds: ["ai"] });
  assert.deepEqual(result.candidates.map((entry) => entry.rawId), ["release"]);
  assert.equal(result.candidates[0].publishedAt, "2026-09-03T11:00:00Z");
  const explicit = collectDiscoveryCandidates(rows, { now, windowHours: 48, topicIds: ["ai"], filters: { dateFrom: "2026-09-07", dateTo: "2026-09-08" } });
  assert.equal(explicit.candidates.length, 0, "catch-up must never override an explicit search range");
});

test("catch-up rejects rumours, recaps, promotional pages and modification-only dates", () => {
  const base = item("old-official", { title: "Introducing GPT-6 Astra", content: "A new model is available.",
    url: "https://openai.com/index/gpt-6-astra", published_at: "2026-09-03T11:00:00Z",
    metadata: { feed_name: "OpenAI", source_role: "official", date_basis: "feed-published" } });
  for (const changes of [
    { title: "GPT-6 weekly roundup" }, { title: "Rumor: GPT-6 launches today" },
    { title: "Join us: GPT-6 launch webinar" }, { title: "GPT-6 SDK patch release" },
    { url: "https://unrelated.example/introducing-gpt-6" },
    { metadata: { ...base.metadata, date_basis: "feed-updated" } },
    { metadata: { ...base.metadata, source_format: "sitemap", date_basis: "sitemap-lastmod" } },
  ]) {
    assert.equal(collectDiscoveryCandidates([{ ...base, ...changes }], { now, windowHours: 48, topicIds: ["ai"] }).candidates.length, 0,
      JSON.stringify(changes));
  }
  const verified = { ...base, metadata: { ...base.metadata, source_format: "sitemap", date_basis: "sitemap-lastmod", date_verification: "verified" } };
  assert.equal(collectDiscoveryCandidates([verified], { now, windowHours: 48, topicIds: ["ai"] }).candidates.length, 1);
});

test("event trace names the first rejection and retains merged factual candidates", () => {
  const rows = [item("keep"), item("old", { published_at: "2026-08-01T00:00:00Z" }), item("missing", { published_at: undefined }), item("copy", { url: "https://example.com/keep?utm_source=x" }), item("official-copy", { url: "https://other.example/article" })];
  const result = collectDiscoveryCandidates(rows, { now, windowHours: 24, topicIds: ["ai"] });
  assert.equal(result.trace.find(row => row.rawId === "old")?.stage, "outside-window");
  assert.equal(result.trace.find(row => row.rawId === "missing")?.stage, "missing-published-at");
  assert.equal(result.trace.find(row => row.rawId === "copy")?.stage, "duplicate-url");
  assert.equal(result.trace.filter(row => row.stage === "merged-event").length, 1);
  assert.equal(result.evidenceCandidates.length, 2);
  assert.ok(result.trace.find(row => row.stage === "merged-event")?.candidateId);
});

test("trace diagnoses an actual public release URL from saved observations without a fetch", async () => {
  const { createDefaultState } = await import("./defaults.js");
  const { traceDiscoveryUrl } = await import("./discovery-trace.js");
  const state = createDefaultState();
  const url = "https://openai.com/index/gpt-6-astra/";
  const result = collectDiscoveryCandidates([item("real-link", { url, published_at: "2026-08-01T00:00:00Z" })], { now, windowHours: 24, topicIds: ["ai"] });
  state.runs = [{ id: "replay", createdAt: new Date(now).toISOString(), updatedAt: new Date(now).toISOString(), status: "ready", stage: "done", scheduled: false, sourceIds: [], windowHours: 24, rawCount: 1, candidates: result.candidates, discoveryTrace: result.trace, logs: [] }];
  assert.equal(traceDiscoveryUrl(state, url + "?utm_source=x", new Date(now).toISOString()).observations[0]?.stage, "outside-window");
  assert.match(traceDiscoveryUrl(state, "https://unobserved.example/news").displayReason, /不能断言/u);
  assert.throws(() => traceDiscoveryUrl(state, "file:///secret"));
});

test("trace reports recorded recommendation time and never invents history for old runs",async()=>{
 const {createDefaultState}=await import("./defaults.js");const {captureRecommendationSnapshot,traceDiscoveryUrl}=await import("./discovery-trace.js");
 const state=createDefaultState();const url="https://openai.com/index/gpt-6-astra/";
 const result=collectDiscoveryCandidates([item("launch",{url,title:"OpenAI launches GPT-6 Astra",content:"OpenAI releases the GPT-6 Astra AI model API.",metadata:{feed_name:"OpenAI",source_role:"official"}})],{now,windowHours:48,topicIds:["ai"]});
 state.runs=[{id:"r",createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),status:"ready",stage:"done",scheduled:false,sourceIds:[],windowHours:48,rawCount:1,candidates:result.candidates,discoveryTrace:result.trace,logs:[]}];
 const time=new Date(now).toISOString();assert.equal(traceDiscoveryUrl(state,url,time).firstRecordedRecommendationAt,undefined);
 const snapshot=captureRecommendationSnapshot(state,time);assert.ok(snapshot.stories.length);
 state.runs[0]!.recommendationSnapshot=snapshot;assert.equal(traceDiscoveryUrl(state,url,time).firstRecordedRecommendationAt,time);
});

test("explicit evidence selection remains addressable without expanding default model work",async()=>{
 const {candidatePool,candidateFromRun}=await import("./candidate-pool.js");
 const result=collectDiscoveryCandidates([item("visible"),item("merged",{url:"https://other.example/news"})],{now,windowHours:24,topicIds:["ai"]});
 const run={id:"r",createdAt:new Date(now).toISOString(),updatedAt:new Date(now).toISOString(),status:"ready" as const,stage:"done",scheduled:false,sourceIds:[],windowHours:24,rawCount:2,candidates:result.candidates,evidenceCandidates:result.evidenceCandidates,logs:[]};
 const hidden=result.evidenceCandidates.find(candidate=>!run.candidates.some(visible=>visible.id===candidate.id))!;assert.ok(hidden);
 assert.equal(candidatePool(run).length,1);assert.equal(candidateFromRun(run,hidden.id)?.url,hidden.url);assert.equal(candidatePool(run,new Set([hidden.id]))[0]?.id,hidden.id);
});
