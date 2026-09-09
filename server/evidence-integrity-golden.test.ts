import assert from "node:assert/strict";
import test from "node:test";
import golden from "./fixtures/frozen-fact-integrity-golden.json";
import { runEvidenceIntegrityGoldenSet } from "./evidence-integrity-golden.js";

test("the integrity corpus is bounded, synthetic and includes accepted expressions and contradictions", () => {
  assert.equal(golden.origin, "original-synthetic-regression-cases");
  assert.equal(golden.cases.length, 40);
  assert.equal(new Set(golden.cases.map((item) => item.id)).size, 40);
  assert.ok(golden.cases.every((item) => item.synthetic && item.fact && item.text));
  const report = runEvidenceIntegrityGoldenSet();
  assert.equal(report.passed, 40, JSON.stringify(report.failures));
  assert.equal(report.validTotal, 24);
  assert.equal(report.contradictionTotal, 16);
  for (const category of ["source", "date", "unit", "scope", "quantity", "identity"]) assert.ok(report.categoryCounts[category]?.total);
});

test("the fixed evaluation reports a failed expectation instead of silently omitting it", () => {
  const sample = golden.cases[0]!;
  const report = runEvidenceIntegrityGoldenSet([{ ...sample, expectedPass: false }]);
  assert.equal(report.total, 1);
  assert.equal(report.passed, 0);
  assert.equal(report.failed, 1);
  assert.equal(report.failures[0]?.id, sample.id);
  assert.equal(report.categoryCounts[sample.category]?.passed, 0);
});
