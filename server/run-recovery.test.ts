import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { clearResolvedCollectionFailures, clearRetriedCollectionFailures } from "./run-recovery.js";

test("a successful collection clears its stale interruption error and failure notification", () => {
  const state = createDefaultState();
  state.runs.push({
    id: "run-success",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:01:00.000Z",
    completedAt: "2026-08-13T10:01:00.000Z",
    status: "ready",
    stage: "等待选择",
    windowHours: 24,
    sourceIds: ["openai-official"],
    scheduled: false,
    rawCount: 2,
    candidates: [],
    logs: [],
    error: "服务在任务完成前退出；可以从运行记录重新执行",
  });
  state.notifications.push({
    schemaVersion: "workflow-notification/v1",
    id: "false-failure",
    type: "collection-failed",
    severity: "error",
    title: "新闻采集任务中断",
    message: "服务在采集完成前退出，可以从运行记录重新执行。",
    createdAt: "2026-08-13T10:00:30.000Z",
    target: { page: "runs", runId: "run-success" },
  });

  const removed = clearResolvedCollectionFailures(state, "run-success");

  assert.equal(removed, 1);
  assert.equal(state.runs[0]?.error, undefined);
  assert.equal(state.notifications.length, 0);
});

test("a successful retry clears the original failure notification but keeps the failed run", () => {
  const state = createDefaultState();
  state.runs.push({
    id: "run-original",
    createdAt: "2026-08-13T10:00:00.000Z",
    updatedAt: "2026-08-13T10:01:00.000Z",
    completedAt: "2026-08-13T10:01:00.000Z",
    status: "failed",
    stage: "上次运行中断",
    windowHours: 24,
    sourceIds: ["openai-official"],
    scheduled: false,
    rawCount: 0,
    candidates: [],
    logs: [],
    error: "服务在任务完成前退出；可以从运行记录重新执行",
  }, {
    id: "run-retry",
    createdAt: "2026-08-13T10:02:00.000Z",
    updatedAt: "2026-08-13T10:03:00.000Z",
    completedAt: "2026-08-13T10:03:00.000Z",
    status: "ready",
    stage: "等待选择",
    windowHours: 24,
    sourceIds: ["openai-official"],
    scheduled: false,
    retryOfRunId: "run-original",
    rawCount: 0,
    candidates: [],
    logs: [],
  });
  state.notifications.push({
    schemaVersion: "workflow-notification/v1",
    id: "original-failure",
    type: "collection-failed",
    severity: "error",
    title: "新闻采集任务中断",
    message: "服务在采集完成前退出，可以从运行记录重新执行。",
    createdAt: "2026-08-13T10:01:00.000Z",
    target: { page: "runs", runId: "run-original" },
  });

  const removed = clearRetriedCollectionFailures(state, "run-retry");

  assert.equal(removed, 1);
  assert.equal(state.runs.find((run) => run.id === "run-original")?.status, "failed");
  assert.equal(state.notifications.length, 0);
});
