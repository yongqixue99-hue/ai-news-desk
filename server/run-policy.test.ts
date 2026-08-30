import test from "node:test";
import assert from "node:assert/strict";
import { findActiveCollectionRun, scheduleIsDue } from "./run-policy.js";
import type { WorkflowRun } from "./types.js";

const run = (status: WorkflowRun["status"], id: string): WorkflowRun => ({
  id,
  createdAt: "2026-08-11T10:00:00.000Z",
  updatedAt: "2026-08-11T10:00:00.000Z",
  status,
  stage: status,
  windowHours: 24,
  sourceIds: [],
  scheduled: false,
  rawCount: 0,
  candidates: [],
  logs: [],
});

test("collection lock only reuses an actually collecting run", () => {
  const active = findActiveCollectionRun([
    run("complete", "done"),
    run("collecting", "active"),
    run("ready", "ready"),
  ]);
  assert.equal(active?.id, "active");
  assert.equal(findActiveCollectionRun([run("failed", "failed"), run("cancelled", "cancelled")]), undefined);
});

test("scheduler catches up after the configured minute but runs once per day", () => {
  const settings = { scheduleEnabled: true, scheduleTime: "22:30", lastScheduledDate: undefined };
  assert.equal(scheduleIsDue(settings, new Date("2026-08-11T14:29:00.000Z")), false);
  assert.equal(scheduleIsDue(settings, new Date("2026-08-11T14:31:00.000Z")), true);
  assert.equal(
    scheduleIsDue({ ...settings, lastScheduledDate: "2026-08-11" }, new Date("2026-08-11T15:30:00.000Z")),
    false,
  );
});
