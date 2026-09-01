import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "./components/AppShell";
import { AISettingsPage } from "./components/AISettingsPage";
import { BootstrapStatusPage } from "./components/BootstrapStatusPage";
import { CommunityWorkspace } from "./components/CommunityWorkspace";
import { EditorialSystemPage } from "./components/EditorialSystemPage";
import { Notice, type NoticeState } from "./components/Notice";
import { ProductJobCenter } from "./components/ProductJobCenter";
import { RunsPage } from "./components/RunsPage";
import { SchedulePage } from "./components/SchedulePage";
import { SourcesPage } from "./components/SourcesPage";
import { TodayPage } from "./components/TodayPage";
import { Workbench } from "./components/Workbench";
import { api, type MaterialMetadataInput, type ShellView } from "./api";
import { resolveBootstrap, type BootstrapState } from "./bootstrap-state";
import { useHashPageNavigation } from "./hooks/useHashPageNavigation";
import type {
  ArticleDraft,
  ArticleAgentDraftInput,
  ArticleAgentRole,
  ArticleAgentThread,
  DraftRevision,
  DraftSaveMode,
  HealthState,
  PublisherResult,
  PublisherPreflightResult,
  PlatformPublicationConfirmation,
  PublishedImagePromotionPublicStatus,
  ProviderHealthResult,
  AiProviderConfig,
  CandidateFeedbackKind,
  CollectionRequest,
  ImageMaterial,
  EvidenceReviewSelection,
  EditorialProfile,
  EditorialIntent,
  EditorialSuggestionStatus,
  EditorialSystemView,
  IntakeReviewRecord,
  Settings,
  SourceConfig,
  WorkflowNotification,
  WorkflowState,
  WeChatChannelSettings,
  WeChatConnectionResult,
  WeChatDraftSyncReceipt,
} from "./types";

const DraftWorkspace = lazy(() =>
  import("./components/DraftWorkspace").then((module) => ({ default: module.DraftWorkspace })),
);

