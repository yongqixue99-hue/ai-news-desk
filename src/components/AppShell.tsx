import { useEffect, useRef, useState } from "react";
import {
  Bell,
  Bot,
  CalendarDays,
  ChevronRight,
  Compass,
  FilePenLine,
  History,
  MessagesSquare,
  MoreHorizontal,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  Rss,
  Settings2,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AppPage, WorkflowNotification } from "../types";
import { NotificationCenter, unreadNotificationCount } from "./NotificationCenter";

const SHELL_PREFERENCE_KEY = "ai-news-desk:shell:v1";

interface NavigationItem { id: AppPage; label: string; short: string; icon: LucideIcon }
const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "阅读", items: [
    { id: "today", label: "今日", short: "今日", icon: CalendarDays },
    { id: "aggregations", label: "聚合资讯", short: "聚合", icon: Radio },
    { id: "community", label: "社区广场", short: "社区", icon: MessagesSquare },
  ] },
  { label: "创作", items: [
    { id: "workbench", label: "新闻工作台", short: "工作台", icon: Newspaper },
    { id: "drafts", label: "草稿", short: "草稿", icon: FilePenLine },
  ] },
];

const mobileNavigation = [navigationGroups[0].items[0], navigationGroups[1].items[0], navigationGroups[0].items[2], navigationGroups[1].items[1]];

