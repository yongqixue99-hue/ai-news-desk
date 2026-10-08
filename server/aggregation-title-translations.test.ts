import assert from "node:assert/strict";
import test from "node:test";
import { createAggregationTitleTranslationDesk, titleTranslationKey } from "./aggregation-title-translations.js";
import { createDefaultState } from "./defaults.js";
import type { AggregationEntry, AggregationView } from "./aggregation-desk.js";
import type { TitleTranslationRecord, TitleTranslationTarget } from "./title-translation-types.js";

const now = "2026-10-07T12:00:00.000Z";
const entries = (): AggregationEntry[] => Array.from({ length: 25 }, (_, index) => ({ id: `entry-${index}`, title: `Example releases model ${index}`, url: `https://example.com/model/${index}`, summary: "Original summary", observedAt: now, selected: false, kind: "news", platforms: [] }));
const target = (entry: AggregationEntry): TitleTranslationTarget => ({ entryId: entry.id, title: entry.title, url: entry.url });
function setup(generate?: (input: { items: Array<{ key: string; title: string }> }) => Promise<unknown>) {
  const original = entries(), view: AggregationView = { entries: original, recommended: original, platformEntries: {}, platforms: [], active: false };
  const cache = new Map<string, TitleTranslationRecord>(); let calls = 0, writes = 0, providerReads = 0;
  const provider = createDefaultState().aiSettings.providers[0]!;
  const desk = createAggregationTitleTranslationDesk({
    readView: async () => structuredClone(view), readCache: async keys => keys.flatMap(key => cache.has(key) ? [structuredClone(cache.get(key)!)] : []),
    writeCache: async records => { writes++; records.forEach(record => cache.set(record.key, structuredClone(record))); },
    provider: async () => { providerReads++; return provider; },
    generate: async input => { calls++; return { output: generate ? await generate(input) : { items: input.items.map(item => ({ key: item.key, titleZh: "示例发布模型" })) }, model: provider.model, translatedAt: now }; },
  });
  return { desk, view, cache, provider, stats: () => ({ calls, writes, providerReads }) };
}

test("translation key preserves the exact original title and URL tuple", () => {
  assert.notEqual(titleTranslationKey("ab", "c"), titleTranslationKey("a", "bc"));
  assert.notEqual(titleTranslationKey("Title", "url"), titleTranslationKey("title", "url"));
  assert.match(titleTranslationKey("Title", "url"), /^[0-9a-f]{64}$/u);
});

test("browsing cache never calls a provider and manual translation preserves all original fields", async () => {
  const s = setup(), before = structuredClone(s.view), requested = s.view.entries.slice(0, 2).map(target);
  assert.deepEqual(await s.desk.cached(), []); assert.deepEqual(s.stats(), { calls: 0, writes: 0, providerReads: 0 });
  const result = await s.desk.translate(requested);
  assert.equal(result.generated, 2); assert.equal(result.cacheHits, 0); assert.equal(result.items.length, 2);
  assert.equal(result.items[0]!.originalTitle, requested[0]!.title); assert.equal(result.items[0]!.model, s.provider.model);
  assert.deepEqual(s.view, before);
  const repeated = await s.desk.translate(requested);
  assert.equal(repeated.cacheHits, 2); assert.equal(repeated.generated, 0); assert.deepEqual(s.stats(), { calls: 1, writes: 1, providerReads: 1 });
  assert.equal((await s.desk.cached()).length, 2);
  s.view.entries[0]!.title += " updated";
  assert.equal((await s.desk.cached()).length, 1, "the same URL with a changed original title cannot reuse the old translation");
});

test("invalid, stale, duplicate and oversized requests fail before model or cache writes", async () => {
  const s = setup(), first = target(s.view.entries[0]!);
  for (const input of [null, {}, [], [first, first], s.view.entries.slice(0, 21).map(target), [{ ...first, title: "changed" }], [{ ...first, url: "https://example.com/other" }], [{ ...first, entryId: "unknown" }], [{ ...first, extra: "untrusted" }]]) {
    await assert.rejects(() => s.desk.translate(input));
  }
  s.view.entries[0]!.title = "已有中文标题";
  await assert.rejects(() => s.desk.translate([target(s.view.entries[0]!)]));
  assert.deepEqual(s.stats(), { calls: 0, writes: 0, providerReads: 0 });
});

test("overlapping manual requests translate each missing key only once", async () => {
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const firstStarted = new Promise<void>(resolve => { started = resolve; });
  const seen: string[] = [];
  const s = setup(async input => { seen.push(...input.items.map(item => item.key)); started(); await gate; return { items: input.items.map(item => ({ key: item.key, titleZh: "示例模型更新" })) }; });
  const first = s.desk.translate(s.view.entries.slice(0, 2).map(target)); await firstStarted;
  const second = s.desk.translate(s.view.entries.slice(1, 3).map(target));
  await new Promise(resolve => setImmediate(resolve)); release();
  const result = await Promise.all([first, second]);
  assert.equal(seen.length, 3); assert.equal(new Set(seen).size, 3); assert.equal(s.stats().calls, 2);
  assert.deepEqual(result.map(value => value.items.length), [2, 2]); assert.equal(s.cache.size, 3);
});

test("malformed model results are atomic and a deliberate retry can recover", async () => {
  let valid = false;
  const s = setup(async input => valid ? { items: input.items.map(item => ({ key: item.key, titleZh: "示例模型更新" })) } : { items: [{ key: input.items[0]!.key, titleZh: "示例标题" }, { key: "unknown", titleZh: "bad" }] });
  await assert.rejects(() => s.desk.translate(s.view.entries.slice(0, 2).map(target)));
  assert.equal(s.cache.size, 0); assert.equal(s.stats().writes, 0);
  valid = true; const result = await s.desk.translate(s.view.entries.slice(0, 2).map(target));
  assert.equal(result.generated, 2); assert.equal(s.stats().calls, 2);
});

test("duplicate, incomplete and non-Chinese model responses never persist", async () => {
  for (const mode of ["duplicate", "missing", "english", "extra"] as const) {
    const s = setup(async input => ({ items: mode === "missing" ? [] : mode === "duplicate" ? [0, 0].map(index => ({ key: input.items[index]!.key, titleZh: "示例标题" })) : input.items.map(item => ({ key: item.key, titleZh: mode === "english" ? "English only" : "示例标题", ...(mode === "extra" ? { fact: "invented" } : {}) })) }));
    await assert.rejects(() => s.desk.translate(s.view.entries.slice(0, 2).map(target)));
    assert.equal(s.cache.size, 0); assert.equal(s.stats().writes, 0);
  }
});

test("a snapshot change while the model is running rejects the stale result without caching it", async () => {
  let mutate!: () => void;
  const s = setup(async input => { mutate(); return { items: input.items.map(item => ({ key: item.key, titleZh: "示例标题" })) }; });
  mutate = () => { s.view.entries[0]!.title = "Replacement title"; };
  await assert.rejects(() => s.desk.translate([target(s.view.entries[0]!)]), /快照/u);
  assert.equal(s.stats().writes, 0); assert.equal(s.cache.size, 0);
});
