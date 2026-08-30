import { randomUUID } from "node:crypto";
import type {
  WorkflowNotification,
  WorkflowNotificationPage,
  WorkflowNotificationSeverity,
  WorkflowNotificationType,
} from "./types.js";

export const MAX_WORKFLOW_NOTIFICATIONS = 100;

const notificationTypes = new Set<WorkflowNotificationType>([
  "collection-complete",
  "collection-failed",
  "high-score-candidate",
  "ai-failed",
  "publisher-offline",
]);
const notificationSeverities = new Set<WorkflowNotificationSeverity>([
  "info",
  "success",
  "warning",
  "error",
]);
const notificationPages = new Set<WorkflowNotificationPage>([
  "workbench",
  "drafts",
  "sources",
  "schedule",
  "runs",
  "ai-settings",
]);

const validIsoDate = (value: unknown): value is string =>
  typeof value === "string" && Number.isFinite(Date.parse(value));

const compactText = (value: unknown, maximum: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maximum) : "";

const normalizeNotification = (value: unknown): WorkflowNotification | undefined => {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<WorkflowNotification>;
  const id = compactText(record.id, 160);
  const title = compactText(record.title, 120);
  const message = compactText(record.message, 500);
  if (
    record.schemaVersion !== "workflow-notification/v1"
    || !id
    || !title
    || !message
    || !notificationTypes.has(record.type as WorkflowNotificationType)
    || !notificationSeverities.has(record.severity as WorkflowNotificationSeverity)
    || !validIsoDate(record.createdAt)
  ) return undefined;

  const target = record.target
    && notificationPages.has(record.target.page as WorkflowNotificationPage)
    ? {
        page: record.target.page as WorkflowNotificationPage,
        ...(compactText(record.target.runId, 160) ? { runId: compactText(record.target.runId, 160) } : {}),
        ...(compactText(record.target.draftId, 160) ? { draftId: compactText(record.target.draftId, 160) } : {}),
      }
    : undefined;

  return {
    schemaVersion: "workflow-notification/v1",
    id,
    type: record.type as WorkflowNotificationType,
    severity: record.severity as WorkflowNotificationSeverity,
    title,
    message,
    createdAt: new Date(record.createdAt).toISOString(),
    ...(validIsoDate(record.readAt) ? { readAt: new Date(record.readAt).toISOString() } : {}),
    ...(compactText(record.dedupeKey, 200) ? { dedupeKey: compactText(record.dedupeKey, 200) } : {}),
    ...(target ? { target } : {}),
  };
};

export const normalizeWorkflowNotifications = (value: unknown): WorkflowNotification[] => {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeNotification)
    .filter((item): item is WorkflowNotification => Boolean(item))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, MAX_WORKFLOW_NOTIFICATIONS);
};

export type WorkflowNotificationInput = Pick<
  WorkflowNotification,
  "type" | "severity" | "title" | "message"
> & Pick<Partial<WorkflowNotification>, "dedupeKey" | "target">;

export interface NotificationCreationOptions {
  id?: string;
  createdAt?: string;
}

export const appendWorkflowNotification = (
  state: { notifications: WorkflowNotification[] },
  input: WorkflowNotificationInput,
  options: NotificationCreationOptions = {},
): WorkflowNotification => {
  state.notifications = normalizeWorkflowNotifications(state.notifications);
  const dedupeKey = compactText(input.dedupeKey, 200);
  const existing = dedupeKey
    ? state.notifications.find((notification) => notification.dedupeKey === dedupeKey && !notification.readAt)
    : undefined;
  if (existing) return existing;

  const createdAt = validIsoDate(options.createdAt)
    ? new Date(options.createdAt).toISOString()
    : new Date().toISOString();
  const notification = normalizeNotification({
    schemaVersion: "workflow-notification/v1",
    id: options.id || randomUUID(),
    ...input,
    createdAt,
  });
  if (!notification) throw new Error("通知内容不完整");
  state.notifications = normalizeWorkflowNotifications([notification, ...state.notifications]);
  return notification;
};

export const markWorkflowNotificationRead = (
  state: { notifications: WorkflowNotification[] },
  notificationId: string,
  readAt = new Date().toISOString(),
) => {
  const target = state.notifications.find((notification) => notification.id === notificationId);
  if (!target) return undefined;
  if (!target.readAt) target.readAt = new Date(readAt).toISOString();
  return target;
};

export const markAllWorkflowNotificationsRead = (
  state: { notifications: WorkflowNotification[] },
  readAt = new Date().toISOString(),
) => {
  const timestamp = new Date(readAt).toISOString();
  let updated = 0;
  for (const notification of state.notifications) {
    if (notification.readAt) continue;
    notification.readAt = timestamp;
    updated += 1;
  }
  return updated;
};
