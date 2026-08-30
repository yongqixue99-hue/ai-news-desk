import assert from "node:assert/strict";
import test from "node:test";
import { getNextFocusIndex } from "./useDialogA11y";

test("focus wrapping keeps Tab inside the dialog", () => {
  assert.equal(getNextFocusIndex(3, 2, 1), 0);
  assert.equal(getNextFocusIndex(3, 0, -1), 2);
  assert.equal(getNextFocusIndex(3, 1, 1), 2);
});

test("focus wrapping handles an element that is not in the current focus list", () => {
  assert.equal(getNextFocusIndex(3, -1, 1), 0);
  assert.equal(getNextFocusIndex(3, -1, -1), 2);
  assert.equal(getNextFocusIndex(0, -1, 1), -1);
});
