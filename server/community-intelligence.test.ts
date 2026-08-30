import assert from "node:assert/strict";
import test from "node:test";
import { collectHackerNewsDiscussion, type HackerNewsItem } from "./community-intelligence.js";

test("Hacker News adapter preserves tree branches, authors and permanent links", async () => {
  const items = new Map<number, HackerNewsItem>([
    [1, { id: 1, type: "story", kids: [10, 20] }],
    [10, { id: 10, type: "comment", by: "alice", time: 1_700_000_000, parent: 1, text: "We tested this in production and the latency was stable.", kids: [11] }],
    [11, { id: 11, type: "comment", by: "bob", time: 1_700_000_010, parent: 10, text: "However, the benchmark leaves out long-context requests." }],
    [20, { id: 20, type: "comment", by: "carol", time: 1_700_000_020, parent: 1, text: "How does the commercial license work?" }],
  ]);
  const samples = await collectHackerNewsDiscussion({
    rootId: 1,
    signalId: "run:candidate",
    getItem: async (id) => items.get(id) ?? null,
  });

  assert.equal(samples.length, 3);
  assert.equal(samples.find((sample) => sample.author === "bob")?.branchId, "10");
  assert.equal(samples.find((sample) => sample.author === "bob")?.depth, 1);
  assert.equal(samples.find((sample) => sample.author === "carol")?.branchId, "20");
  assert.equal(samples.find((sample) => sample.author === "carol")?.kind, "question");
  assert.equal(samples.every((sample) => sample.permalink === `https://news.ycombinator.com/item?id=${sample.id.split("_")[1]}`), true);
});

test("deleted and empty comments never become attributable samples", async () => {
  const items = new Map<number, HackerNewsItem>([
    [1, { id: 1, type: "story", kids: [2, 3, 4] }],
    [2, { id: 2, type: "comment", deleted: true, kids: [] }],
    [3, { id: 3, type: "comment", by: "short", text: "ok" }],
    [4, { id: 4, type: "comment", by: "valid", text: "A sufficiently detailed and attributable community observation." }],
  ]);
  const samples = await collectHackerNewsDiscussion({ rootId: 1, signalId: "signal", getItem: async (id) => items.get(id) ?? null });
  assert.deepEqual(samples.map((sample) => sample.author), ["valid"]);
});
