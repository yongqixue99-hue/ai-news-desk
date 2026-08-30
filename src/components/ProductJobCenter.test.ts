import assert from "node:assert/strict";
import test from "node:test";
import { jobProgressPercent } from "./ProductJobCenter.js";

test("job progress converts the persisted zero-to-one fraction into a user-facing percentage", () => {
  assert.equal(jobProgressPercent(0), 0);
  assert.equal(jobProgressPercent(0.96), 96);
  assert.equal(jobProgressPercent(1), 100);
});
