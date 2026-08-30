import assert from "node:assert/strict";
import test from "node:test";
import { retainRecentAndReferencedRuns } from "./run-retention.js";
import type { WorkflowRun } from "./types.js";

const run = (id: string): WorkflowRun => ({
  id,
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  status: "ready",
  stage: "等待选择",
  windowHours: 48,
  sourceIds: [],
  scheduled: false,
  rawCount: 0,
  candidates: [],
  logs: [],
});

test("run retention keeps the recent window plus older runs referenced by durable drafts", () => {
  const runs = Array.from({ length: 35 }, (_, index) => run(`run-${index}`));
  const retained = retainRecentAndReferencedRuns(runs, new Set(["run-34"]), 30);

  assert.equal(retained.length, 31);
  assert.equal(retained[0].id, "run-0");
  assert.ok(retained.some((entry) => entry.id === "run-34"));
  assert.equal(new Set(retained.map((entry) => entry.id)).size, retained.length);
});
