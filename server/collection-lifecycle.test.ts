import assert from "node:assert/strict";
import test from "node:test";
import { canApplyCollectionResult, markCollectionReady } from "./collection-lifecycle.js";
import type { WorkflowRun } from "./types.js";

const runWithStatus = (status: WorkflowRun["status"]): WorkflowRun => ({
  id: "run-cancel-race",
  createdAt: "2026-08-30T00:00:00.000Z",
  updatedAt: "2026-08-30T00:00:00.000Z",
  status,
  stage: status === "cancelled" ? "已取消" : "生成中文速读",
  windowHours: 48,
  sourceIds: ["source-1"],
  scheduled: false,
  rawCount: 1,
  candidates: [],
  logs: [],
});

test("cancelled collection rejects late AI results and cannot be revived as ready", () => {
  const run = runWithStatus("cancelled");
  const controller = new AbortController();
  controller.abort();

  assert.equal(canApplyCollectionResult(run, controller.signal), false);
  assert.equal(markCollectionReady(run, "2026-08-30T00:01:00.000Z"), false);
  assert.equal(run.status, "cancelled");
  assert.equal(run.stage, "已取消");
  assert.equal(run.completedAt, undefined);
});

test("active collection can be finalized once", () => {
  const run = runWithStatus("extracting");

  assert.equal(canApplyCollectionResult(run), true);
  assert.equal(markCollectionReady(run, "2026-08-30T00:01:00.000Z"), true);
  assert.equal(run.status, "ready");
  assert.equal(run.stage, "等待选择");
  assert.equal(run.completedAt, "2026-08-30T00:01:00.000Z");
});
