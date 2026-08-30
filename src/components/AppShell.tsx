import { useEffect, useState } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  Compass,
  FilePenLine,
  MessagesSquare,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Settings2,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AppPage, WorkflowNotification } from "../types";
import { NotificationCenter, unreadNotificationCount } from "./NotificationCenter";

const SHELL_PREFERENCE_KEY = "ai-news-desk:shell:v1";

const navigation: Array<{ id: AppPage; label: string; icon: LucideIcon }> = [
  { id: "today", label: "今日", icon: CalendarDays },
  { id: "workbench", label: "新闻工作台", icon: Newspaper },
  { id: "community", label: "社区广场", icon: MessagesSquare },
  { id: "drafts", label: "草稿", icon: FilePenLine },
  { id: "sources", label: "新闻源", icon: Radio },
  { id: "editorial-system", label: "内容策略", icon: Compass },
];

interface AppShellProps {
  page: AppPage;
  onNavigate: (page: AppPage) => void;
  notifications: WorkflowNotification[];
  notificationsMuted: boolean;
  onToggleNotificationsMuted: (muted: boolean) => void | Promise<void>;
  onMarkNotificationRead: (notificationId: string) => void | Promise<void>;
  onMarkAllNotificationsRead: () => void | Promise<void>;
  onOpenNotification: (notification: WorkflowNotification) => void;
  children: React.ReactNode;
}

const getInitialCollapsed = () => {
  try {
    const saved = window.localStorage.getItem(SHELL_PREFERENCE_KEY);
    return saved ? Boolean((JSON.parse(saved) as { collapsed?: boolean }).collapsed) : true;
  } catch {
    return true;
  }
};

