import assert from "node:assert/strict";
import test from "node:test";
import { parsePackageSourceFacts, sourceEvidencePassages, generateVerifiedPackageFacts } from "./package-source-evidence.js";
import { selectStoryArticleSources } from "./story-article-sources.js";
import type { ContentPackageSource, SourceMaterialSnapshot, StorySignalView } from "./product-types.js";

const source: ContentPackageSource = { signalId: "run:one", label: "Author", url: "https://example.com/port",
  role: "discovery", basis: "full-source", publishedAt: "2026-09-03T00:00:00Z", isCommunity: false };
const quote = "The prototype took one evening. Getting the feel right and shipping it took several more weekends.";
const snapshot: SourceMaterialSnapshot = { signalId: source.signalId, sourceLabel: source.label, url: source.url,
  sourceKind: "linked-page", originalTitle: "Porting an old game", originalText: quote, originalLanguage: "en",
  basis: "full-source", capturedAt: "2026-09-05T00:00:00Z", truncated: false, rightsNotice: "Keep attribution" };
const fact = { text: "作者说原型只花了一个晚上，调整手感并完成交付又用了几个周末。", sourceIndex: 0, quote };

test("article facts keep a verbatim quotation and source attribution after the scan summary ends", () => {
  const longSnapshot = { ...snapshot, originalText: `${"Introductory context. ".repeat(300)}\n${quote}` };
  const result = parsePackageSourceFacts(JSON.stringify({ facts: [fact], uncertainties: [] }), "story", [source], [longSnapshot]);
  assert.equal(result.facts.length, 1);
  assert.equal(result.facts[0]?.text, fact.text);
  assert.deepEqual(result.facts[0]?.quotations, [{ sourceUrl: source.url, text: quote }]);
  assert.deepEqual(result.facts[0]?.sourceSignalIds, [source.signalId]);
});

test("invented or modified source quotations cannot enter frozen article facts", () => {
  for (const invalid of [
    { ...fact, quote: "The model completed and shipped the entire game in one evening." },
    { ...fact, sourceIndex: 1 },
    { ...fact, sourceIndex: "0" },
    { ...fact, quote: "" },
  ]) {
    assert.throws(() => parsePackageSourceFacts(JSON.stringify({ facts: [invalid] }), "story", [source], [snapshot]));
  }
});

test("source passage references preserve exact punctuation without model transcription", () => {
  const exact = "The author’s prototype took one evening. Getting the feel right took several more weekends.";
  const result = parsePackageSourceFacts(JSON.stringify({ facts: [{ text: fact.text, sourceIndex: 0, passageIndexes: [0] }] }),
    "story", [source], [{ ...snapshot, originalText: exact }]);
  assert.deepEqual(result.facts[0]?.quotations, [{ sourceUrl: source.url, text: exact }]);
  assert.throws(() => parsePackageSourceFacts(JSON.stringify({ facts: [{ text: fact.text, sourceIndex: 0, passageIndexes: [999] }] }),
    "story", [source], [snapshot]), /片段/);
});

test("a percentage invented while summarizing a valid source passage is rejected", () => {
  const exact = "On analyses like these, the optimized models cut estimated GPU costs by 30–60%.";
  assert.throws(() => parsePackageSourceFacts(JSON.stringify({ facts: [{
    text: "文中测试称，优化后的模型让估算 GPU 成本下降 30% 到 70%。", sourceIndex: 0, passageIndexes: [0],
  }] }), "story", [source], [{ ...snapshot, originalText: exact }]), /70/);
});

test("long source passages remain exact and support numbers with thousands separators", () => {
  const body = `${"Introductory context. ".repeat(400)}The author moved 34,000 lines to Godot 4. The prototype took one evening.`;
  const passages = sourceEvidencePassages(body);
  assert.ok(passages.length > 4);
  assert.ok(passages.every((passage) => body.includes(passage) && passage.length <= 1400));
  const result = parsePackageSourceFacts(JSON.stringify({ facts: [{
    text: "作者称，这次把 34000 行代码迁到了 Godot 4。", sourceIndex: 0, passageIndexes: [passages.length - 1],
  }] }), "story", [source], [{ ...snapshot, originalText: body }]);
  assert.ok(result.facts[0]?.quotations?.[0]?.text.includes("34,000"));
});

