import assert from "node:assert/strict";
import test from "node:test";
import { getRovingTabTarget } from "./rovingTabs";

test("horizontal tabs wrap with left and right arrows", () => {
  assert.equal(getRovingTabTarget(2, 0, "ArrowLeft"), 1);
  assert.equal(getRovingTabTarget(2, 1, "ArrowRight"), 0);
  assert.equal(getRovingTabTarget(3, 1, "ArrowLeft"), 0);
});

test("Home and End move to the first and last tab", () => {
  assert.equal(getRovingTabTarget(4, 2, "Home"), 0);
  assert.equal(getRovingTabTarget(4, 1, "End"), 3);
});

test("unhandled keys and empty tab lists do not move focus", () => {
  assert.equal(getRovingTabTarget(2, 1, "Enter"), null);
  assert.equal(getRovingTabTarget(0, 0, "ArrowRight"), null);
});
