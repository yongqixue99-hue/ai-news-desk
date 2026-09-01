import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import { SchedulePage } from "./SchedulePage.js";

test("data migration keeps full-archive import hidden until a read-only preview succeeds", () => {
  const state = createDefaultState();
  const markup = renderToStaticMarkup(createElement(SchedulePage, {
    settings: state.settings,
    runs: [],
    onSettings: () => undefined,
    onRefreshHealth: () => undefined,
    onLaunchPublisher: () => undefined,
    onOpenRuns: () => undefined,
    onLoadStorageUsage: async () => ({ stateBytes: 0, backupBytes: 0, databaseBytes: 0, legacyStateBytes: 0, mediaBytes: 0, materialBytes: 0, jobBytes: 0, totalBytes: 0 }),
    onExportData: async () => undefined,
    onExportPortableArchive: async () => undefined,
    onInspectPortableArchive: async () => ({}) as never,
    onImportPortableArchive: async () => ({}) as never,
    onRestoreData: async () => undefined,
    onSaveWeChatSettings: async () => state.settings.wechat,
    onTestWeChatConnection: async () => ({ ok: false, status: "error" as const, checkedAt: "2026-09-01T00:00:00.000Z", detail: "not configured" }),
  }));

  assert.match(markup, /预检完整归档/u);
  assert.match(markup, /只读预检/u);
  assert.match(markup, /尚未导入/u);
  assert.doesNotMatch(markup, /确认覆盖并导入/u);
});
