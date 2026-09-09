import assert from "node:assert/strict";
import test from "node:test";
import { newsDiscoveryGoldenCases } from "./fixtures/news-discovery-golden.js";
import { evaluateNewsDiscoveryCase, runNewsDiscoveryGoldenSet } from "./news-discovery-golden.js";

test("discovery corpus separates verified historical facts from synthetic adversarial inputs", () => {
  assert.equal(newsDiscoveryGoldenCases.filter((fixture) => fixture.kind === "historical-positive").length, 22);
  assert.equal(newsDiscoveryGoldenCases.filter((fixture) => fixture.kind === "synthetic-negative").length, 50);
  assert.equal(new Set(newsDiscoveryGoldenCases.map((fixture) => fixture.id)).size, 72);
  for (const fixture of newsDiscoveryGoldenCases) {
    assert.ok(Number.isFinite(Date.parse(fixture.now)), fixture.id);
    if (fixture.kind === "historical-positive") {
      assert.equal(fixture.verification?.url, fixture.items[0].url);
      assert.match(fixture.verification?.dateLabel ?? "", /^202[456]-\d{2}-\d{2}$/u);
      assert.equal(fixture.items[0].publishedAt?.slice(0, 10), fixture.verification?.dateLabel);
      assert.equal(fixture.items[0].misleadingTitleZh, undefined);
    } else assert.match(fixture.label, /^\[合成反例\]/u);
  }
});

for (const fixture of newsDiscoveryGoldenCases) {
  test(`news discovery: ${fixture.id} (${fixture.category})`, () => {
    const result = evaluateNewsDiscoveryCase(fixture);
    assert.deepEqual(result.failures, [], JSON.stringify(result, null, 2));
  });
}

test("discovery report is deterministic with explicit historical clocks", () => {
  assert.deepEqual(runNewsDiscoveryGoldenSet(), runNewsDiscoveryGoldenSet());
});

test("a real announcement stays visible among newer synthetic promotions, recaps, minor updates and rumors", () => {
  const original = newsDiscoveryGoldenCases.find((fixture) => fixture.id === "gemini-2-5")!;
  const noise = newsDiscoveryGoldenCases.filter((fixture) => ["promotion", "digest", "minor-update", "rumor"].includes(fixture.category));
  const result = evaluateNewsDiscoveryCase({
    ...original, id: "mixed-gemini-discovery", now: "2025-03-26T12:00:00.000Z",
    // Deliberately put noise first: same-model matching must not let an older
    // recap or its misleading translation swallow the actual announcement.
    items: [...noise.flatMap((fixture) => fixture.items), ...original.items],
  });
  assert.deepEqual(result.recommendationTitles, [original.items[0].title], JSON.stringify(result, null, 2));
});
