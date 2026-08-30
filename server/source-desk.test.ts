import assert from "node:assert/strict";
import test from "node:test";
import { createSourceDesk } from "./source-desk.js";
import type { RawHorizonItem, SourceConfig } from "./types.js";

const source = (id: string, kind: SourceConfig["kind"]): SourceConfig => ({
  id,
  name: id,
  kind,
  homepageUrl: "https://example.com",
  query: kind === "github" ? "openai/codex" : undefined,
  topicIds: ["ai"],
  enabled: true,
  selected: true,
  category: "technology",
  discoveryOnly: kind !== "rss",
});

const item = (id: string, sourceType: string): RawHorizonItem => ({
  id,
  source_type: sourceType,
  title: id,
  url: `https://example.com/${id}`,
  fetched_at: "2026-08-30T00:00:00.000Z",
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
