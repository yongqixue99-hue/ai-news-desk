import assert from "node:assert/strict";
import test from "node:test";
import { editorialGoldenCases, runEditorialGoldenSet } from "./editorial-golden-set.js";

test("the editorial golden set keeps all twenty-two manually labeled cases green", () => {
  const report = runEditorialGoldenSet();

  assert.equal(editorialGoldenCases.length, 22);
  assert.equal(report.total, 22);
  assert.equal(report.passed, 22);
  assert.equal(report.failed, 0);
  assert.deepEqual(report.failures, []);
});

test("the golden set covers news, community, source preservation, writing and visual failures", () => {
  const categories = new Set(editorialGoldenCases.map((entry) => entry.category));
  assert.deepEqual([...categories].sort(), ["community", "news", "source", "visual", "writing"]);
  assert.equal(editorialGoldenCases.some((entry) => entry.expectedReady), true);
  assert.equal(editorialGoldenCases.some((entry) => !entry.expectedReady), true);
});
