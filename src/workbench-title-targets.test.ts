import assert from "node:assert/strict";
import test from "node:test";
import type { Candidate } from "./types";
import { WORKBENCH_TITLE_BATCH, workbenchTitleTargets } from "./workbench-title-targets";

const candidate = (id: string, translated = false) =>
  ({ id, briefing: translated ? { titleZh: "已有中文标题", summaryZh: "", basis: "excerpt" } : undefined }) as unknown as Candidate;

test("manual workbench translation takes untranslated candidates in display order", () => {
  const targets = workbenchTitleTargets([candidate("featured"), undefined, candidate("done", true), candidate("second"), candidate("featured")]);
  assert.deepEqual(targets, ["featured", "second"]);
});

test("one manual request never exceeds the batch limit", () => {
  const many = Array.from({ length: 62 }, (_, index) => candidate(`c${index}`));
  const targets = workbenchTitleTargets(many);
  assert.equal(targets.length, WORKBENCH_TITLE_BATCH);
  assert.deepEqual(targets.slice(0, 2), ["c0", "c1"]);
  assert.deepEqual(workbenchTitleTargets(many.map((entry) => ({ ...entry, briefing: { titleZh: "中", summaryZh: "", basis: "excerpt" } }) as Candidate)), []);
});
