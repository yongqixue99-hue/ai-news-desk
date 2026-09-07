import assert from "node:assert/strict";
import test from "node:test";
import { dueOfficialSources } from "./official-source-monitor.js";
import { createDefaultState } from "./defaults.js";
test("official polling respects opt-out, source selection, technical cadence and failure backoff", () => {
  const state = createDefaultState();
  const now = Date.parse("2026-09-07T08:00:00Z");
  const source = { ...state.sources.find(source => source.id === "openai-official")!, lastCheckedAt: "2026-09-07T06:00:00Z" };
  assert.equal(dueOfficialSources([source], state.settings, now).length, 1);
  assert.equal(dueOfficialSources([{ ...source, selected: false }], state.settings, now).length, 0);
  assert.equal(dueOfficialSources([{ ...source, consecutiveFailures: 2 }], state.settings, now).length, 0);
  assert.equal(dueOfficialSources([{ ...source, kind: "documentation" }], state.settings, now).length, 0);
  assert.equal(dueOfficialSources([source], { ...state.settings, officialMonitorEnabled: false }, now).length, 0);
});
