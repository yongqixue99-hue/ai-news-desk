import assert from "node:assert/strict";
import test from "node:test";
import {
  appendWorkflowNotification,
  markAllWorkflowNotificationsRead,
  markWorkflowNotificationRead,
  normalizeWorkflowNotifications,
} from "./notifications.js";
import { createDefaultState, upgradeState } from "./defaults.js";
import type { WorkflowNotification } from "./types.js";

const notification = (
  id: string,
  createdAt: string,
  overrides: Partial<WorkflowNotification> = {},
): WorkflowNotification => ({
  schemaVersion: "workflow-notification/v1",
  id,
  type: "collection-complete",
  severity: "success",
  title: `通知 ${id}`,
  message: "采集完成",
  createdAt,
  ...overrides,
});

test("normalizes a missing legacy notification collection", () => {
  assert.deepEqual(normalizeWorkflowNotifications(undefined), []);
  assert.deepEqual(normalizeWorkflowNotifications({}), []);
});

test("workflow state upgrade initializes notifications for older saved state", () => {
  const legacy = createDefaultState() as unknown as Record<string, unknown>;
  delete legacy.notifications;
  const upgraded = upgradeState(legacy as never);
  assert.equal(upgraded.version, createDefaultState().version);
  assert.deepEqual(upgraded.notifications, []);
  assert.equal(upgraded.settings.notificationsMuted, true);
});

test("normalization keeps the newest 100 valid records", () => {
  const records = Array.from({ length: 105 }, (_, index) =>
    notification(`n-${index}`, new Date(Date.UTC(2026, 7, 1, 0, index)).toISOString()),
  );
  const normalized = normalizeWorkflowNotifications(records);
  assert.equal(normalized.length, 100);
  assert.equal(normalized[0]?.id, "n-104");
  assert.equal(normalized.at(-1)?.id, "n-5");
});

test("append deduplicates an unread event but permits a later recurrence after it is read", () => {
  const state = { notifications: [] as WorkflowNotification[] };
  const first = appendWorkflowNotification(state, {
    type: "publisher-offline",
    severity: "error",
    title: "发布助手离线",
    message: "请重新连接扩展。",
    dedupeKey: "publisher-offline",
  }, { id: "first", createdAt: "2026-08-13T12:00:00.000Z" });
  const duplicate = appendWorkflowNotification(state, {
    type: "publisher-offline",
    severity: "error",
    title: "发布助手仍离线",
    message: "请重新连接扩展。",
    dedupeKey: "publisher-offline",
  }, { id: "duplicate", createdAt: "2026-08-13T12:01:00.000Z" });

  assert.equal(duplicate.id, first.id);
  assert.equal(state.notifications.length, 1);

  markWorkflowNotificationRead(state, first.id, "2026-08-13T12:02:00.000Z");
  const recurrence = appendWorkflowNotification(state, {
    type: "publisher-offline",
    severity: "error",
    title: "发布助手再次离线",
    message: "请重新连接扩展。",
    dedupeKey: "publisher-offline",
  }, { id: "recurrence", createdAt: "2026-08-13T12:03:00.000Z" });

  assert.equal(recurrence.id, "recurrence");
  assert.equal(state.notifications.length, 2);
});

test("read helpers mark one or all records without changing already-read timestamps", () => {
  const state = {
    notifications: [
      notification("unread-a", "2026-08-13T12:00:00.000Z"),
      notification("read", "2026-08-13T11:00:00.000Z", { readAt: "2026-08-13T11:30:00.000Z" }),
      notification("unread-b", "2026-08-13T10:00:00.000Z"),
    ],
  };

  assert.equal(markWorkflowNotificationRead(state, "unread-a", "2026-08-13T12:05:00.000Z")?.readAt, "2026-08-13T12:05:00.000Z");
  assert.equal(markAllWorkflowNotificationsRead(state, "2026-08-13T12:10:00.000Z"), 1);
  assert.equal(state.notifications[1]?.readAt, "2026-08-13T11:30:00.000Z");
  assert.equal(state.notifications[2]?.readAt, "2026-08-13T12:10:00.000Z");
});