function App() {
  const [state, setState] = useState<WorkflowState>();
  const [editorialSystem, setEditorialSystem] = useState<EditorialSystemView>();
  const { page, navigate } = useHashPageNavigation();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [activeDraftId, setActiveDraftId] = useState<string>();
  const [notice, setNotice] = useState<NoticeState>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [health, setHealth] = useState<HealthState>();
  const [shell, setShell] = useState<ShellView>({ notifications: [], notificationsMuted: false, activeRunCount: 0 });
  const [pendingQuickDraft, setPendingQuickDraft] = useState<{ runId: string; draftId: string }>();
  const [bootstrapState, setBootstrapState] = useState<BootstrapState>({ status: "idle" });

  const refresh = useCallback(async () => {
    const [next, nextEditorialSystem] = await Promise.all([
      api.bootstrap(),
      api.editorialSystem(),
    ]);
    setState(next);
    setEditorialSystem(nextEditorialSystem);
    setShell({
      notifications: next.notifications ?? [],
      notificationsMuted: next.settings.notificationsMuted,
      activeRunCount: next.runs.filter((run) => ["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status)).length,
    });
    setActiveRunId((current) => current ?? next.runs[0]?.id);
    setActiveDraftId((current) => current ?? next.drafts[0]?.id);
    return next;
  }, []);

  const refreshShell = useCallback(async () => {
    try {
      setShell(await api.shell());
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  const refreshPublisherStatus = useCallback(async () => {
    try {
      const publisher = await api.publisherStatus();
      setHealth((current) => current ? { ...current, publisher } : current);
    } catch {
      // The full environment check already owns user-facing health errors.
    }
  }, []);
  const loadStorageUsage = useCallback(() => api.storageUsage(), []);

  const bootstrap = useCallback(async () => {
    setBootstrapState({ status: "loading" });
    const result = await resolveBootstrap(refresh);
    setBootstrapState(result);
    if (result.status === "ready") void refreshHealth();
  }, [refresh, refreshHealth]);

  useEffect(() => {
    void refreshShell();
  }, [refreshShell]);

  useEffect(() => {
    if (page === "today" || (state && editorialSystem)) return;
    if (bootstrapState.status === "loading" || bootstrapState.status === "error") return;
    void bootstrap();
  }, [bootstrap, bootstrapState.status, editorialSystem, page, state]);

  useEffect(() => {
    if (state?.settings.publisherMode !== "chrome-extension") return;
    if (page !== "drafts" && page !== "schedule") return;
    void refreshPublisherStatus();
    const timer = window.setInterval(() => void refreshPublisherStatus(), 3_000);
    return () => window.clearInterval(timer);
  }, [page, refreshPublisherStatus, state?.settings.publisherMode]);

  const activeRun = useMemo(
    () => state?.runs.find((run) => run.id === activeRunId) ?? state?.runs[0],
    [state?.runs, activeRunId],
  );
  const activeProvider = state?.aiSettings.providers.find((provider) => provider.id === state.aiSettings.activeProviderId)
    ?? state?.aiSettings.providers[0];
  const hasActiveWork = Boolean(
    activeRun && ["queued", "collecting", "scoring", "extracting", "generating"].includes(activeRun.status),
  );

  useEffect(() => {
    if (!hasActiveWork) return;
    const timer = window.setInterval(() => void refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [hasActiveWork, refresh]);

  useEffect(() => {
    if (page !== "community") return;
    const refreshVisibleCommunity = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(refreshVisibleCommunity, 60_000);
    window.addEventListener("focus", refreshVisibleCommunity);
    document.addEventListener("visibilitychange", refreshVisibleCommunity);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleCommunity);
      document.removeEventListener("visibilitychange", refreshVisibleCommunity);
    };
  }, [page, refresh]);

  useEffect(() => {
    if (!pendingQuickDraft || !state) return;
    const draft = state.drafts.find((entry) => entry.id === pendingQuickDraft.draftId);
    if (draft) {
      setActiveDraftId(draft.id);
      navigate("drafts");
      setNotice({ kind: "success", message: "快速草稿已生成。正文、配图和来源都可以继续编辑。" });
      setPendingQuickDraft(undefined);
      return;
    }
    const run = state.runs.find((entry) => entry.id === pendingQuickDraft.runId);
    if (run?.status === "failed") {
      setNotice({ kind: "error", message: run.error || "快速成稿失败，请查看运行记录。" });
      setPendingQuickDraft(undefined);
    }
  }, [navigate, pendingQuickDraft, state]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleShellNotifications = async (muted: boolean) => {
    setShell((current) => ({ ...current, notificationsMuted: muted }));
    try {
      await api.saveSettings({ notificationsMuted: muted });
    } catch (error) {
      setShell((current) => ({ ...current, notificationsMuted: !muted }));
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const markShellNotificationRead = async (notificationId: string) => {
    try {
      const notifications = await api.markNotificationRead(notificationId);
      setShell((current) => ({ ...current, notifications }));
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const markAllShellNotificationsRead = async () => {
    try {
      const notifications = await api.markAllNotificationsRead();
      setShell((current) => ({ ...current, notifications }));
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const openShellNotification = (notification: WorkflowNotification) => {
    if (!notification.target) return;
    if (notification.target.runId) setActiveRunId(notification.target.runId);
    if (notification.target.draftId) setActiveDraftId(notification.target.draftId);
    navigate(notification.target.page);
  };

  const openLatestDraft = async () => {
    try {
      const next = await refresh();
      setActiveDraftId(next.drafts[0]?.id);
      navigate("drafts");
    } catch (error) {
      setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  };

  if ((!state || !editorialSystem) && page === "today") {
    return (
      <AppShell
        page={page}
        onNavigate={navigate}
        notifications={shell.notifications}
        notificationsMuted={shell.notificationsMuted}
        onToggleNotificationsMuted={toggleShellNotifications}
        onMarkNotificationRead={markShellNotificationRead}
        onMarkAllNotificationsRead={markAllShellNotificationsRead}
        onOpenNotification={openShellNotification}
      >
        <Notice notice={notice} onClose={() => setNotice(null)} />
        <ProductJobCenter onOpenDrafts={() => void openLatestDraft()} />
        <TodayPage onNavigate={navigate} onNotice={(kind, message) => setNotice({ kind, message })} />
      </AppShell>
    );
  }

  if (!state || !editorialSystem) {
    return <BootstrapStatusPage state={bootstrapState} onRetry={() => void bootstrap()} />;
  }

  const reportError = (error: unknown) =>
    setNotice({ kind: "error", message: error instanceof Error ? error.message : String(error) });

  const saveSettings = async (patch: Partial<Settings>) => {
    setState((current) => current ? { ...current, settings: { ...current.settings, ...patch } } : current);
    try {
      const settings = await api.saveSettings(patch);
      setState((current) => current ? { ...current, settings } : current);
    } catch (error) {
      reportError(error);
      await refresh();
    }
  };

  const saveWeChatSettings = async (
    patch: Partial<WeChatChannelSettings> & { appSecret?: string; clearAppSecret?: boolean },
  ) => {
    try {
      const wechat = await api.saveWeChatSettings(patch);
      setState((current) => current ? {
        ...current,
        settings: { ...current.settings, wechat },
      } : current);
      setNotice({
        kind: "success",
        message: patch.clearAppSecret
          ? "微信公众号 AppSecret 已从本机安全存储移除。"
          : "微信公众号连接信息已保存；AppSecret 只保存在本机钥匙串。",
      });
      return wechat;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const testWeChatConnection = async (): Promise<WeChatConnectionResult> => {
    try {
      const result = await api.testWeChatConnection();
      setNotice({ kind: result.ok ? "success" : "error", message: result.detail });
      return result;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const saveSource = async (source: SourceConfig, patch: Partial<SourceConfig>) => {
    setState((current) => current ? {
      ...current,
      sources: current.sources.map((entry) => entry.id === source.id ? { ...entry, ...patch } : entry),
    } : current);
    try {
      await api.saveSource(source.id, patch);
    } catch (error) {
      reportError(error);
      await refresh();
    }
  };

  const saveEditorialProfile = async (profile: Partial<EditorialProfile>) => {
    try {
      const next = await api.saveEditorialProfile(profile);
      setEditorialSystem(next);
      setState((current) => current ? {
        ...current,
        editorialSystem: { ...current.editorialSystem, profile: next.profile },
      } : current);
      setNotice({ kind: "success", message: "长期编辑档案已保存。自动任务只能读取，不能覆盖。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const decideEditorialSuggestion = async (
    suggestionId: string,
    decision: Exclude<EditorialSuggestionStatus, "pending">,
  ) => {
    try {
      const next = await api.decideEditorialSuggestion(suggestionId, decision);
      setEditorialSystem(next);
      await refresh();
      setNotice({
        kind: decision === "adopted" ? "success" : "info",
        message: decision === "adopted" ? "建议已采纳并应用。" : "建议已忽略，系统会保留这个决定。",
      });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const setWritingMemoryEnabled = async (memoryId: string, enabled: boolean) => {
    try {
      const writingMemories = await api.setWritingMemoryEnabled(memoryId, enabled);
      setEditorialSystem((current) => current ? { ...current, writingMemories } : current);
      setNotice({
        kind: "success",
        message: enabled ? "这条编辑记忆已启用。" : "这条编辑记忆已关闭，不会用于后续写稿。",
      });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const deleteWritingMemory = async (memoryId: string) => {
    try {
      const writingMemories = await api.deleteWritingMemory(memoryId);
      setEditorialSystem((current) => current ? { ...current, writingMemories } : current);
      setNotice({ kind: "info", message: "编辑记忆已删除；未来有新的真实证据时可以重新学习。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const collect = async (filters: CollectionRequest = {}) => {
    setActionBusy(true);
    try {
      const result = await api.collect(filters);
      setActiveRunId(result.run.id);
      setNotice({
        kind: result.reused ? "info" : "success",
        message: result.reused
          ? "已有一次采集正在运行，已切换到该记录；不会重复启动。"
          : "采集已启动。候选会自动进入表格，不需要再发送链接。",
      });
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const cancelRun = async () => {
    if (!activeRun) return;
    setActionBusy(true);
    try {
      await api.cancelRun(activeRun.id);
      setNotice({ kind: "info", message: "本次采集已取消，已有记录和日志仍然保留。" });
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const retryRun = async (runId: string) => {
    setActionBusy(true);
    try {
      const result = await api.retryRun(runId);
      setActiveRunId(result.run.id);
      navigate("workbench");
      setNotice({
        kind: result.reused ? "info" : "success",
        message: result.reused ? "已有采集正在运行，已切换到该记录。" : "已按原来的日期、关键词、频道和来源重新采集。",
      });
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const selectCandidate = async (candidateId: string, selected: boolean) => {
    if (!activeRun) return;
    setState((current) => current ? {
      ...current,
      runs: current.runs.map((run) => run.id !== activeRun.id ? run : {
        ...run,
        candidates: run.candidates.map((candidate) => candidate.id === candidateId ? { ...candidate, selected } : candidate),
      }),
    } : current);
    try {
      await api.selectCandidate(activeRun.id, candidateId, selected);
    } catch (error) {
      reportError(error);
      await refresh();
    }
  };

  const setCandidateFeedback = async (
    candidateId: string,
    kind: Extract<CandidateFeedbackKind, "interested" | "not_interested">,
  ) => {
    if (!activeRun) return;
    try {
      await api.setCandidateFeedback(activeRun.id, candidateId, kind);
      await refresh();
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const restoreCandidateFeedback = async (candidateId: string) => {
    if (!activeRun) return;
    try {
      await api.restoreCandidateFeedback(activeRun.id, candidateId);
      await refresh();
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const togglePersonalization = async (enabled: boolean) => {
    try {
      await api.saveSettings({ personalizationEnabled: enabled });
      await refresh();
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const clearCandidateFeedback = async () => {
    try {
      await api.clearCandidateFeedback();
      await refresh();
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const clearCandidates = async (candidateIds?: string[]) => {
    if (!activeRun) return;
    setActionBusy(true);
    try {
      const result = await api.clearCandidates(activeRun.id, candidateIds);
      setState((current) => current ? {
        ...current,
        runs: current.runs.map((run) => run.id === result.run.id ? result.run : run),
      } : current);
      setNotice({ kind: "info", message: `已清空 ${result.cleared} 条候选；已有草稿、来源记录和运行日志仍然保留。` });
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const briefCandidates = async () => {
    if (!activeRun) return;
    setActionBusy(true);
    try {
      const result = await api.briefCandidates(activeRun.id);
      setState((current) => current ? {
        ...current,
        runs: current.runs.map((run) => run.id === result.run.id ? result.run : run),
      } : current);
      setNotice({
        kind: result.failed ? "info" : "success",
        message: result.requested === 0
          ? "这批候选已经都有中文摘要。"
          : result.failed
            ? `已补全 ${result.completed} 条，另有 ${result.failed} 条仍保留原标题，可稍后重试。`
            : `已补全 ${result.completed} 条中文标题和一句话摘要。`,
      });
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const quickDraftFromUrl = async (url: string): Promise<IntakeReviewRecord> => {
    setActionBusy(true);
    try {
      const result = await api.intakeUrl(url);
      setNotice({ kind: "success", message: "链接正文和图片已提取，请先复核证据，再生成草稿。" });
      return result.review;
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const quickDraftFromScreenshot = async (file: File, note?: string): Promise<IntakeReviewRecord> => {
    setActionBusy(true);
    try {
      const result = await api.intakeScreenshot(file, note);
      setNotice({ kind: "success", message: "截图 OCR、网页去噪和图片定位已完成，请先复核证据。" });
      return result.review;
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const confirmQuickDraftReview = async (reviewId: string, selection: EvidenceReviewSelection) => {
    setActionBusy(true);
    try {
      const result = await api.confirmIntakeReview(reviewId, selection);
      setActiveRunId(result.run.id);
      setPendingQuickDraft({ runId: result.run.id, draftId: result.draftId });
      setNotice({ kind: "info", message: "证据快照已确认，正在使用你保留的正文和图片生成草稿。" });
      await refresh();
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const generate = async () => {
    if (!activeRun) return;
    setActionBusy(true);
    try {
      const result = await api.generate(activeRun.id);
      setNotice({
        kind: result.alreadyGenerated ? "info" : result.reused ? "info" : "success",
        message: result.alreadyGenerated
          ? "所选新闻已经有草稿，因此没有重复生成。"
          : result.reused
            ? "这次成稿已经在运行，没有重复启动。"
            : `已把 ${result.selectedCount} 条候选交给 ${result.providerName} 分别成稿。`,
      });
      await refresh();
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const createCommunityDraftForRun = async (
    runId: string,
    candidateId: string,
    mode: "article" | "source" | "translation" | "curation",
  ) => {
    setActionBusy(true);
    try {
      const draft = await api.createCommunityDraft(runId, candidateId, mode);
      await refresh();
      setActiveDraftId(draft.id);
      navigate("drafts");
      setNotice({
        kind: "success",
        message: mode === "article"
          ? `已读取关联来源并生成新闻稿，社区讨论没有替代事实主干；正文带入 ${draft.images.filter((image) => image.afterParagraph >= 0).length} 张来源图片。`
          : `社区内容已进入草稿箱，并带入 ${draft.images.filter((image) => image.afterParagraph >= 0).length} 张来源图片。发布前仍需确认转载、翻译和图片权利。`,
      });
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const createEditorialDraftForSignal = async (
    runId: string,
    candidateId: string,
    intent: EditorialIntent,
  ) => {
    setActionBusy(true);
    try {
      const queued = await api.createEditorialDraft(runId, candidateId, intent);
      let draftId = queued.draft?.id;
      let imageCount = queued.draft?.images.filter((image) => image.afterParagraph >= 0).length ?? 0;
      let job = queued.job;
      for (let attempt = 0; !draftId && attempt < 150 && ["queued", "running", "retrying"].includes(job.status); attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_000));
        job = await api.productJob(job.id);
        if (job.result && typeof job.result === "object") {
          const result = job.result as { draftId?: unknown; imageCount?: unknown };
          if (typeof result.draftId === "string") draftId = result.draftId;
          if (typeof result.imageCount === "number") imageCount = result.imageCount;
        }
      }
      if (!draftId || job.status !== "complete") {
        throw new Error(job.error || "成稿任务没有完成，请在任务进度中查看原因。");
      }
      await refresh();
      setActiveDraftId(draftId);
      navigate("drafts");
      setNotice({
        kind: "success",
        message: intent === "news"
          ? `新闻稿已生成：事实来自原始页面，社区评论没有替代新闻主干；带入 ${imageCount} 张来源图片。`
          : intent === "source"
            ? `原文整理稿已生成：尽量保留原材料结构，并带入 ${imageCount} 张来源图片。`
            : `社区观察稿已生成：只使用达到采样门槛的讨论，并带入 ${imageCount} 张来源图片。`,
      });
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const createCommunityCandidateDraft = async (
    candidateId: string,
    mode: "article" | "source" | "translation" | "curation",
  ) => {
    if (!activeRun) return;
    return createCommunityDraftForRun(activeRun.id, candidateId, mode);
  };

  const setCommunityCandidateFeedback = async (
    runId: string,
    candidateId: string,
    kind: Extract<CandidateFeedbackKind, "interested" | "not_interested">,
  ) => {
    try {
      const result = await api.setCandidateFeedback(runId, candidateId, kind);
      setState((current) => current ? {
        ...current,
        runs: current.runs.map((run) => run.id === result.run.id ? result.run : run),
        candidateFeedback: kind === "not_interested"
          ? [...current.candidateFeedback.filter((item) => item.candidateId !== candidateId), result.feedback]
          : [...current.candidateFeedback.filter((item) => item.candidateId !== candidateId), result.feedback],
      } : current);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const restoreCommunityCandidateFeedback = async (runId: string, candidateId: string) => {
    try {
      const result = await api.restoreCandidateFeedback(runId, candidateId);
      setState((current) => current ? {
        ...current,
        runs: current.runs.map((run) => run.id === result.run.id ? result.run : run),
        candidateFeedback: current.candidateFeedback.filter((item) => item.candidateId !== candidateId),
      } : current);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const autoBriefCommunityCandidates = async (
    requests: Array<{ runId: string; candidateIds: string[] }>,
  ) => {
    const results = await Promise.all(requests.slice(0, 3).map((request) =>
      api.briefCandidates(request.runId, request.candidateIds)));
    const updatedRuns = new Map(results.map((result) => [result.run.id, result.run]));
    setState((current) => current ? {
      ...current,
      runs: current.runs.map((run) => updatedRuns.get(run.id) ?? run),
    } : current);
  };

  const saveDraft = async (
    draftId: string,
    patch: Partial<ArticleDraft>,
    saveMode: DraftSaveMode = "manual",
  ): Promise<ArticleDraft> => {
    try {
      const saved = await api.saveDraft(draftId, patch, saveMode);
      setState((current) => current ? {
        ...current,
        drafts: current.drafts.map((draft) => draft.id === draftId ? saved : draft),
      } : current);
      if (saveMode === "manual") {
        setNotice({ kind: "success", message: "草稿已保存，并创建了一个历史版本。" });
      }
      return saved;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const loadDraftRevisions = async (draftId: string): Promise<DraftRevision[]> => {
    try {
      return await api.draftRevisions(draftId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const restoreDraftRevision = async (draftId: string, revisionId: string) => {
    try {
      const result = await api.restoreDraftRevision(draftId, revisionId);
      setState((current) => current ? {
        ...current,
        drafts: current.drafts.map((draft) => draft.id === draftId ? result.draft : draft),
      } : current);
      setNotice({ kind: "success", message: "已恢复历史版本；恢复前的内容也保留在版本列表中。" });
      return result;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const uploadDraftImage = async (draftId: string, file: File) => {
    try {
      return await api.uploadDraftImage(draftId, file);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const importDraftImage = async (draftId: string, url: string, caption?: string) => {
    try {
      return await api.importDraftImage(draftId, url, caption);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const saveAiProvider = async (
    providerId: string,
    patch: Partial<AiProviderConfig> & { apiKey?: string; clearApiKey?: boolean; active?: boolean },
  ) => {
    try {
      const aiSettings = await api.saveAiProvider(providerId, patch);
      setState((current) => current ? { ...current, aiSettings } : current);
      setNotice({
        kind: "success",
        message: patch.active ? "已切换成稿引擎；下一篇文章会使用这个 AI。" : patch.clearApiKey ? "API Key 已从本机安全存储移除。" : "AI 配置已保存。",
      });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const saveAgentRole = async (role: ArticleAgentRole, providerId: string) => {
    try {
      const aiSettings = await api.saveAgentRole(role, providerId);
      setState((current) => current ? { ...current, aiSettings } : current);
      const providerName = aiSettings.providers.find((provider) => provider.id === providerId)?.name || "所选模型";
      setNotice({
        kind: "success",
        message: `已把${role === "analysis" ? "文章分析" : "文章优化"}交给 ${providerName}。`,
      });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const testAiProvider = async (providerId: string): Promise<ProviderHealthResult> => {
    try {
      const { result, aiSettings } = await api.testAiProvider(providerId);
      setState((current) => current ? { ...current, aiSettings } : current);
      setNotice({
        kind: result.status === "error" ? "error" : result.status === "warning" ? "info" : "success",
        message: result.safeMessage,
      });
      return result;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const saveWritingReviewMode = async (mode: WorkflowState["aiSettings"]["writingReviewMode"]) => {
    try {
      const aiSettings = await api.saveWritingReviewMode(mode);
      setState((current) => current ? { ...current, aiSettings } : current);
      setNotice({ kind: "success", message: "写作审校模式已更新；下一次文章优化会按这个模式执行。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const saveSkill = async (skillId: string, enabled: boolean) => {
    try {
      const skills = await api.saveSkill(skillId, enabled);
      setState((current) => current ? { ...current, aiSettings: { ...current.aiSettings, skills } } : current);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const importSkill = async (path: string) => {
    try {
      const skills = await api.importSkill(path);
      setState((current) => current ? { ...current, aiSettings: { ...current.aiSettings, skills } } : current);
      setNotice({ kind: "success", message: "Skill 已导入并启用，下一次成稿会写入这份规则快照。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const uploadMaterial = async (file: File, metadata: MaterialMetadataInput) => {
    try {
      const material = await api.uploadMaterial(file, metadata);
      setState((current) => current ? { ...current, materials: [material, ...current.materials] } : current);
      setNotice({ kind: "success", message: "图片已加入素材库，可在任何草稿中一键插入。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const importMaterial = async (url: string, metadata: MaterialMetadataInput) => {
    try {
      const material = await api.importMaterial(url, metadata);
      setState((current) => current ? { ...current, materials: [material, ...current.materials] } : current);
      setNotice({ kind: "success", message: "网络图片已下载到本地素材库。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const deleteMaterial = async (materialId: string) => {
    try {
      await api.deleteMaterial(materialId);
      setState((current) => current ? { ...current, materials: current.materials.filter((material) => material.id !== materialId) } : current);
      setNotice({ kind: "info", message: "素材已删除；已插入草稿的副本仍然保留。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const insertMaterial = async (draftId: string, materialId: string) => {
    try {
      return await api.insertMaterial(draftId, materialId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const loadPublishedImageMaterialStatuses = async (
    draftId: string,
  ): Promise<PublishedImagePromotionPublicStatus[]> => {
    try {
      return (await api.publishedImageMaterialStatuses(draftId)).statuses;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const savePublishedImageMaterial = async (draftId: string, placementId: string) => {
    try {
      const result = await api.savePublishedImageMaterial(draftId, placementId);
      setState((current) => current ? {
        ...current,
        materials: current.materials.some((material) => material.id === result.material.id)
          ? current.materials
          : [result.material, ...current.materials],
      } : current);
      setNotice({
        kind: "success",
        message: `“${result.material.title}”已存入素材库，版权状态保持为“${result.material.rights}”。`,
      });
      return result;
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const loadArticleAgentThreads = async (draftId: string): Promise<ArticleAgentThread[]> => {
    try {
      return await api.articleAgentThreads(draftId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const runArticleAgent = async (
    draftId: string,
    role: ArticleAgentRole,
    draft: ArticleAgentDraftInput,
  ): Promise<ArticleAgentThread> => {
    try {
      return await api.runArticleAgent(draftId, role, draft);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const askArticleAgent = async (
    draftId: string,
    threadId: string,
    message: string,
    draft: ArticleAgentDraftInput,
  ): Promise<ArticleAgentThread> => {
    try {
      return await api.askArticleAgent(draftId, threadId, message, draft);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const launchPublisher = async () => {
    setActionBusy(true);
    try {
      const result = await api.launchPublisher();
      const extensionMode = state?.settings.publisherMode === "chrome-extension";
      setNotice({
        kind: result.ok ? "success" : "info",
        message: extensionMode
          ? result.ok
            ? "已在常用 Chrome 打开小黑盒。系统只会填入，不会代你发布。"
            : "已打开常用 Chrome；加载填入助手并刷新工作台后即可连接。"
          : result.ok
            ? "CDP 备用浏览器已启动。首次使用请在新窗口中登录小黑盒。"
            : result.detail,
      });
      await refreshHealth();
    } catch (error) {
      reportError(error);
    } finally {
      setActionBusy(false);
    }
  };

  const fillDraft = async (draftId: string): Promise<PublisherResult | undefined> => {
    setActionBusy(true);
    try {
      const result = await api.fillDraft(draftId);
      setNotice({
        kind: result.ok ? "success" : "info",
        message: result.ok ? "标题和正文已填入小黑盒，请检查后手动发布。" : "已完成部分填入，请查看右侧结果。",
      });
      await refresh();
      return result;
    } catch (error) {
      reportError(error);
      return undefined;
    } finally {
      setActionBusy(false);
    }
  };

  const syncWeChatDraft = async (
    draftId: string,
    input: { author?: string; digest?: string; contentSourceUrl?: string },
  ): Promise<WeChatDraftSyncReceipt | undefined> => {
    setActionBusy(true);
    try {
      const result = await api.syncWeChatDraft(draftId, input);
      setState((current) => current ? {
        ...current,
        drafts: current.drafts.map((draft) => draft.id === draftId ? result.draft : draft),
      } : current);
      setNotice({
        kind: "success",
        message: result.receipt.operation === "created"
          ? "文章已进入微信公众号草稿箱，请在公众平台预览并手动发布。"
          : result.receipt.operation === "updated"
            ? "公众号草稿已更新；不会重复创建，也不会自动发布。"
            : "公众号草稿已经是最新版本，没有重复上传。",
      });
      return result.receipt;
    } catch (error) {
      reportError(error);
      return undefined;
    } finally {
      setActionBusy(false);
    }
  };

  const publisherPreflight = async (draftId: string): Promise<PublisherPreflightResult> => {
    try {
      return await api.publisherPreflight(draftId);
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const exportData = async () => {
    try {
      const blob = await api.exportData();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ai-news-desk-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ kind: "success", message: "校验备份已导出。图片文件请连同 .workflow/media 与 materials 一起迁移。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const exportPortableArchive = async () => {
    try {
      const blob = await api.exportPortableArchive();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ai-news-desk-full-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice({ kind: "success", message: "完整归档已导出：数据库、正文图片、素材与校验清单都在其中，密钥未包含。" });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const restoreData = async (file: File) => {
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      const result = await api.restoreData(backup);
      await refresh();
      setNotice({
        kind: "success",
        message: `备份恢复完成：${result.counts.drafts} 篇草稿、${result.counts.sources} 个来源、${result.counts.materials} 个素材索引。`,
      });
    } catch (error) {
      reportError(error);
      throw error;
    }
  };

  const confirmPublished = async (draftId: string, platform: "xiaoheihe" | "wechat"): Promise<PlatformPublicationConfirmation> => {
    setActionBusy(true);
    try {
      const result = await api.confirmPublished(draftId, platform);
      setNotice({
        kind: "success",
        message: platform === "wechat"
          ? "已记录公众号发布；这次编辑差异与合格图片现在可以进入学习和素材沉淀。"
          : "本次使用的分区和标签已保存到发布历史。",
      });
      await refresh();
      return result.confirmation;
    } catch (error) {
      reportError(error);
      throw error;
    } finally {
      setActionBusy(false);
    }
  };

  const markNotificationRead = async (notificationId: string) => {
    const readAt = new Date().toISOString();
    setState((current) => current ? {
      ...current,
      notifications: (current.notifications ?? []).map((notification) =>
        notification.id === notificationId && !notification.readAt
          ? { ...notification, readAt }
          : notification,
      ),
    } : current);
    try {
      const notifications = await api.markNotificationRead(notificationId);
      setState((current) => current ? { ...current, notifications } : current);
    } catch (error) {
      reportError(error);
      await refresh();
    }
  };

  const markAllNotificationsRead = async () => {
    const readAt = new Date().toISOString();
    setState((current) => current ? {
      ...current,
      notifications: (current.notifications ?? []).map((notification) =>
        notification.readAt ? notification : { ...notification, readAt },
      ),
    } : current);
    try {
      const notifications = await api.markAllNotificationsRead();
      setState((current) => current ? { ...current, notifications } : current);
    } catch (error) {
      reportError(error);
      await refresh();
    }
  };

  const openNotification = (notification: WorkflowNotification) => {
    if (!notification.target) return;
    if (notification.target.runId) setActiveRunId(notification.target.runId);
    if (notification.target.draftId) setActiveDraftId(notification.target.draftId);
    navigate(notification.target.page);
  };

  return (
    <AppShell
      page={page}
      onNavigate={navigate}
      notifications={state.notifications ?? []}
      notificationsMuted={state.settings.notificationsMuted}
      onToggleNotificationsMuted={(muted) => saveSettings({ notificationsMuted: muted })}
      onMarkNotificationRead={markNotificationRead}
      onMarkAllNotificationsRead={markAllNotificationsRead}
      onOpenNotification={openNotification}
    >
      <Notice notice={notice} onClose={() => setNotice(null)} />
      <ProductJobCenter onOpenDrafts={() => void openLatestDraft()} />
      {page === "today" ? (
        <TodayPage
          onNavigate={navigate}
          onNotice={(kind, message) => setNotice({ kind, message })}
        />
      ) : null}
      {page === "workbench" ? (
        <Workbench
          settings={state.settings}
          sources={state.sources}
          run={activeRun}
          activeProvider={activeProvider!}
          busy={actionBusy}
          onSettings={saveSettings}
          onSourceToggle={(source, selected) => saveSource(source, { selected })}
          onAddSource={() => navigate("sources")}
          onCollect={collect}
          onCancel={cancelRun}
          onSelect={selectCandidate}
          feedbackCount={state.candidateFeedback.length}
          onFeedback={setCandidateFeedback}
          onRestoreFeedback={restoreCandidateFeedback}
          onTogglePersonalization={togglePersonalization}
          onClearFeedback={clearCandidateFeedback}
          onGenerate={generate}
          onCommunityDraft={createCommunityCandidateDraft}
          onClearCandidates={clearCandidates}
          onBriefCandidates={briefCandidates}
          onQuickDraftUrl={quickDraftFromUrl}
          onQuickDraftScreenshot={quickDraftFromScreenshot}
          onConfirmQuickDraftReview={confirmQuickDraftReview}
          onOpenAiSettings={() => navigate("ai-settings")}
          onOpenDrafts={() => {
            setActiveDraftId(state.drafts.find((draft) => draft.runId === activeRun?.id)?.id ?? state.drafts[0]?.id);
            navigate("drafts");
          }}
        />
      ) : null}
      {page === "community" ? (
        <CommunityWorkspace
          runs={state.runs}
          sources={state.sources}
          settings={state.settings}
          onFeedback={setCommunityCandidateFeedback}
          onRestoreFeedback={restoreCommunityCandidateFeedback}
          onCreateDraft={createEditorialDraftForSignal}
          onAutoBrief={autoBriefCommunityCandidates}
        />
      ) : null}
      {page === "drafts" ? (
        <Suspense fallback={<div className="app-loading">正在加载连续编辑器…</div>}>
          <DraftWorkspace
            drafts={state.drafts}
            materials={state.materials}
            analysisProvider={state.aiSettings.providers.find((provider) => provider.id === state.aiSettings.analysisProviderId)}
            optimizationProvider={state.aiSettings.providers.find((provider) => provider.id === state.aiSettings.optimizationProviderId)}
            activeDraftId={activeDraftId}
            busy={actionBusy}
            publisherStatus={health?.publisher}
            wechatSettings={state.settings.wechat}
            recentTopics={state.settings.recentTopics}
            recentCommunities={state.settings.recentCommunities}
            onGoToday={() => navigate("today")}
            onOpenWorkbench={() => navigate("workbench")}
            onSelectDraft={setActiveDraftId}
            onSave={saveDraft}
            onLoadRevisions={loadDraftRevisions}
            onRestoreRevision={restoreDraftRevision}
            onUploadImage={uploadDraftImage}
            onImportImage={importDraftImage}
            onInsertMaterial={insertMaterial}
            onLoadPublishedImageMaterialStatuses={loadPublishedImageMaterialStatuses}
            onSavePublishedImageMaterial={savePublishedImageMaterial}
            onLoadAgentThreads={loadArticleAgentThreads}
            onRunArticleAgent={runArticleAgent}
            onAskArticleAgent={askArticleAgent}
            onLaunchPublisher={launchPublisher}
            onOpenPublisherSettings={() => navigate("schedule")}
            onPublisherPreflight={publisherPreflight}
            onFill={fillDraft}
            onSyncWeChatDraft={syncWeChatDraft}
            onConfirmPublished={confirmPublished}
          />
        </Suspense>
      ) : null}
      {page === "editorial-system" ? (
        <EditorialSystemPage
          view={editorialSystem}
          settings={state.settings}
          busy={actionBusy}
          onSaveProfile={saveEditorialProfile}
          onDecision={decideEditorialSuggestion}
          onSettings={saveSettings}
          onReadNow={() => collect({ sourceIds: editorialSystem.automaticReading.sourceIds })}
          onOpenSources={() => navigate("sources")}
          onOpenRun={(runId) => {
            setActiveRunId(runId);
            navigate("workbench");
          }}
          onToggleWritingMemory={setWritingMemoryEnabled}
          onDeleteWritingMemory={deleteWritingMemory}
        />
      ) : null}
      {page === "sources" ? (
        <SourcesPage
          sources={state.sources}
          sourcePresets={state.sourcePresets ?? []}
          onSave={saveSource}
          onAdd={async (source) => {
            try {
              await api.addSource(source);
              setNotice({ kind: "success", message: "新闻源已加入，下一次采集会自动读取。" });
              await refresh();
            } catch (error) {
              reportError(error);
              throw error;
            }
          }}
          onDelete={async (sourceId) => {
            try {
              await api.deleteSource(sourceId);
              await refresh();
            } catch (error) {
              reportError(error);
            }
          }}
          onBatch={async (sourceIds, patch) => {
            try {
              const result = await api.batchSources(sourceIds, patch);
              const updatedById = new Map(result.sources.map((source) => [source.id, source]));
              setState((current) => current ? {
                ...current,
                sources: current.sources.map((source) => updatedById.get(source.id) ?? source),
              } : current);
              setNotice({ kind: "success", message: `已更新 ${result.updated} 个新闻源。` });
            } catch (error) {
              reportError(error);
              throw error;
            }
          }}
          onTest={async (sourceId) => {
            try {
              const result = await api.testSource(sourceId);
              setState((current) => current ? {
                ...current,
                sources: current.sources.map((source) => source.id === sourceId ? result.source : source),
              } : current);
              setNotice({
                kind: result.result.status === "healthy" ? "success" : result.result.status === "warning" ? "info" : "error",
                message: result.result.detail,
              });
            } catch (error) {
              reportError(error);
              throw error;
            }
          }}
          onCreatePreset={async (name, sourceIds) => {
            try {
              const preset = await api.createSourcePreset(name, sourceIds);
              setState((current) => current ? {
                ...current,
                sourcePresets: [...(current.sourcePresets ?? []), preset],
              } : current);
              setNotice({ kind: "success", message: `来源组合“${preset.name}”已保存。` });
            } catch (error) {
              reportError(error);
              throw error;
            }
          }}
          onApplyPreset={async (presetId) => {
            try {
              const result = await api.applySourcePreset(presetId);
              setState((current) => current ? {
                ...current,
                sources: result.sources,
                sourcePresets: (current.sourcePresets ?? []).map((preset) => preset.id === result.preset.id ? result.preset : preset),
              } : current);
              setNotice({ kind: "success", message: `已应用来源组合“${result.preset.name}”。` });
            } catch (error) {
              reportError(error);
              throw error;
            }
          }}
          onDeletePreset={async (presetId) => {
            try {
              await api.deleteSourcePreset(presetId);
              setState((current) => current ? {
                ...current,
                sourcePresets: (current.sourcePresets ?? []).filter((preset) => preset.id !== presetId),
              } : current);
            } catch (error) {
              reportError(error);
              throw error;
            }
          }}
        />
      ) : null}
      {page === "schedule" ? (
        <SchedulePage
          settings={state.settings}
          runs={state.runs}
          health={health}
          onSettings={saveSettings}
          onRefreshHealth={refreshHealth}
          onLaunchPublisher={launchPublisher}
          onOpenRuns={() => navigate("runs")}
          onLoadStorageUsage={loadStorageUsage}
          onExportData={exportData}
          onExportPortableArchive={exportPortableArchive}
          onRestoreData={restoreData}
          onSaveWeChatSettings={saveWeChatSettings}
          onTestWeChatConnection={testWeChatConnection}
        />
      ) : null}
      {page === "runs" ? (
        <RunsPage
          runs={state.runs}
          aiRunTraces={state.aiRunTraces}
          onRetry={retryRun}
          onOpenRun={(runId) => {
            setActiveRunId(runId);
            navigate("workbench");
          }}
          onOpenSchedule={() => navigate("schedule")}
        />
      ) : null}
      {page === "ai-settings" ? (
        <AISettingsPage
          aiSettings={state.aiSettings}
          materials={state.materials}
          onSaveProvider={saveAiProvider}
          onTestProvider={testAiProvider}
          onSaveAgentRole={saveAgentRole}
          onSaveWritingReviewMode={saveWritingReviewMode}
          onSaveSkill={saveSkill}
          onImportSkill={importSkill}
          onUploadMaterial={uploadMaterial}
          onImportMaterial={importMaterial}
          onDeleteMaterial={deleteMaterial}
        />
      ) : null}
    </AppShell>
  );
}

export default App;