const settingsNavigation: Array<{ id: AppPage; label: string; icon: LucideIcon }> = [
  { id: "sources", label: "新闻源", icon: Rss },
  { id: "editorial-system", label: "内容策略", icon: Compass },
  { id: "schedule", label: "自动化计划", icon: Zap },
  { id: "ai-settings", label: "AI 设置", icon: Bot },
];
const mobileMoreNavigation = [
  { id: "aggregations" as AppPage, label: "聚合资讯", icon: Radio },
  ...settingsNavigation,
  { id: "runs" as AppPage, label: "运行记录", icon: History },
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
    const preference = saved ? JSON.parse(saved) as { collapsed?: boolean } : undefined;
    return typeof preference?.collapsed === "boolean" ? preference.collapsed : false;
  } catch {
    return false;
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
  const [mobile, setMobile] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
  const [collapsed, setCollapsed] = useState(getInitialCollapsed);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const mobileMoreRef = useRef<HTMLDivElement>(null);
  const mobileMoreButtonRef = useRef<HTMLButtonElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const notificationButtonRef = useRef<HTMLButtonElement>(null);
  const activeSettings = settingsNavigation.find(item => item.id === page);
  const mobileMoreActive = mobileMoreNavigation.some((item) => item.id === page);
  const unreadCount = unreadNotificationCount(notifications);
  const badgeCount = notificationsMuted ? 0 : unreadCount;
  const notificationLabel = notificationsMuted
    ? `通知提醒已屏蔽，点击查看${unreadCount ? `，有 ${unreadCount} 条未读` : ""}`
    : unreadCount ? `打开通知中心，${unreadCount} 条未读` : "打开通知中心，没有未读通知";

  useEffect(() => {
    try {
      window.localStorage.setItem(SHELL_PREFERENCE_KEY, JSON.stringify({ collapsed }));
    } catch {
      // Storage restrictions must not prevent reading or editing local articles.
    }
  }, [collapsed]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      event.preventDefault();
      setCollapsed((current) => !current);
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  useEffect(() => {
    if (!mobileMoreOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileMoreOpen(false);
        mobileMoreButtonRef.current?.focus();
      }
    };
    const handleOutside = (event: PointerEvent) => {
      if (!mobileMoreRef.current?.contains(event.target as Node)) setMobileMoreOpen(false);
    };
    window.addEventListener("keydown", handleEscape);
    window.addEventListener("pointerdown", handleOutside);
    return () => {
      window.removeEventListener("keydown", handleEscape);
      window.removeEventListener("pointerdown", handleOutside);
    };
  }, [mobileMoreOpen]);

  useEffect(() => {
    if (!settingsOpen) return;
    const frame = window.requestAnimationFrame(() => settingsRef.current?.querySelector<HTMLButtonElement>(".sidebar-tools-panel button")?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setSettingsOpen(false);
      settingsButtonRef.current?.focus();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, [settingsOpen]);

  useEffect(() => { setMobileMoreOpen(false); setSettingsOpen(false); }, [page]);

  useEffect(() => {
    const viewport = window.matchMedia("(max-width: 720px)");
    const closeMenus = () => { setMobile(viewport.matches); setMobileMoreOpen(false); setSettingsOpen(false); };
    viewport.addEventListener("change", closeMenus);
    return () => viewport.removeEventListener("change", closeMenus);
  }, []);

  const navigate = (nextPage: AppPage) => {
    const fromMenu = mobileMoreOpen || settingsOpen;
    setMobileMoreOpen(false);
    setSettingsOpen(false);
    onNavigate(nextPage);
    if (fromMenu) window.requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  };

  const closeNotifications = () => {
    setNotificationsOpen(false);
    window.requestAnimationFrame(() => {
      const mobileViewport = window.matchMedia("(max-width: 720px)").matches;
      (mobileViewport ? mobileMoreButtonRef : notificationButtonRef).current?.focus();
    });
  };

  const focusMainContent = (event: React.SyntheticEvent) => {
    event.preventDefault();
    window.requestAnimationFrame(() => document.getElementById("main-content")?.focus());
  };

  const renderNavigationItem = (item: NavigationItem) => {
    const Icon = item.icon;
    return (
      <button key={item.id}
        type="button"
        className={`${page === item.id ? "nav-item active" : "nav-item"} nav-item-${item.id}`}
        aria-label={item.label}
        aria-current={page === item.id ? "page" : undefined}
        title={collapsed ? item.label : undefined}
        onClick={() => navigate(item.id)}
      >
        <Icon size={19} strokeWidth={1.8} />
        <span className="nav-full">{item.label}</span>
        <span className="nav-short" aria-hidden="true">{item.short}</span>
      </button>
    );
  };

  return (
    <div className={`app-shell workspace-shell ${collapsed ? "sidebar-collapsed" : "sidebar-expanded"}`}>
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
            <span className="brand-mark app-brand-mark" aria-hidden="true">{collapsed ? <PanelLeftOpen size={18} /> : <img src="/brand/news-desk.svg" alt="" width="36" height="36" />}</span>
            <span className="brand-copy">AI 新闻台<small>NEWS DESK</small></span>
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
          {mobile ? mobileNavigation.map(renderNavigationItem) : navigationGroups.map(group => <div className="workspace-nav-group" key={group.label} role="group" aria-label={group.label}>
            <span className="nav-section-label">{group.label}</span>
            {group.items.map(renderNavigationItem)}
          </div>)}

          <div ref={mobileMoreRef} className={`mobile-more-nav${mobileMoreOpen ? " open" : ""}`}>
            <button
              ref={mobileMoreButtonRef}
              type="button"
              className={mobileMoreActive ? "nav-item active" : "nav-item"}
              aria-label="更多功能"
              aria-controls="mobile-more-panel"
              aria-expanded={mobileMoreOpen}
              aria-description={badgeCount ? `${badgeCount} 条未读通知` : undefined}
              onClick={() => setMobileMoreOpen((current) => !current)}
            >
              <MoreHorizontal size={19} strokeWidth={1.8} />
              <span>更多</span>
              {badgeCount ? <i className="mobile-more-indicator" aria-hidden="true" /> : null}
            </button>
            {mobileMoreOpen ? (
              <div id="mobile-more-panel" className="mobile-more-menu" aria-label="更多功能">
                {mobileMoreNavigation.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={page === item.id ? "active" : undefined}
                      aria-current={page === item.id ? "page" : undefined}
                      onClick={() => navigate(item.id)}
                    >
                      <Icon size={17} strokeWidth={1.8} />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
                <button type="button" className="mobile-more-notifications" aria-label={notificationLabel} aria-haspopup="dialog" aria-controls="notification-center" onClick={() => { setMobileMoreOpen(false); setNotificationsOpen(true); }}><Bell size={17} /><span>通知{unreadCount ? ` · ${unreadCount > 99 ? "99+" : unreadCount}` : ""}</span></button>
              </div>
            ) : null}
          </div>
        </nav>

        <div className="sidebar-footer">
          <button type="button" className={`nav-item${page === "runs" ? " active" : ""}`} aria-label="运行记录" aria-current={page === "runs" ? "page" : undefined} title="运行记录" onClick={() => navigate("runs")}>
            <History size={18} strokeWidth={1.8} /><span className="nav-full">运行记录</span><span className="nav-short" aria-hidden="true">记录</span>
          </button>
          <div className="sidebar-tools" ref={settingsRef} onBlur={event => {
            if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setSettingsOpen(false);
          }}>
            <button ref={settingsButtonRef} type="button" className={`nav-item${activeSettings ? " active" : ""}`} aria-label="设置与工具" aria-expanded={settingsOpen} aria-controls="sidebar-tools-panel" title={activeSettings ? `设置与工具 · ${activeSettings.label}` : "设置与工具"} onClick={() => setSettingsOpen(current => !current)}>
              <Settings2 size={18} strokeWidth={1.8} /><span className="nav-full">设置与工具</span><span className="nav-short" aria-hidden="true">设置</span><ChevronRight className="sidebar-tools-chevron" size={14} />
            </button>
            {settingsOpen ? <div id="sidebar-tools-panel" className="sidebar-tools-panel" aria-label="设置与工具">
              <strong>设置与工具</strong>
              {settingsNavigation.map(item => <button type="button" key={item.id} className={page === item.id ? "active" : undefined} aria-current={page === item.id ? "page" : undefined} onClick={() => navigate(item.id)}><item.icon size={18} /><span>{item.label}</span><ChevronRight size={14} /></button>)}
            </div> : null}
          </div>
          <button
            type="button"
            ref={notificationButtonRef}
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
            <span className="nav-full">通知</span><span className="nav-short" aria-hidden="true">通知</span>
          </button>
        </div>
      </aside>
      <main id="main-content" className="app-main" tabIndex={-1}>{children}</main>
      <NotificationCenter
        open={notificationsOpen}
        notifications={notifications}
        muted={notificationsMuted}
        onClose={closeNotifications}
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
