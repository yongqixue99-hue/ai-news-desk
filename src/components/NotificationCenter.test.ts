import assert from "node:assert/strict";
import test from "node:test";
import { notificationBadgeCount, unreadNotificationCount } from "./NotificationCenter.js";
import type { WorkflowNotification } from "../types.js";

const item = (id: string, readAt?: string): WorkflowNotification => ({
  schemaVersion: "workflow-notification/v1",
  id,
  type: "collection-complete",
  severity: "success",
  title: "采集完成",
  message: "有新的候选新闻",
  createdAt: "2026-08-13T12:00:00.000Z",
  readAt,
});

test("bell count includes only unread persistent notifications", () => {
  const notifications = [
    item("a"),
    item("b", "2026-08-13T12:10:00.000Z"),
    item("c"),
  ];
  assert.equal(unreadNotificationCount(notifications), 2);
  assert.equal(notificationBadgeCount(notifications, false), 2);
  assert.equal(notificationBadgeCount(notifications, true), 0);
});