test("English number words and written month names keep their values in Chinese facts", () => {
  const body = "It sped up seven models. This is available for internal use through December 31, 2026.";
  const result = parsePackageSourceFacts(JSON.stringify({ facts: [{
    text: "文中说它加速了 7 个模型，内部使用期限至 2026 年 12 月 31 日。", sourceIndex: 0, passageIndexes: [0],
  }] }), "story", [source], [{ ...snapshot, originalText: body }]);
  assert.equal(result.facts.length, 1);
});

test("one bounded correction receives all failed fact indexes and never accepts invalid output", async () => {
  const body = "The estimated GPU cost reduction is 30–60%. The measured accuracy is 54.9%.";
  const bad = { facts: [
    { text: "文中测试称，估算 GPU 成本降低了 30% 至 70%。", sourceIndex: 0, passageIndexes: [0] },
    { text: "文中给出的实测准确率是 70.5%。", sourceIndex: 0, passageIndexes: [0] },
  ] };
  const good = { facts: [{ ...bad.facts[0], text: "文中测试称，估算 GPU 成本降低了 30% 至 60%。" }] };
  let calls = 0;
  const result = await generateVerifiedPackageFacts("story", [source], [{ ...snapshot, originalText: body }], async (correction) => {
    calls += 1;
    if (calls === 2) {
      assert.deepEqual(correction?.errors.map((item) => item.factIndex), [0, 1]);
      assert.equal(correction?.previousOutput, JSON.stringify(bad));
    }
    return JSON.stringify(calls === 1 ? bad : good);
  });
  assert.equal(calls, 2);
  assert.equal(result.facts[0]?.text, good.facts[0]?.text);
  calls = 0;
  await assert.rejects(generateVerifiedPackageFacts("story", [source], [{ ...snapshot, originalText: body }], async () => {
    calls += 1; return JSON.stringify(bad);
  }), /70/);
  assert.equal(calls, 2);
});

test("duplicate facts retain evidence from both sources without multiplying the coverage target", () => {
  const second = { ...source, signalId: "run:two", url: "https://second.example/port" };
  const result = parsePackageSourceFacts(JSON.stringify({ facts: [fact, { ...fact, sourceIndex: 1 }] }), "story",
    [source, second], [snapshot, { ...snapshot, signalId: second.signalId, url: second.url }]);
  assert.equal(result.facts.length, 1);
  assert.deepEqual(result.facts[0]?.sourceUrls, [source.url, second.url]);
  assert.equal(result.facts[0]?.quotations?.length, 2);
});

test("article source selection spends the second slot on another source rather than an old discovery wrapper", () => {
  const original: StorySignalView = { runId: "new", candidateId: "launch", sourceName: "Publisher", sourceRole: "official",
    sourceType: "rss", title: "Introducing Model", url: "https://publisher.example/model", briefingBasis: "full-source",
    publishedAt: "2026-09-03T00:00:00Z", fetchedAt: "2026-09-05T00:00:00Z", isCommunity: false, factBearing: true, drafted: false };
  const signals = [
    { ...original, candidateId: "pricing", sourceType: "model-research", title: "Pricing", url: "https://publisher.example/pricing" },
    { ...original, runId: "old", url: "https://news.google.com/rss/articles/launch", briefingBasis: "title" as const },
    original,
    { ...original, candidateId: "report", sourceRole: "verification" as const, title: "Testing the new Model", url: "https://media.example/model" },
  ];
  assert.deepEqual(selectStoryArticleSources({ originalTitle: original.title, signals }).map((item) => item.url),
    [original.url, "https://media.example/model"]);
});
