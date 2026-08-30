import assert from "node:assert/strict";
import test from "node:test";
import { canTransitionDraft } from "./draft-lifecycle.js";

test("draft lifecycle keeps editorial review reversible but protects delivery states", () => {
  assert.equal(canTransitionDraft("editing", "reviewing"), true);
  assert.equal(canTransitionDraft("reviewing", "ready"), true);
  assert.equal(canTransitionDraft("editing", "published"), false);
  assert.equal(canTransitionDraft("shelved", "filled"), false);
});

test("saving an unchanged lifecycle status never re-validates its original delivery transition", async () => {
  const { assertDraftTransition } = await import("./draft-lifecycle.js");
  assert.doesNotThrow(() => assertDraftTransition({ status: "filled" } as never, "filled"));
  assert.doesNotThrow(() => assertDraftTransition({ status: "published" } as never, "published"));
});
