import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createXMonitorDesk } from "./x-monitor-desk.js";
import type { RawHorizonItem, WorkflowState } from "./types.js";

const xItem = (id: string, publishedAt: string): RawHorizonItem => ({
  id: `x:${id}`,
  source_type: "x",
  title: `OpenAI releases GPT-${id} with API access and benchmark results`,
  url: `https://x.com/OpenAI/status/${id}`,
  content: `OpenAI officially releases GPT-${id}; API access, model details and benchmark results are available.`,
  author: "@OpenAI",
  published_at: publishedAt,
  fetched_at: publishedAt,
  metadata: {
    feed_name: "AI 官方账号（X）",
    source_id: "x-ai-official",
    source_role: "official",
    is_official_account: true,
  },
});

test("X monitor stays dormant without both an enabled source and a protected token", async () => {
  let state: WorkflowState = createDefaultState();
  const configured = state.sources.find((source) => source.id === "x-ai-official")!;
  configured.enabled = true;
  configured.selected = true;
  let collectionCalls = 0;
  const monitor = createXMonitorDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    getBearerToken: async () => "",
    collect: async () => {
      collectionCalls += 1;
      return { items: [], failures: {}, cursors: {} };
    },
  });

  const result = await monitor.poll();

  assert.equal(result.status, "token-missing");
  assert.equal(collectionCalls, 0);
  assert.equal(state.runs.length, 0);
});

test("X monitor incrementally merges new official posts into one daily run without AI drafting", async () => {
  let state: WorkflowState = createDefaultState();
  const configured = state.sources.find((source) => source.id === "x-ai-official")!;
  configured.enabled = true;
  configured.selected = true;
  let now = new Date("2026-09-03T01:00:00.000Z");
  let collectionCalls = 0;
  const monitor = createXMonitorDesk({
    readState: async () => state,
    updateState: async (mutate) => mutate(state),
    getBearerToken: async () => "protected-token-value",
    now: () => now,
    collect: async () => {
      collectionCalls += 1;
      const id = collectionCalls === 1 ? "57" : "58";
      return {
        items: [xItem(id, now.toISOString())],
        failures: {},
        cursors: { "x-ai-official": id },
      };
    },
  });

  const first = await monitor.poll();
  now = new Date("2026-09-03T01:01:00.000Z");
  const throttled = await monitor.poll();
  now = new Date("2026-09-03T01:06:00.000Z");
  const second = await monitor.poll();

  assert.equal(first.status, "collected");
  assert.equal(throttled.status, "not-due");
  assert.equal(second.status, "collected");
  assert.equal(collectionCalls, 2);
  assert.equal(state.runs.length, 1);
  assert.equal(state.runs[0]?.scheduled, true);
  assert.equal(state.runs[0]?.autoGenerateCount, undefined);
  assert.deepEqual(state.runs[0]?.candidates.map((candidate) => candidate.rawId).sort(), ["x:57", "x:58"]);
  assert.equal(configured.cursor, "58");
  assert.equal(configured.health, "healthy");
  assert.match(configured.lastHealthDetail ?? "", /5 分钟增量监控正常/u);
});
