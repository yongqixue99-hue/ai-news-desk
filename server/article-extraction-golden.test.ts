import assert from "node:assert/strict";
import test from "node:test";
import { runArticleExtractionGoldenSet } from "./article-extraction-golden.js";

test("source extraction golden set preserves conditions and refuses event contamination", async () => {
  const report = await runArticleExtractionGoldenSet();
  assert.equal(report.passed, report.total, JSON.stringify(report.results.filter((result) => !result.passed)));
});