export function AppShell({
  page,
  onNavigate,
  notifications,
  notificationsMuted,
  onToggleNotificationsMuted,
  onMarkNotificationRead,
  onMarkAllNotificationsRead,
  onOpenNotification,
  children,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const automationActive = page === "schedule" || page === "runs";
  const unreadCount = unreadNotificationCount(notifications);
  const badgeCount = notificationsMuted ? 0 : unreadCount;
  const notificationLabel = notificationsMuted
    ? `通知提醒已屏蔽，点击查看${unreadCount ? `，有 ${unreadCount} 条未读` : ""}`
    : unreadCount ? `打开通知中心，${unreadCount} 条未读` : "打开通知中心，没有未读通知";

  useEffect(() => {
    window.localStorage.setItem(SHELL_PREFERENCE_KEY, JSON.stringify({ collapsed }));
  }, [collapsed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      event.preventDefault();
      setCollapsed((current) => !current);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const navigate = (nextPage: AppPage) => {
    onNavigate(nextPage);
  };

  const focusMainContent = (event: React.SyntheticEvent) => {
    event.preventDefault();
    window.requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  };

  return (
    <div className={`app-shell ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
      <a
        className="skip-to-content"
        href="#main-content"
        onClick={focusMainContent}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") focusMainContent(event);
        }}
      >
        跳到主要内容
      </a>
      <aside id="app-sidebar" className="main-sidebar">
        <div className="sidebar-brand-row">
          <button
            type="button"
            className="brand"
            aria-label={collapsed ? "展开侧栏" : "返回今日编辑台"}
            aria-controls="app-sidebar"
            aria-expanded={!collapsed}
            title={collapsed ? "展开侧栏（⌘/Ctrl+B）" : "返回今日编辑台"}
            onClick={() => collapsed ? setCollapsed(false) : navigate("today")}
          >
            <span className="brand-mark" aria-hidden="true">{collapsed ? <PanelLeftOpen size={18} /> : <Newspaper size={20} />}</span>
            <span>AI 新闻台</span>
          </button>
          {!collapsed ? (
            <button
              type="button"
              className="sidebar-toggle"
              aria-label="收起侧栏"
              aria-controls="app-sidebar"
              aria-expanded="true"
              title="收起侧栏（⌘/Ctrl+B）"
              onClick={() => setCollapsed(true)}
            >
              <PanelLeftClose size={17} />
            </button>
          ) : null}
        </div>

        <nav className="main-nav" aria-label="主导航">
          {navigation.map((item) => {
            const Icon = item.icon;
            return (
              <button
                type="button"
                key={item.id}
                className={`${page === item.id ? "nav-item active" : "nav-item"} nav-item-${item.id}`}
                aria-label={item.label}
                aria-current={page === item.id ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon size={19} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            );
          })}

          <button
            type="button"
            className={page === "ai-settings" ? "nav-item active mobile-ai-nav" : "nav-item mobile-ai-nav"}
            aria-label="AI 设置"
            aria-current={page === "ai-settings" ? "page" : undefined}
            title={collapsed ? "AI 设置" : undefined}
            onClick={() => navigate("ai-settings")}
          >
            <Bot size={19} strokeWidth={1.8} />
            <span>AI 设置</span>
          </button>

          <div className="automation-nav">
            <button
              type="button"
              className={automationActive ? "nav-item active" : "nav-item"}
              aria-label={page === "runs" ? "自动化，当前为运行记录" : "自动化"}
              aria-current={automationActive ? "page" : undefined}
              title={collapsed ? (page === "runs" ? "自动化 · 运行记录" : "自动化") : undefined}
              onClick={() => navigate("schedule")}
            >
              <Zap size={19} strokeWidth={1.8} />
              <span>自动化</span>
            </button>
          </div>
        </nav>

        <div className="sidebar-footer">
          <button
            type="button"
            className="nav-item notification-nav-item"
            aria-label={notificationLabel}
            aria-haspopup="dialog"
            aria-controls="notification-center"
            aria-expanded={notificationsOpen}
            title={collapsed ? notificationLabel : undefined}
            onClick={() => setNotificationsOpen(true)}
          >
            <span className="notification-bell-icon">
              <Bell size={19} strokeWidth={1.8} />
              {badgeCount ? <span className="notification-badge" aria-hidden="true">{badgeCount > 99 ? "99+" : badgeCount}</span> : null}
            </span>
            <span>通知</span>
          </button>
          <button type="button" className={page === "ai-settings" ? "nav-item sidebar-settings active" : "nav-item sidebar-settings"} aria-label="AI 设置" aria-current={page === "ai-settings" ? "page" : undefined} title={collapsed ? "AI 设置" : undefined} onClick={() => navigate("ai-settings")}>
            <Settings2 size={19} strokeWidth={1.8} />
            <span>AI 设置</span>
          </button>
          <div className="sidebar-profile" title="本地工作台">
            <span><UserRound size={17} /></span>
            <div><strong>本地工作台</strong><small>仅在这台电脑运行</small></div>
          </div>
        </div>
      </aside>
      <button
        type="button"
        className="mobile-notification-button"
        aria-label={notificationLabel}
        aria-haspopup="dialog"
        aria-controls="notification-center"
        aria-expanded={notificationsOpen}
        onClick={() => setNotificationsOpen(true)}
      >
        <Bell size={18} />
        {badgeCount ? <span className="notification-badge" aria-hidden="true">{badgeCount > 99 ? "99+" : badgeCount}</span> : null}
      </button>
      <main id="main-content" className="app-main" tabIndex={-1}>{children}</main>
      <NotificationCenter
        open={notificationsOpen}
        notifications={notifications}
        muted={notificationsMuted}
        onClose={() => setNotificationsOpen(false)}
        onMarkRead={onMarkNotificationRead}
        onMarkAllRead={onMarkAllNotificationsRead}
        onToggleMuted={onToggleNotificationsMuted}
        onOpenNotification={(notification) => {
          onOpenNotification(notification);
          setNotificationsOpen(false);
        }}
      />
    </div>
  );
}
