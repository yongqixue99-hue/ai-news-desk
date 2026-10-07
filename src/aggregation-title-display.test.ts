import assert from "node:assert/strict";
import test from "node:test";
import { titleTranslationFor, visibleTranslationTargets } from "./aggregation-title-display.js";
import type { AggregationEntry } from "../server/aggregation-desk.js";
import type { AggregationTitleTranslation } from "../server/title-translation-types.js";

const entry = (index: number): AggregationEntry => ({ id: String(index), title: `Example model ${index}`, url: `https://example.com/${index}`, summary: "原摘要", observedAt: "2026-10-07T12:00:00Z", kind: "news", selected: false, platforms: [], ranking: { score: index, heat: index, eligible: true, reasons: [] } });
const translation = (e: AggregationEntry): AggregationTitleTranslation => ({ entryId: e.id, originalTitle: e.title, url: e.url, key: "a".repeat(64), titleZh: "示例模型更新", model: "existing-model", translatedAt: "2026-10-07T12:00:00Z" });

test("manual targets use only the currently rendered slice and at most 20 untranslated English titles", () => {
  const filtered = Array.from({ length: 70 }, (_, index) => entry(index)), before = structuredClone(filtered);
  const targets = visibleTranslationTargets(filtered, 40, [translation(filtered[0]!)]);
  assert.equal(targets.length, 20); assert.equal(targets[0]!.entryId, "1"); assert.equal(targets.at(-1)!.entryId, "20");
  const nearEnd = visibleTranslationTargets(filtered.slice(38), 2, []);
  assert.deepEqual(nearEnd.map(value => value.entryId), ["38", "39"]);
  assert.deepEqual(visibleTranslationTargets([{ ...entry(0), title: "已有中文标题" }], 40, []), []);
  assert.deepEqual(filtered, before, "display helpers cannot change score, title or ordering");
});

test("a late response cannot display on a different original title, URL or entry", () => {
  const original = entry(0), record = translation(original);
  assert.equal(titleTranslationFor(original, [record])?.titleZh, "示例模型更新");
  for (const changed of [{ ...original, title: "Changed title" }, { ...original, url: "https://example.com/new" }, { ...original, id: "other" }]) assert.equal(titleTranslationFor(changed, [record]), undefined);
  assert.equal(original.title, "Example model 0");
});
