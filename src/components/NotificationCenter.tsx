import { useEffect, useRef } from "react";
import {
  Bell,
  BellOff,
  Check,
  CheckCheck,
  CircleAlert,
  Inbox,
  RadioTower,
  Sparkles,
  WifiOff,
  X,
  type LucideIcon,
} from "lucide-react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import type { WorkflowNotification } from "../types";

interface NotificationCenterProps {
  open: boolean;
  notifications: WorkflowNotification[];
  muted: boolean;
  onClose: () => void;
  onMarkRead: (notificationId: string) => void | Promise<void>;
  onMarkAllRead: () => void | Promise<void>;
  onToggleMuted: (muted: boolean) => void | Promise<void>;
  onOpenNotification: (notification: WorkflowNotification) => void;
}

const notificationMeta: Record<
  WorkflowNotification["type"],
  { label: string; icon: LucideIcon }
> = {
  "collection-complete": { label: "采集完成", icon: RadioTower },
  "collection-failed": { label: "采集失败", icon: CircleAlert },
  "high-score-candidate": { label: "高分候选", icon: Sparkles },
  "ai-failed": { label: "AI 失败", icon: CircleAlert },
  "publisher-offline": { label: "发布助手离线", icon: WifiOff },
};

const formatNotificationTime = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  return date.toLocaleDateString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const unreadNotificationCount = (notifications: WorkflowNotification[]) =>
  notifications.filter((notification) => !notification.readAt).length;

export const notificationBadgeCount = (notifications: WorkflowNotification[], muted: boolean) =>
  muted ? 0 : unreadNotificationCount(notifications);

export function NotificationCenter({
  open,
  notifications,
  muted,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onToggleMuted,
  onOpenNotification,
}: NotificationCenterProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLElement>({
    open,
    onClose,
    initialFocusRef: closeButtonRef,
  });
  const unreadCount = unreadNotificationCount(notifications);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="notification-center-layer">
      <div className="notification-center-backdrop" aria-hidden="true" onMouseDown={onClose} />
      <section
        ref={dialogRef}
        id="notification-center"
        className={`notification-center-drawer${muted ? " notifications-muted" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="notification-center-title"
        tabIndex={-1}
      >
        <header className="notification-center-header">
          <div>
            <span className="notification-center-kicker"><Bell size={14} aria-hidden="true" /> 通知中心</span>
            <h2 id="notification-center-title">工作流动态</h2>
            <p>{unreadCount ? `${unreadCount} 条未读，仅记录需要回看的事件` : "没有未读通知"}</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="notification-center-close"
            aria-label="关闭通知中心"
            onClick={onClose}
          >
            <X size={19} />
          </button>
        </header>

        <div className="notification-center-toolbar">
          <span>最近 {notifications.length} 条</span>
          <div className="notification-center-toolbar-actions">
            <button
              type="button"
              className={muted ? "notification-mute-toggle active" : "notification-mute-toggle"}
              aria-pressed={muted}
              title="只隐藏红点和主动提醒，通知记录仍保留在这里"
              onClick={() => void onToggleMuted(!muted)}
            >
              <BellOff size={15} aria-hidden="true" /> {muted ? "恢复提醒" : "屏蔽通知"}
            </button>
            <button
              type="button"
              disabled={unreadCount === 0}
              onClick={() => void onMarkAllRead()}
            >
              <CheckCheck size={15} aria-hidden="true" /> 全部已读
            </button>
          </div>
        </div>

        <div className="notification-center-list" aria-label="通知列表">
          {notifications.length === 0 ? (
            <div className="notification-center-empty">
              <Inbox size={28} aria-hidden="true" />
              <strong>暂时没有通知</strong>
              <span>采集、成稿和发布连接的重要结果会保留在这里。</span>
            </div>
          ) : notifications.map((notification) => {
            const meta = notificationMeta[notification.type];
            const Icon = meta.icon;
            const unread = !notification.readAt;
            return (
              <article
                key={notification.id}
                className={`notification-center-item severity-${notification.severity}${unread ? " unread" : ""}`}
                aria-label={`${meta.label}：${notification.title}${unread ? "，未读" : ""}`}
              >
                <span className="notification-center-icon" aria-hidden="true"><Icon size={17} /></span>
                <div className="notification-center-copy">
                  <div className="notification-center-item-meta">
                    <span>{meta.label}</span>
                    <time dateTime={notification.createdAt}>{formatNotificationTime(notification.createdAt)}</time>
                  </div>
                  <h3>{notification.title}</h3>
                  <p>{notification.message}</p>
                  <div className="notification-center-actions">
                    {notification.target ? (
                      <button
                        type="button"
                        className="notification-center-open"
                        onClick={() => {
                          if (unread) void onMarkRead(notification.id);
                          onOpenNotification(notification);
                        }}
                      >
                        查看相关内容
                      </button>
                    ) : null}
                    {unread ? (
                      <button
                        type="button"
                        className="notification-center-read"
                        onClick={() => void onMarkRead(notification.id)}
                      >
                        <Check size={14} aria-hidden="true" /> 标为已读
                      </button>
                    ) : <span className="notification-center-read-state"><Check size={13} aria-hidden="true" /> 已读</span>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
