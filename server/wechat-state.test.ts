import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState, upgradeState } from "./defaults.js";

test("new workspaces start with a safe unconfigured WeChat draft channel", () => {
  const state = createDefaultState();

  assert.equal(state.version, 13);
  assert.deepEqual(state.settings.wechat, {
    accountName: "",
    appId: "",
    defaultAuthor: "",
    appSecretConfigured: false,
  });
});

test("legacy state gains WeChat settings without losing existing preferences", () => {
  const legacy = createDefaultState() as unknown as Record<string, unknown>;
  legacy.version = 10;
  const legacySettings = legacy.settings as Record<string, unknown>;
  delete legacySettings.wechat;
  legacySettings.scheduleTime = "21:15";

  const upgraded = upgradeState(legacy as never);

  assert.equal(upgraded.version, 13);
  assert.equal(upgraded.settings.scheduleTime, "21:15");
  assert.deepEqual(upgraded.settings.wechat, {
    accountName: "",
    appId: "",
    defaultAuthor: "",
    appSecretConfigured: false,
  });
});
