import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { registerAggregationTitleTranslationRoutes } from "./title-translation-http-routes.js";
import { registeredHttpRoutes, withHttpRouteServer } from "./http-route-test-support.js";
import { createDefaultState } from "./defaults.js";
import { buildAggregationView } from "./aggregation-desk.js";
import type { TitleTranslationRecord } from "./title-translation-types.js";

function fixture() {
  const state = createDefaultState(), now = new Date().toISOString();
  state.runs = [{ id: "translation-fixture", createdAt: now, updatedAt: now, collectedAt: now, status: "ready", stage: "done", windowHours: 24, sourceIds: ["alphasignal"], scheduled: false, rawCount: 1, candidates: [], logs: [],
    aggregationItems: [{ id: "one", title: "Example releases a model", url: "https://example.com/one", published_at: now, fetched_at: now, source_type: "rss", metadata: { source_id: "alphasignal" } }],
    sourceResults: [{ sourceId: "alphasignal", sourceName: "示例", status: "healthy", healthImpact: "success", rawCount: 1, candidateCount: 0, detail: "" }] }];
  const cache = new Map<string, TitleTranslationRecord>(), app = express(); app.use(express.json());
  let reads = 0, calls = 0;
  registerAggregationTitleTranslationRoutes(app, { readState: async () => { reads++; return structuredClone(state); }, getLocalDatabase: async () => ({ getTitleTranslations: keys => keys.flatMap(key => cache.has(key) ? [cache.get(key)!] : []), saveTitleTranslations: records => { records.forEach(record => cache.set(record.key, record)); } }) },
    async input => { calls++; return { output: { items: input.items.map(item => ({ key: item.key, titleZh: "示例发布模型" })) }, model: input.provider.model, translatedAt: now }; });
  return { state, app, stats: () => ({ reads, calls }), cache };
}

test("registration has no IO; browsing is read-only; invalid and oversized HTTP requests never call a provider", async () => {
  const s = fixture(); assert.deepEqual(s.stats(), { reads: 0, calls: 0 });
  assert.deepEqual(registeredHttpRoutes(s.app), [{ method: "get", path: "/api/aggregations/title-translations" }, { method: "post", path: "/api/aggregations/title-translations" }]);
  await withHttpRouteServer(s.app, async origin => {
    assert.deepEqual(await (await fetch(origin + "/api/aggregations/title-translations")).json(), []);
    for (const items of [[], Array.from({ length: 21 }, (_, index) => ({ entryId: String(index), title: "English title", url: "https://example.com/" + index }))]) {
      const response = await fetch(origin + "/api/aggregations/title-translations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) }); assert.equal(response.status, 400);
    }
    assert.equal(s.stats().calls, 0); assert.equal(s.cache.size, 0);
  });
});

test("manual HTTP translation preserves source state, reuses cache and honors the existing spending policy", async () => {
  const s = fixture(), before = structuredClone(s.state), original = buildAggregationView(s.state).entries[0]!;
  const body = JSON.stringify({ items: [{ entryId: original.id, title: original.title, url: original.url }] });
  await withHttpRouteServer(s.app, async origin => {
    const post = () => fetch(origin + "/api/aggregations/title-translations", { method: "POST", headers: { "content-type": "application/json" }, body });
    const result = await (await post()).json(); assert.equal(result.generated, 1); assert.equal(result.items[0].originalTitle, original.title);
    assert.deepEqual(s.state, before); assert.equal((await (await post()).json()).cacheHits, 1); assert.equal(s.stats().calls, 1);
    s.cache.clear();
    s.state.aiSettings.providers.push({ ...s.state.aiSettings.providers[0]!, id: "gemini", name: "Gemini", kind: "openai-compatible" }); s.state.aiSettings.analysisProviderId = "gemini"; s.state.settings.spendingPolicy = "zero-cost";
    const denied = await post(); assert.equal(denied.status, 409); assert.match((await denied.json()).error, /零新增支出/u); assert.equal(s.stats().calls, 1);
  });
});
