import assert from "node:assert/strict";
import test from "node:test";
import { chooseWorkbenchRun } from "./workbench-run";
import type { WorkflowRun } from "./types";
const run = (id: string, origin?: WorkflowRun["origin"]): WorkflowRun => ({
  id, origin, createdAt: "2026-09-09T00:00:00Z", updatedAt: "2026-09-09T00:00:00Z", status: "ready", stage: "完成", windowHours: 48, sourceIds: [], scheduled: false, rawCount: 1, candidates: [], logs: [],
});
test("background evidence collection cannot replace the main news list on reload", () => {
  const collection = run("news", "collection");
  const supplement = run("evidence", "evidence-supplement");
  assert.equal(chooseWorkbenchRun([supplement, collection])?.id, "news");
  assert.equal(chooseWorkbenchRun([supplement]), undefined);
  assert.equal(chooseWorkbenchRun([run("intake", "link-intake"), collection])?.id, "news");
});
test("an explicitly opened run is preserved, including a supplement from history", () => {
  const collection = run("news"); const evidence = run("evidence", "evidence-supplement");
  assert.equal(chooseWorkbenchRun([evidence, collection], "evidence")?.id, "evidence");
  assert.equal(chooseWorkbenchRun([evidence, collection], "news")?.id, "news");
  assert.equal(chooseWorkbenchRun([evidence, collection], "deleted")?.id, "news");
});
