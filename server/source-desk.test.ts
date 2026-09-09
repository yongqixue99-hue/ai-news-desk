import assert from "node:assert/strict";
import test from "node:test";
import { buildFocusedNewsSearchRequest, createSourceDesk, deduplicateDiscoveryItems } from "./source-desk.js";
import type { RawHorizonItem, SourceConfig } from "./types.js";

const source = (id: string, kind: SourceConfig["kind"]): SourceConfig => ({
  id,
  name: id,
  kind,
  homepageUrl: "https://example.com",
  query: kind === "github" ? "openai/codex" : kind === "x" ? "OpenAI" : undefined,
  topicIds: ["ai"],
  enabled: true,
  selected: true,
  category: "technology",
  discoveryOnly: kind !== "rss",
});

test("SourceDesk keeps X official posts and their incremental cursor separate from community adapters", async () => {
  const desk = createSourceDesk({
    collectStructured: async () => ({ items: [] }),
    collectXOfficial: async (sources) => {
      assert.deepEqual(sources.map((entry) => entry.id), ["x-official"]);
      return {
        items: [item("x:400", "x")],
        failures: {},
        cursors: { "x-official": "400" },
      };
    },
  });

  const batch = await desk.collect({
    sources: [source("x-official", "x")],
    topicIds: ["ai"],
  });

  assert.deepEqual(batch.adapterCounts, { x: 1 });
  assert.deepEqual(batch.sourceCursors, { "x-official": "400" });
  assert.deepEqual(batch.failures, {});
});

const item = (id: string, sourceType: string): RawHorizonItem => ({
  id,
  source_type: sourceType,
  title: id,
  url: `https://example.com/${id}`,
  fetched_at: "2026-08-30T00:00:00.000Z",
});

test("discovery deduplication preserves query-based article identities while removing tracking variants", () => {
  const items = [
    { ...item("one", "rss"), url: "https://qwen.ai/blog?id=one" },
    { ...item("two", "rss"), url: "https://qwen.ai/blog?id=two" },
    { ...item("duplicate", "rss"), url: "https://qwen.ai/blog?utm_source=news&id=one#section" },
  ];
  assert.deepEqual(deduplicateDiscoveryItems(items).map((item) => item.id), ["one", "two"]);
});

test("dated official update anchors remain distinct while tracking copies collapse", () => {
  const base = "https://api-docs.deepseek.com/updates/";
  const items = [
    { ...item("a", "rss"), url: `${base}#deepseek-update-a` },
    { ...item("b", "rss"), url: `${base}#deepseek-update-b` },
    { ...item("copy", "rss"), url: `${base}?utm_source=rss#deepseek-update-a` },
    { ...item("g1", "rss"), url: "https://ai.google.dev/gemini-api/docs/changelog#09-02-2026" },
    { ...item("g2", "rss"), url: "https://ai.google.dev/gemini-api/docs/changelog#09-03-2026" },
  ];
  assert.deepEqual(deduplicateDiscoveryItems(items).map((entry) => entry.id), ["a", "b", "g1", "g2"]);
});

test("SourceDesk combines heterogeneous adapters behind one SignalBatch", async () => {
  const desk = createSourceDesk({
    collectStructured: async (sources) => {
      assert.deepEqual(sources.map((entry) => entry.id), ["rss", "hn"]);
      return { items: [item("official", "rss"), item("thread", "hackernews")], horizonRunId: "horizon-1" };
    },
    collectCommunity: async (sources) => {
      assert.deepEqual(sources.map((entry) => entry.id), ["github"]);
      return { items: [item("release", "github")], failures: {} };
    },
  });

  const batch = await desk.collect({
    sources: [source("rss", "rss"), source("hn", "hackernews"), source("github", "github")],
    topicIds: ["ai"],
  });

  assert.equal(batch.horizonRunId, "horizon-1");
  assert.equal(batch.items.length, 3);
  assert.deepEqual(batch.adapterCounts, { rss: 1, hackernews: 1, github: 1 });
  assert.deepEqual(batch.failures, {});
});

test("one adapter failure is isolated while evidence from another adapter survives", async () => {
  const desk = createSourceDesk({
    collectStructured: async () => { throw new Error("RSS collector unavailable"); },
    collectCommunity: async () => ({ items: [item("release", "github")], failures: {} }),
  });
  const batch = await desk.collect({
    sources: [source("rss", "rss"), source("github", "github")],
    topicIds: ["ai"],
  });

  assert.equal(batch.items.length, 1);
  assert.match(batch.failures.rss ?? "", /unavailable/u);
  assert.equal(batch.failures.github, undefined);
});

test("SourceDesk carries individual route failures through its public result", async () => {
  const routes = [{ sourceId: "rss", url: "https://example.com/index", status: "error" as const, rawCount: 0, detail: "HTTP 503" }];
  const desk = createSourceDesk({ collectStructured: async () => ({ items: [item("healthy", "rss")], routeResults: routes }) });
  assert.deepEqual((await desk.collect({ sources: [source("rss", "rss")], topicIds: ["ai"] })).routeResults, routes);
});

test("focused news search covers seven Hong Kong calendar days without X or community sources", () => {
  const official = { ...source("official", "rss"), role: "official" as const };
  const verification = { ...source("verification", "rss"), role: "verification" as const };
  const discovery = { ...source("discovery", "rss"), role: "discovery" as const };
  const community = { ...source("community", "hackernews"), role: "community" as const };
  const xOfficial = { ...source("x-official", "x"), role: "official" as const };
  const disabled = { ...source("disabled", "rss"), role: "official" as const, enabled: false };

  assert.deepEqual(buildFocusedNewsSearchRequest(
    [official, verification, discovery, community, xOfficial, disabled],
    "  GPT-6 Astra  ",
    ["ai"],
    new Date("2026-09-04T12:00:00.000Z"),
  ), {
    sourceIds: ["official", "verification", "discovery"],
    topicIds: ["ai"],
    dateFrom: "2026-08-29",
    dateTo: "2026-09-04",
    keywords: "GPT-6 Astra",
  });
});
