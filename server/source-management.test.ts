import test from "node:test";
import assert from "node:assert/strict";
import { createDefaultState, upgradeState } from "./defaults.js";
import {
  applySourcePreset,
  batchUpdateSources,
  createSourcePreset,
  deleteSourcePreset,
} from "./source-management.js";

test("batch updates only the distinct source ids supplied by the user", () => {
  const state = createDefaultState();
  const [first, second, third] = state.sources;
  first.enabled = false;
  second.enabled = false;
  third.enabled = false;

  const changed = batchUpdateSources(state, [first.id, second.id, first.id, "missing"], {
    enabled: true,
  });

  assert.deepEqual(changed.map((source) => source.id), [first.id, second.id]);
  assert.equal(first.enabled, true);
  assert.equal(second.enabled, true);
  assert.equal(third.enabled, false);
});

test("a source preset persists an exact default collection without changing enabled state", () => {
  const state = createDefaultState();
  state.sourcePresets = [];
  const [first, second, third] = state.sources;
  first.enabled = false;
  first.selected = false;
  second.selected = false;
  third.selected = true;

  const preset = createSourcePreset(state, {
    name: "AI 官方",
    sourceIds: [first.id, second.id, "missing", first.id],
  }, {
    id: "preset_ai",
    now: () => new Date("2026-08-13T12:00:00.000Z"),
  });

  assert.deepEqual(preset.sourceIds, [first.id, second.id]);
  assert.equal(state.sourcePresets.length, 1);

  const selected = applySourcePreset(state, preset.id);
  assert.deepEqual(selected.map((source) => source.id), [first.id, second.id]);
  assert.equal(first.enabled, false);
  assert.equal(first.selected, true);
  assert.equal(second.selected, true);
  assert.equal(third.selected, false);

  assert.equal(deleteSourcePreset(state, preset.id), true);
  assert.equal(state.sourcePresets.length, 0);
  assert.throws(() => applySourcePreset(state, preset.id), /不存在/);
});

test("old workflow state is upgraded with presets and source health streaks", () => {
  const state = createDefaultState();
  const source = state.sources[0];
  source.health = "healthy";
  source.lastCheckedAt = "2026-08-12T12:00:00.000Z";
  delete (state as Partial<typeof state>).sourcePresets;
  delete source.consecutiveFailures;
  delete source.lastSuccessfulAt;

  const upgraded = upgradeState(state);

  assert.deepEqual(upgraded.sourcePresets, []);
  const upgradedSource = upgraded.sources.find((entry) => entry.id === source.id);
  assert.equal(upgradedSource?.consecutiveFailures, 0);
  assert.equal(upgradedSource?.lastSuccessfulAt, "2026-08-12T12:00:00.000Z");
});
