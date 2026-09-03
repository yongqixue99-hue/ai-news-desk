import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  Archive,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  Cloud,
  Columns2,
  Copy,
  ExternalLink,
  FileText,
  FolderOpen,
  History,
  ImagePlus,
  Images,
  Info,
  LoaderCircle,
  MessageSquareText,
  Palette,
  Pencil,
  Plus,
  Save,
  Search,
  Send,
  ShieldAlert,
  RotateCcw,
  SendHorizontal,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import {
  bodyHtmlFor,
  copyRichHtml,
  inlineThemeStyles,
  layoutThemeOptions,
  textFromHtml,
} from "../editor-utils";
import { applyOptimizationChanges, applyOptimizationChangesToHtml } from "../optimization-patches";
import {
  clearDraftRecoverySnapshot,
  editableDraftContent,
  persistDraftRecoverySnapshot,
  restoreDraftFromRecovery,
  switchDraftSafely,
} from "../draft-stability";
import { RichArticleEditor, type RichArticleEditorHandle } from "./RichArticleEditor";
import { WeChatDraftPanel } from "./WeChatDraftPanel";
import { DraftEvidencePanel } from "./DraftEvidencePanel";
import { buildDraftEvidenceView } from "../../server/draft-evidence-view.js";
import { draftStatusLabel, manualDraftStatuses } from "../draft-lifecycle-view";
import { buildDraftQualityView } from "../draft-quality-view";
import { currentPlatformPublicationConfirmation, withoutPlatformPublicationConfirmation } from "../publication-view";
import { buildExternalWritingPrompt } from "../external-writing-bridge";
import { buildDistributionTargets } from "../distribution-view";
import { getRovingTabTarget } from "../hooks/rovingTabs";
import type {
  ArticleDraft,
  AiProviderConfig,
  ArticleAgentDraftInput,
  ArticleAgentRole,
  ArticleAgentThread,
  ArticleOptimizationChange,
  DraftImagePlacement,
  DraftLayoutTheme,
  DraftRevision,
  DraftSaveMode,
  ImageMaterial,
  PublisherResult,
  PublisherPreflightResult,
  PublishedImagePromotionPublicStatus,
  PublisherStatus,
  PlatformPublicationConfirmation,
  WeChatChannelSettings,
  WeChatDraftSyncReceipt,
} from "../types";

interface DraftWorkspaceProps {
  drafts: ArticleDraft[];
  materials: ImageMaterial[];
  analysisProvider?: AiProviderConfig;
  optimizationProvider?: AiProviderConfig;
  activeDraftId?: string;
  busy: boolean;
  publisherStatus?: PublisherStatus;
  wechatSettings: WeChatChannelSettings;
  recentTopics: string[];
  recentCommunities: string[];
  onGoToday: () => void;
  onOpenWorkbench: () => void;
  onSelectDraft: (draftId: string) => void;
  onSave: (draftId: string, patch: Partial<ArticleDraft>, saveMode: DraftSaveMode) => Promise<ArticleDraft>;
  onCompleteInline?: (
    draftId: string,
    input: { before: string; after: string },
    signal: AbortSignal,
    onPreview?: (preview: { text?: string; providerName?: string; model?: string }) => void,
  ) => Promise<{ available: boolean; text?: string; reason?: string; providerName?: string; model?: string }>;
  onLoadRevisions: (draftId: string) => Promise<DraftRevision[]>;
  onRestoreRevision: (
    draftId: string,
    revisionId: string,
  ) => Promise<{ draft: ArticleDraft; revisions: DraftRevision[] }>;
  onUploadImage: (draftId: string, file: File) => Promise<DraftImagePlacement>;
  onImportImage: (draftId: string, url: string, caption?: string) => Promise<DraftImagePlacement>;
  onInsertMaterial: (draftId: string, materialId: string) => Promise<DraftImagePlacement>;
  onLoadPublishedImageMaterialStatuses: (draftId: string) => Promise<PublishedImagePromotionPublicStatus[]>;
  onSavePublishedImageMaterial: (
    draftId: string,
    placementId: string,
  ) => Promise<{ material: ImageMaterial; status: PublishedImagePromotionPublicStatus }>;
  onLoadAgentThreads: (draftId: string) => Promise<ArticleAgentThread[]>;
  onRunArticleAgent: (
    draftId: string,
    role: ArticleAgentRole,
    draft: ArticleAgentDraftInput,
  ) => Promise<ArticleAgentThread>;
  onAskArticleAgent: (
    draftId: string,
    threadId: string,
    message: string,
    draft: ArticleAgentDraftInput,
  ) => Promise<ArticleAgentThread>;
  onLaunchPublisher: () => Promise<void>;
  onOpenPublisherSettings: () => void;
  onPublisherPreflight: (draftId: string) => Promise<PublisherPreflightResult>;
  onFill: (draftId: string) => Promise<PublisherResult | undefined>;
  onSyncWeChatDraft: (
    draftId: string,
    input: { author?: string; digest?: string; contentSourceUrl?: string },
  ) => Promise<WeChatDraftSyncReceipt | undefined>;
  onConfirmPublished: (draftId: string, platform: PublishPlatform) => Promise<PlatformPublicationConfirmation>;
}

type ViewMode = "edit" | "split" | "preview";
type UtilityTab = "agent" | "sources" | "images" | "history" | "publish";
type PublishPlatform = "xiaoheihe" | "wechat";

const utilityTabs: Array<{ id: UtilityTab; label: string; icon: typeof Info }> = [
  { id: "agent", label: "Agent", icon: BrainCircuit },
  { id: "sources", label: "资料", icon: Info },
  { id: "images", label: "图片", icon: Images },
  { id: "history", label: "版本", icon: History },
  { id: "publish", label: "发布", icon: Send },
];

const isCompactViewport = () => window.matchMedia("(max-width: 720px)").matches;

const popularXiaoheiheCommunities = [
  "盒友杂谈",
  "PC游戏",
  "主机游戏",
  "手机游戏",
  "数码硬件",
  "影视动漫",
  "沙雕日常",
  "情投一盒",
] as const;

const publishingKey = (value: string) => value.trim().toLocaleLowerCase("zh-CN");
const includesPublishingValue = (values: string[], value: string) =>
  values.some((entry) => publishingKey(entry) === publishingKey(value));

const strategyLabels = {
  brief: "事实简讯",
  synthesis: "多源综合",
  community: "社区观察",
  playbook: "方案教程",
  curate: "原文导读",
  commentary: "观点评论",
  skip: "证据不足",
} as const;

const editModeLabels = {
  keep: "保留原稿",
  light: "轻微润色",
  targeted: "局部改写",
  rebuild: "建议重构",
} as const;

const formatSaved = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

const draftText = (draft: ArticleDraft) => {
  const sourceLines = draft.sources.map((source) => `${source.label}：${source.url}`).join("\n");
  return `${draft.title}\n\n${textFromHtml(bodyHtmlFor(draft))}\n\n来源：\n${sourceLines}`;
};

const editableDraft = (draft: ArticleDraft | undefined) => {
  if (!draft) return undefined;
  const next = structuredClone(draft);
  next.bodyHtml = bodyHtmlFor(next);
  next.layoutTheme = next.layoutTheme ?? "news-clean";
  return next;
};

export function DraftWorkspace({
  drafts,
  materials,
  analysisProvider,
  optimizationProvider,
  activeDraftId,
  busy,
  publisherStatus,
  wechatSettings,
  recentTopics,
  recentCommunities,
  onGoToday,
  onOpenWorkbench,
  onSelectDraft,
  onSave,
  onCompleteInline,
  onLoadRevisions,
  onRestoreRevision,
  onUploadImage,
  onImportImage,
  onInsertMaterial,
  onLoadPublishedImageMaterialStatuses,
  onSavePublishedImageMaterial,
  onLoadAgentThreads,
  onRunArticleAgent,
  onAskArticleAgent,
  onLaunchPublisher,
  onOpenPublisherSettings,
  onPublisherPreflight,
  onFill,
  onSyncWeChatDraft,
  onConfirmPublished,
}: DraftWorkspaceProps) {
  const [showShelvedDrafts, setShowShelvedDrafts] = useState(false);
  const currentDrafts = drafts.filter((draft) => draft.status !== "shelved");
  const shelvedDraftCount = drafts.length - currentDrafts.length;
  const visibleDrafts = showShelvedDrafts ? drafts : currentDrafts;
  const selected = visibleDrafts.find((draft) => draft.id === activeDraftId) ?? currentDrafts[0] ?? drafts[0];
  const [editing, setEditing] = useState<ArticleDraft | undefined>(() => editableDraft(selected));
  const [viewMode, setViewMode] = useState<ViewMode>(() => isCompactViewport() ? "edit" : "split");
  const [compactLayout, setCompactLayout] = useState(isCompactViewport);
  const [draftLibraryOpen, setDraftLibraryOpen] = useState(false);
  const [utilityTab, setUtilityTab] = useState<UtilityTab | null>(null);
  const [publishPlatform, setPublishPlatform] = useState<PublishPlatform>("wechat");
  const [draftSearch, setDraftSearch] = useState("");
  const [topicInput, setTopicInput] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imageCaption, setImageCaption] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [imageError, setImageError] = useState("");
  const [materialSearch, setMaterialSearch] = useState("");
  const [materialBusyId, setMaterialBusyId] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [savingMode, setSavingMode] = useState<DraftSaveMode>();
  const [dirty, setDirty] = useState(false);
  const [switchingDraftId, setSwitchingDraftId] = useState<string>();
  const [recoveryMessage, setRecoveryMessage] = useState("");
  const [editVersion, setEditVersion] = useState(0);
  const [lastSavedAt, setLastSavedAt] = useState(selected?.updatedAt ?? "");
  const [lastSaveMode, setLastSaveMode] = useState<DraftSaveMode>();
  const [saveError, setSaveError] = useState("");
  const [revisions, setRevisions] = useState<DraftRevision[]>([]);
  const [revisionsLoading, setRevisionsLoading] = useState(false);
  const [restoringRevisionId, setRestoringRevisionId] = useState<string>();
  const [restoreConfirmId, setRestoreConfirmId] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [copiedRich, setCopiedRich] = useState(false);
  const [agentMode, setAgentMode] = useState<ArticleAgentRole>("analysis");
  const [agentThreads, setAgentThreads] = useState<ArticleAgentThread[]>([]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentBusy, setAgentBusy] = useState<ArticleAgentRole | "chat">();
  const [agentQuestion, setAgentQuestion] = useState("");
  const [agentError, setAgentError] = useState("");
  const [agentCopied, setAgentCopied] = useState(false);
  const [externalPromptCopied, setExternalPromptCopied] = useState(false);
  const [optimizationDecisions, setOptimizationDecisions] = useState<Record<string, "applied" | "ignored">>({});
  const [fillResult, setFillResult] = useState<PublisherResult | undefined>();
  const [preflight, setPreflight] = useState<PublisherPreflightResult>();
  const [preflightBusy, setPreflightBusy] = useState(false);
  const [preflightError, setPreflightError] = useState("");
  const [confirmingPublication, setConfirmingPublication] = useState(false);
  const [publishedImageStatuses, setPublishedImageStatuses] = useState<PublishedImagePromotionPublicStatus[]>([]);
  const [publishedImageStatusLoading, setPublishedImageStatusLoading] = useState(false);
  const [publishedImageSavingId, setPublishedImageSavingId] = useState<string>();
  const [publishedImageError, setPublishedImageError] = useState("");
  const richEditor = useRef<RichArticleEditorHandle>(null);
  const drawerFileInput = useRef<HTMLInputElement>(null);
  const editingRef = useRef<ArticleDraft | undefined>(editing);
  const dirtyRef = useRef(false);
  const editVersionRef = useRef(0);
  const activeSaveRef = useRef<Promise<ArticleDraft> | null>(null);
  const bestEffortFlushStartedRef = useRef(false);
  const saveHandlerRef = useRef(onSave);
  const revisionLoaderRef = useRef(onLoadRevisions);
  const agentThreadLoaderRef = useRef(onLoadAgentThreads);
  const publishedImageStatusLoaderRef = useRef(onLoadPublishedImageMaterialStatuses);
  const utilityTabListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const recovered = selected
      ? restoreDraftFromRecovery(window.localStorage, selected)
      : undefined;
    const next = editableDraft(recovered ?? selected);
    editingRef.current = next;
    setEditing(next);
    setFillResult(selected?.fillResult);
    setPreflight(selected?.fillResult?.preflight);
    setPreflightError("");
    setConfirmingPublication(false);
    setPublishedImageStatuses([]);
    setPublishedImageStatusLoading(false);
    setPublishedImageSavingId(undefined);
    setPublishedImageError("");
    dirtyRef.current = Boolean(recovered);
    setDirty(Boolean(recovered));
    setRecoveryMessage(recovered ? "已恢复上次关闭前的修改，将自动保存" : "");
    setSaveError("");
    setLastSavedAt(selected?.updatedAt ?? "");
    setLastSaveMode(undefined);
    setRevisions([]);
    setAgentThreads([]);
    setAgentQuestion("");
    setAgentError("");
    setOptimizationDecisions({});
    setRestoreConfirmId(undefined);
    editVersionRef.current += 1;
    setEditVersion(editVersionRef.current);
  }, [selected?.id]);

  useEffect(() => {
    if (!showShelvedDrafts && selected && activeDraftId !== selected.id) onSelectDraft(selected.id);
  }, [activeDraftId, onSelectDraft, selected?.id, showShelvedDrafts]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    saveHandlerRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    revisionLoaderRef.current = onLoadRevisions;
  }, [onLoadRevisions]);

  useEffect(() => {
    agentThreadLoaderRef.current = onLoadAgentThreads;
  }, [onLoadAgentThreads]);

  useEffect(() => {
    publishedImageStatusLoaderRef.current = onLoadPublishedImageMaterialStatuses;
  }, [onLoadPublishedImageMaterialStatuses]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setCompactLayout(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const insertedMediaIds = useMemo(() => {
    const ids = new Set<string>();
    for (const match of editing?.bodyHtml?.matchAll(/data-media-id=["']([^"']+)["']/g) ?? []) {
      ids.add(match[1]);
    }
    return ids;
  }, [editing?.bodyHtml]);

  const articleCharCount = editing
    ? `${editing.title}${textFromHtml(editing.bodyHtml || "")}`.replace(/\s/g, "").length
    : 0;

  const filteredDrafts = useMemo(() => {
    const query = draftSearch.trim().toLowerCase();
    if (!query) return visibleDrafts;
    return visibleDrafts.filter((draft) =>
      `${draft.title} ${draft.sources[0]?.label ?? ""}`.toLowerCase().includes(query),
    );
  }, [draftSearch, visibleDrafts]);

  const save = useCallback(async (mode: DraftSaveMode = "manual") => {
    if (activeSaveRef.current) {
      await activeSaveRef.current.catch(() => undefined);
    }
    const current = editingRef.current;
    if (!current) return undefined;
    const versionAtStart = editVersionRef.current;
    setSaving(true);
    setSavingMode(mode);
    setSaveError("");
    const operation = saveHandlerRef.current(current.id, editableDraftContent(current), mode);
    activeSaveRef.current = operation;
    try {
      const saved = await operation;
      setEditing((value) => {
        if (value?.id !== saved.id) return value;
        const next = { ...value, updatedAt: saved.updatedAt };
        editingRef.current = next;
        return next;
      });
      setLastSavedAt(saved.updatedAt);
      setLastSaveMode(mode);
      if (editingRef.current?.id === saved.id && editVersionRef.current === versionAtStart) {
        dirtyRef.current = false;
        setDirty(false);
        setRecoveryMessage("");
        clearDraftRecoverySnapshot(window.localStorage, saved.id);
      }
      return saved;
    } catch (error) {
      const latest = editingRef.current;
      if (latest) persistDraftRecoverySnapshot(window.localStorage, latest);
      setSaveError(mode === "auto" ? "自动保存失败，内容仍在当前页面" : "保存失败，请重试");
      throw error;
    } finally {
      if (activeSaveRef.current === operation) activeSaveRef.current = null;
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!dirty || saving) return;
    const timer = window.setTimeout(() => {
      void save("auto").catch(() => undefined);
    }, 1_100);
    return () => window.clearTimeout(timer);
  }, [dirty, editVersion, save, saving]);

  useEffect(() => {
    if (!dirty || !editing) return;
    persistDraftRecoverySnapshot(window.localStorage, editing);
  }, [dirty, editVersion, editing]);

  useEffect(() => {
    const persistCurrent = () => {
      const current = editingRef.current;
      if (!current || !dirtyRef.current) return undefined;
      persistDraftRecoverySnapshot(window.localStorage, current);
      return current;
    };

    const flushBestEffort = () => {
      const snapshot = persistCurrent();
      if (!snapshot || bestEffortFlushStartedRef.current) return;
      bestEffortFlushStartedRef.current = true;
      const pending = activeSaveRef.current;
      const waitForPending = pending
        ? pending.then(() => undefined, () => undefined)
        : Promise.resolve();
      void waitForPending.then(async () => {
        if (!dirtyRef.current) return;
        const current = editingRef.current;
        if (!current) return;
        const versionAtStart = editVersionRef.current;
        try {
          await saveHandlerRef.current(current.id, editableDraftContent(current), "auto");
          if (editingRef.current?.id === current.id && editVersionRef.current === versionAtStart) {
            dirtyRef.current = false;
            clearDraftRecoverySnapshot(window.localStorage, current.id);
          }
        } catch {
          persistDraftRecoverySnapshot(window.localStorage, editingRef.current ?? current);
        }
      }).finally(() => {
        bestEffortFlushStartedRef.current = false;
      });
    };

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      persistCurrent();
      flushBestEffort();
      event.preventDefault();
      event.returnValue = "";
    };
    const handlePageHide = () => flushBestEffort();

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handlePageHide);
      flushBestEffort();
    };
  }, []);

  useEffect(() => {
    const draftId = editing?.id;
    if (utilityTab !== "history" || !draftId) return;
    let active = true;
    setRevisionsLoading(true);
    revisionLoaderRef.current(draftId)
      .then((items) => { if (active) setRevisions(items); })
      .catch(() => undefined)
      .finally(() => { if (active) setRevisionsLoading(false); });
    return () => { active = false; };
  }, [editing?.id, lastSavedAt, utilityTab]);

  useEffect(() => {
    const draftId = editing?.id;
    if (utilityTab !== "agent" || !draftId) return;
    let active = true;
    setAgentLoading(true);
    setAgentError("");
    agentThreadLoaderRef.current(draftId)
      .then((threads) => { if (active) setAgentThreads(threads); })
      .catch((error) => { if (active) setAgentError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (active) setAgentLoading(false); });
    return () => { active = false; };
  }, [editing?.id, utilityTab]);

  useEffect(() => {
    const draftId = editing?.id;
    const xiaoheiheConfirmation = editing
      ? currentPlatformPublicationConfirmation(editing, "xiaoheihe")
      : undefined;
    if (utilityTab !== "publish" || !draftId || !xiaoheiheConfirmation) return;
    let active = true;
    setPublishedImageStatusLoading(true);
    setPublishedImageError("");
    publishedImageStatusLoaderRef.current(draftId)
      .then((statuses) => { if (active) setPublishedImageStatuses(statuses); })
      .catch((error) => {
        if (active) setPublishedImageError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (active) setPublishedImageStatusLoading(false); });
    return () => { active = false; };
  }, [editing?.id, editing?.publicationConfirmations?.xiaoheihe, utilityTab]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save("manual").catch(() => undefined);
      }
      if (event.key === "Escape") {
        setDraftLibraryOpen(false);
        setUtilityTab(null);
      }
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [save]);

  if (!editing) {
    return (
      <div className="page empty-drafts-page">
        <header className="page-header"><div><h1>文章草稿</h1><p>生成后的独立快讯会集中保存在这里。</p></div></header>
        <div className="large-empty-state">
          <Cloud size={35} />
          <h2>还没有草稿</h2>
          <p>可以从今日事件推荐采用一条新闻，也可以到新闻工作台粘贴链接或上传截图。</p>
          <div className="draft-empty-actions">
            <button type="button" className="primary-button" onClick={onGoToday}>去今日选题</button>
            <button type="button" className="secondary-button" onClick={onOpenWorkbench}>截图／链接成稿</button>
          </div>
        </div>
      </div>
    );
  }

  const updateEditing = (patch: Partial<ArticleDraft>) => {
    setEditing((current) => {
      if (!current) return current;
      const next = { ...current, ...patch };
      editingRef.current = next;
      return next;
    });
    editVersionRef.current += 1;
    setEditVersion(editVersionRef.current);
    dirtyRef.current = true;
    setDirty(true);
    setSaveError("");
  };

  const selectDraft = async (draftId: string) => {
    if (draftId === editing.id) {
      setDraftLibraryOpen(false);
      return;
    }
    if (switchingDraftId) return;
    setSwitchingDraftId(draftId);
    setSaveError("");
    try {
      await switchDraftSafely({
        targetDraftId: draftId,
        hasDirtyChanges: () => dirtyRef.current || Boolean(activeSaveRef.current),
        flush: async () => {
          const pending = activeSaveRef.current;
          if (pending) await pending;
          if (dirtyRef.current) await save("manual");
        },
        select: (nextDraftId) => {
          onSelectDraft(nextDraftId);
          setDraftLibraryOpen(false);
        },
      });
    } catch {
      const current = editingRef.current;
      if (current) persistDraftRecoverySnapshot(window.localStorage, current);
      setSaveError("切换前保存失败，仍停留在当前草稿；请检查连接后重试");
    } finally {
      setSwitchingDraftId(undefined);
    }
  };

  const copy = async () => {
    const text = draftText(editing);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const fallback = document.createElement("textarea");
      fallback.value = text;
      fallback.style.position = "fixed";
      fallback.style.opacity = "0";
      document.body.append(fallback);
      fallback.select();
      document.execCommand("copy");
      fallback.remove();
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  };

  const copyFormatted = async () => {
    const theme = editing.layoutTheme ?? "news-clean";
    const title = document.createElement("h1");
    title.textContent = editing.title;
    const richBody = inlineThemeStyles(`${title.outerHTML}${editing.bodyHtml || ""}`, theme);
    await copyRichHtml(richBody, draftText(editing));
    setCopiedRich(true);
    window.setTimeout(() => setCopiedRich(false), 1_500);
  };

  const uploadImage = async (file: File) => {
    const placement = await onUploadImage(editing.id, file);
    setEditing((current) => {
      if (!current) return current;
      const next = { ...current, images: [...current.images, placement] };
      editingRef.current = next;
      return next;
    });
    editVersionRef.current += 1;
    setEditVersion(editVersionRef.current);
    dirtyRef.current = true;
    setDirty(true);
    return placement;
  };

  const importImage = async (url: string, caption?: string) => {
    const placement = await onImportImage(editing.id, url, caption);
    setEditing((current) => {
      if (!current) return current;
      const next = { ...current, images: [...current.images, placement] };
      editingRef.current = next;
      return next;
    });
    editVersionRef.current += 1;
    setEditVersion(editVersionRef.current);
    dirtyRef.current = true;
    setDirty(true);
    return placement;
  };

  const importDrawerImage = async () => {
    if (!imageUrl.trim()) return;
    setImageBusy(true);
    setImageError("");
    try {
      await importImage(imageUrl.trim(), imageCaption.trim() || undefined);
      setImageUrl("");
      setImageCaption("");
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setImageBusy(false);
    }
  };

  const addMaterial = async (material: ImageMaterial) => {
    setMaterialBusyId(material.id);
    setImageError("");
    try {
      const placement = await onInsertMaterial(editing.id, material.id);
      setEditing((current) => {
        if (!current) return current;
        const next = { ...current, images: [...current.images, placement] };
        editingRef.current = next;
        return next;
      });
      editVersionRef.current += 1;
      setEditVersion(editVersionRef.current);
      dirtyRef.current = true;
      setDirty(true);
      insertImage(placement);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : String(error));
    } finally {
      setMaterialBusyId(undefined);
    }
  };

  const addTopic = () => {
    const next = topicInput.trim();
    if (!next || editing.topics.includes(next)) return;
    updateEditing({ topics: [...editing.topics, next].slice(0, 5) });
    setTopicInput("");
  };

  const updateFactClaim = (claimId: string, status: NonNullable<ArticleDraft["factClaims"]>[number]["status"]) => {
    updateEditing({
      factClaims: (editing.factClaims ?? []).map((claim) => claim.id === claimId ? { ...claim, status } : claim),
    });
  };

  const updateImageGovernance = (
    placementId: string,
    patch: Partial<ArticleDraft["images"][number]["image"]>,
  ) => {
    updateEditing({
      images: editing.images.map((placement) => placement.id === placementId
        ? { ...placement, image: { ...placement.image, ...patch } }
        : placement),
    });
  };

  const updateImagePlatform = (placementId: string, platform: "xiaoheihe" | "wechat", enabled: boolean) => {
    const placement = editing.images.find((entry) => entry.id === placementId);
    if (!placement) return;
    const current = placement.image.allowedPlatforms ?? [];
    const allowedPlatforms = current.includes("*")
      ? enabled
        ? current
        : [platform === "wechat" ? "xiaoheihe" : "wechat"]
      : enabled
        ? [...new Set([...current, platform])]
        : current.filter((entry) => entry !== platform);
    updateImageGovernance(placementId, { allowedPlatforms });
  };

  const checkPublisher = async (saveFirst = false) => {
    setPreflightBusy(true);
    setPreflightError("");
    try {
      if (saveFirst) await save("manual");
      const result = await onPublisherPreflight(editing.id);
      setPreflight(result);
      return result;
    } catch (error) {
      setPreflightError(error instanceof Error ? error.message : String(error));
      return undefined;
    } finally {
      setPreflightBusy(false);
    }
  };

  const fill = async () => {
    const latestPreflight = await checkPublisher(true);
    if (!latestPreflight?.canQueueFill) return;
    const result = await onFill(editing.id);
    setFillResult(result);
    if (result?.preflight) setPreflight(result.preflight);
    if (result) {
      setEditing((current) => {
        if (!current) return current;
        const next = {
          ...current,
          fillResult: result,
          publisherReceipt: result.receipt,
          status: result.ok ? "filled" as const : "editing" as const,
          publicationConfirmations: result.ok
            ? withoutPlatformPublicationConfirmation(current, "xiaoheihe")
            : current.publicationConfirmations,
        };
        editingRef.current = next;
        return next;
      });
    }
  };

  const syncWeChat = async (input: { author?: string; digest?: string; contentSourceUrl?: string }) => {
    const receipt = await onSyncWeChatDraft(editing.id, input);
    if (receipt) {
      setEditing((current) => {
        if (!current) return current;
        const currentWechatConfirmation = currentPlatformPublicationConfirmation(current, "wechat");
        const next = {
          ...current,
          wechatDraft: receipt,
          publicationConfirmations: currentWechatConfirmation?.revisionHash === receipt.revisionHash
            ? current.publicationConfirmations
            : withoutPlatformPublicationConfirmation(current, "wechat"),
        };
        editingRef.current = next;
        return next;
      });
    }
    return receipt;
  };

  const confirmPublication = async (platform: PublishPlatform) => {
    setConfirmingPublication(true);
    try {
      const confirmation = await onConfirmPublished(editing.id, platform);
      setEditing((current) => {
        if (!current) return current;
        const next = {
          ...current,
          status: "published" as const,
          publicationConfirmations: {
            ...(current.publicationConfirmations ?? {}),
            [platform]: confirmation,
          },
          publicationConfirmedAt: confirmation.confirmedAt,
          publicationReceiptId: confirmation.receiptId,
        };
        editingRef.current = next;
        return next;
      });
    } finally {
      setConfirmingPublication(false);
    }
  };

  const savePublishedImage = async (placementId: string) => {
    setPublishedImageSavingId(placementId);
    setPublishedImageError("");
    try {
      const result = await onSavePublishedImageMaterial(editing.id, placementId);
      setPublishedImageStatuses((current) => current.map((status) =>
        status.placementId === placementId ? result.status : status,
      ));
    } catch (error) {
      setPublishedImageError(error instanceof Error ? error.message : String(error));
      try {
        setPublishedImageStatuses(await publishedImageStatusLoaderRef.current(editing.id));
      } catch {
        // Keep the original save error; the parent also surfaces it globally.
      }
    } finally {
      setPublishedImageSavingId(undefined);
    }
  };

  const restoreRevision = async (revisionId: string) => {
    setRestoringRevisionId(revisionId);
    try {
      if (dirty) await save("manual");
      const result = await onRestoreRevision(editing.id, revisionId);
      const next = editableDraft(result.draft);
      editingRef.current = next;
      setEditing(next);
      editVersionRef.current += 1;
      setEditVersion(editVersionRef.current);
      dirtyRef.current = false;
      setDirty(false);
      setRecoveryMessage("");
      clearDraftRecoverySnapshot(window.localStorage, result.draft.id);
      setSaveError("");
      setLastSavedAt(result.draft.updatedAt);
      setLastSaveMode("manual");
      setRevisions(result.revisions);
      setRestoreConfirmId(undefined);
    } catch {
      // The parent displays the actionable request error.
    } finally {
      setRestoringRevisionId(undefined);
    }
  };

  const insertImage = (placement: DraftImagePlacement) => {
    if (viewMode === "preview") setViewMode("edit");
    window.setTimeout(() => richEditor.current?.insertImage(placement), 40);
  };

  const activeAgentThread = agentThreads.find((thread) => thread.role === agentMode);
  const activeOptimization = activeAgentThread?.optimization;
  const pendingOptimizationChanges = (activeOptimization?.changes ?? []).filter(
    (change) => !optimizationDecisions[change.id],
  );
  const safePendingOptimizationChanges = pendingOptimizationChanges.filter((change) => change.factCheckPassed);
  const selectedAgentProvider = agentMode === "analysis" ? analysisProvider : optimizationProvider;
  const agentDraftInput = (repairQualityWarnings = false): ArticleAgentDraftInput => {
    const current = editingRef.current ?? editing;
    return {
      title: current.title,
      bodyHtml: current.bodyHtml || bodyHtmlFor(current),
      paragraphs: current.paragraphs,
      take: current.take,
      ...(repairQualityWarnings ? { repairQualityWarnings: true } : {}),
    };
  };
  const updateAgentThread = (thread: ArticleAgentThread) => {
    setAgentThreads((current) => [thread, ...current.filter((entry) => entry.id !== thread.id)]);
    setOptimizationDecisions({});
  };
  const runAgent = async (role: ArticleAgentRole, repairQualityWarnings = false) => {
    setAgentMode(role);
    setAgentBusy(role);
    setAgentError("");
    try {
      if (dirty) await save("manual");
      updateAgentThread(await onRunArticleAgent(editing.id, role, agentDraftInput(repairQualityWarnings)));
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentBusy(undefined);
    }
  };
  const askAgent = async (preset?: string) => {
    const question = (preset ?? agentQuestion).trim();
    if (!activeAgentThread || !question) return;
    setAgentBusy("chat");
    setAgentError("");
    try {
      updateAgentThread(await onAskArticleAgent(
        editing.id,
        activeAgentThread.id,
        question,
        agentDraftInput(),
      ));
      setAgentQuestion("");
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentBusy(undefined);
    }
  };
  const copyOptimization = async () => {
    const proposal = activeAgentThread?.optimization;
    if (!proposal) return;
    const changes = proposal.changes ?? [];
    const text = changes.length
      ? changes.map((change, index) => [
          `${index + 1}. ${change.reason}`,
          `原文：${change.before}`,
          `建议：${change.after || "（删除此段）"}`,
        ].join("\n")).join("\n\n")
      : proposal.editMode === "keep"
        ? "当前稿件无需改写，建议保留原文。"
        : proposal.optimizedTitle
          ? [proposal.optimizedTitle, "", ...(proposal.optimizedParagraphs ?? []), "", proposal.optimizedTake || ""]
              .filter((value, index, values) => value || (index > 0 && values[index - 1]))
              .join("\n\n")
          : [
              ...proposal.diagnosis.map((item) => `问题：${item}`),
              ...proposal.improvements.map((item) => `下一步：${item}`),
              ...proposal.factWarnings.map((item) => `需核对：${item}`),
            ].join("\n");
    await navigator.clipboard.writeText(text);
    setAgentCopied(true);
    window.setTimeout(() => setAgentCopied(false), 1_500);
  };
  const copyExternalWritingPrompt = async () => {
    const current = editingRef.current ?? editing;
    await navigator.clipboard.writeText(buildExternalWritingPrompt(current));
    setExternalPromptCopied(true);
    window.setTimeout(() => setExternalPromptCopied(false), 1_800);
  };
  const applyOptimization = async (requestedChanges: ArticleOptimizationChange[], safeOnly = false) => {
    const proposal = activeAgentThread?.optimization;
    if (!proposal || !requestedChanges.length) return;
    const current = editingRef.current ?? editing;
    const changes = requestedChanges.filter((change) => {
      if (!safeOnly || change.factCheckPassed) return true;
      return false;
    });
    if (!changes.length) {
      setAgentError("没有可自动应用且通过事实保护的修改");
      return;
    }
    if (!safeOnly && changes.some((change) => !change.factCheckPassed)) {
      const confirmed = window.confirm("这项修改没有通过事实锚点检查。仍要应用吗？应用前会保存当前版本。");
      if (!confirmed) return;
    }
    setAgentBusy("optimization");
    setAgentError("");
    try {
      await save("manual");
      const currentHtml = current.bodyHtml || bodyHtmlFor(current);
      const htmlResult = applyOptimizationChangesToHtml(currentHtml, changes);
      const htmlAppliedIds = new Set(htmlResult.appliedIds);
      const titleResult = applyOptimizationChanges({
        title: current.title,
        paragraphs: current.paragraphs,
        take: current.take,
      }, changes.filter((change) => change.blockId === "title"), { safeOnly });
      for (const conflict of titleResult.conflicts) htmlAppliedIds.delete(conflict.id);
      const appliedChanges = changes.filter((change) => htmlAppliedIds.has(change.id));
      const nextParagraphs = [...current.paragraphs];
      let nextTake = current.take;
      for (const change of appliedChanges) {
        const paragraphIndex = /^paragraph:(\d+)$/.exec(change.blockId)?.[1];
        if (paragraphIndex !== undefined && nextParagraphs[Number(paragraphIndex)]?.replace(/\s+/g, " ").trim() === change.before.replace(/\s+/g, " ").trim()) {
          nextParagraphs[Number(paragraphIndex)] = change.after.trim();
        }
        if (change.blockId === "take" && nextTake.replace(/\s+/g, " ").trim() === change.before.replace(/\s+/g, " ").trim()) {
          nextTake = change.after.trim();
        }
      }
      const nextFactClaims = current.factClaims?.map((claim, index) => {
        const paragraphChange = appliedChanges.find((change) => change.blockId === `paragraph:${index}`);
        if (!paragraphChange?.affectedFactIds.length) return claim;
        return {
          ...claim,
          claim: nextParagraphs[index] ?? claim.claim,
          factIds: [...new Set([...(claim.factIds ?? []), ...paragraphChange.affectedFactIds])],
        };
      });
      updateEditing({
        title: titleResult.draft.title,
        paragraphs: nextParagraphs,
        take: nextTake,
        bodyHtml: htmlResult.html,
        ...(nextFactClaims ? { factClaims: nextFactClaims } : {}),
      });
      setOptimizationDecisions((decisions) => ({
        ...decisions,
        ...Object.fromEntries(appliedChanges.map((change) => [change.id, "applied" as const])),
      }));
      const conflicts = [...htmlResult.conflicts, ...titleResult.conflicts];
      if (conflicts.length) setAgentError(conflicts.map((conflict) => conflict.reason).join("；"));
      setViewMode(compactLayout ? "edit" : "split");
    } catch (error) {
      setAgentError(error instanceof Error ? error.message : String(error));
    } finally {
      setAgentBusy(undefined);
    }
  };

  const ignoreOptimizationChange = (changeId: string) => {
    setOptimizationDecisions((current) => {
      if (current[changeId] === "ignored") {
        const next = { ...current };
        delete next[changeId];
        return next;
      }
      return { ...current, [changeId]: "ignored" };
    });
  };

  const evidenceView = buildDraftEvidenceView(editing);
  const factClaims = [...evidenceView.automaticClaims, ...evidenceView.attentionClaims];
  const verifiedSourceCount = evidenceView.eventSources.filter((source) => source.verified).length;
  const insertedImages = editing.images.filter((placement) => insertedMediaIds.has(placement.id));
  const uncheckedImageCount = insertedImages.filter((placement) => placement.image.rights === "check-required").length;
  const recentCommunityOptions = recentCommunities.filter((community, index, values) =>
    community.trim() && values.findIndex((entry) => publishingKey(entry) === publishingKey(community)) === index,
  );
  const popularCommunityOptions = popularXiaoheiheCommunities.filter(
    (community) => !includesPublishingValue(recentCommunityOptions, community),
  );
  const customCommunityOption = !includesPublishingValue(
    [...recentCommunityOptions, ...popularCommunityOptions],
    editing.community,
  ) ? editing.community : undefined;
  const xiaoheihePublication = dirty ? undefined : currentPlatformPublicationConfirmation(editing, "xiaoheihe");
  const wechatPublication = dirty ? undefined : currentPlatformPublicationConfirmation(editing, "wechat");
  const rememberedPublication = Boolean(xiaoheihePublication);
  const loginRequired = Boolean(fillResult?.steps.some((step) => step.name === "登录" && !step.ok));
  const publishMetadataReady = Boolean(fillResult?.ok && ["分区", "话题"].every(
    (name) => fillResult.steps.find((step) => step.name === name)?.ok === true,
  ));
  const readiness = [
    { label: `标题 ${editing.title.trim().length}/60 字`, ok: editing.title.trim().length > 0 && editing.title.trim().length <= 60 },
    { label: `正文已插入 ${insertedMediaIds.size} 张图`, ok: insertedMediaIds.size > 0 },
    { label: `事件来源 ${verifiedSourceCount}/${evidenceView.eventSources.length}`, ok: evidenceView.eventSources.length > 0 && evidenceView.sourceDecisionCount === 0 },
    { label: factClaims.length ? `事实证据 ${evidenceView.automaticFactCount}/${factClaims.length}` : "尚未建立事实证据", ok: factClaims.length > 0 && evidenceView.attentionClaims.length === 0 },
    { label: evidenceView.factUncertainties.length ? `${evidenceView.factUncertainties.length} 项事实待确认` : "没有需要你确认的事实", ok: evidenceView.factUncertainties.length === 0 },
    { label: uncheckedImageCount ? `${uncheckedImageCount} 张图片版权待确认` : "图片来源标注已检查", ok: uncheckedImageCount === 0 },
  ];
  const saveStateText = switchingDraftId
    ? "正在保存并切换草稿…"
    : saving
    ? savingMode === "auto" ? "正在自动保存…" : "正在保存…"
    : saveError
      ? saveError
      : dirty
        ? recoveryMessage || "将在 1 秒后自动保存"
        : lastSaveMode === "auto"
          ? `已自动保存 ${formatSaved(lastSavedAt || editing.updatedAt)}`
          : `已保存 ${formatSaved(lastSavedAt || editing.updatedAt)}`;
  const utilityHeading = utilityTab === "agent"
    ? { title: "文章 Agent", subtitle: "原文与草稿一起理解" }
    : utilityTab === "sources"
      ? { title: "资料与溯源", subtitle: "随写随用" }
      : utilityTab === "images"
      ? { title: "文章配图", subtitle: "随写随用" }
      : utilityTab === "history"
        ? { title: "版本历史", subtitle: "自动保存与随时恢复" }
        : { title: "发布设置", subtitle: "确认后填入平台编辑器" };
  const publisherReady = Boolean(publisherStatus?.ok);
  const distributionTargets = buildDistributionTargets({
    draft: editing,
    dirty,
    publisherReady,
    wechatConfigured: Boolean(wechatSettings.appId && wechatSettings.appSecretConfigured),
  });
  const draftQuality = buildDraftQualityView(editing.qualityWarnings);
  const extensionPublisher = publisherStatus?.mode !== "cdp";
  const publishGuidance = !publisherReady
    ? extensionPublisher
      ? "暂不能填入：请先在常用 Chrome 加载填入助手，并刷新工作台。"
      : "暂不能填入：请先启动 CDP 备用浏览器。"
    : loginRequired
      ? "小黑盒已打开登录页；完成登录后，再点击下方按钮重新填入。"
    : evidenceView.factUncertainties.length
      ? `可以填入，但发布前还有 ${evidenceView.factUncertainties.length} 项事实需要确认。`
      : uncheckedImageCount
        ? `可以填入，但发布前还有 ${uncheckedImageCount} 张图片需要确认转载权限。`
        : "检查已通过；只填入编辑器，不会自动发布。";
  const passedReadinessCount = readiness.filter((item) => item.ok).length;
  const nextAction = evidenceView.factDecisionCount
    ? {
        tab: "sources" as const,
        label: `确实有 ${evidenceView.factDecisionCount} 项需要你确认`,
        detail: "这里只保留会影响正文准确性的事实问题。",
        action: "查看待确认项",
      }
    : evidenceView.sourceDecisionCount
      ? {
          tab: "sources" as const,
          label: "系统还在补充事件来源",
          detail: "这不是你的待办；正文仍可阅读，来源补齐后会自动更新状态。",
          action: "查看当前证据",
        }
      : draftQuality.warnings.length
        ? {
            tab: draftQuality.nextTab,
            label: draftQuality.headline,
            detail: draftQuality.detail,
            action: draftQuality.nextTab === "images"
              ? "补齐配图"
              : draftQuality.nextTab === "sources"
                ? "查看证据"
                : draftQuality.actionKind === "quality-repair" ? "定向补写" : "查看改稿建议",
          }
      : {
          tab: "sources" as const,
          label: "草稿已生成，先看正文即可",
          detail: "事实和来源已经自动整理；图片权限与平台设置只在你准备发布时提示。",
          action: "查看自动核验",
        };
  const handleUtilityTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!utilityTab) return;
    const currentIndex = utilityTabs.findIndex((tab) => tab.id === utilityTab);
    const nextIndex = getRovingTabTarget(utilityTabs.length, currentIndex, event.key);
    if (nextIndex === null) return;
    event.preventDefault();
    setUtilityTab(utilityTabs[nextIndex].id);
    window.requestAnimationFrame(() => {
      utilityTabListRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
    });
  };

  const editorPane = (
    <section className="draft-pane editor-pane" aria-label="正文编辑区">
      <div className="draft-pane-heading">
        <strong><Pencil size={15} />正文</strong>
        <span>约 {articleCharCount} 字</span>
      </div>
      <RichArticleEditor
        key={`${editing.id}-editor`}
        ref={richEditor}
        draftId={editing.id}
        title={editing.title}
        content={editing.bodyHtml || ""}
        preview={false}
        theme={editing.layoutTheme ?? "news-clean"}
        onChange={(bodyHtml) => updateEditing({ bodyHtml })}
        onUploadFile={uploadImage}
        onImportUrl={importImage}
        onRequestCompletion={editing.provenance.contentPackageId && onCompleteInline
          ? (input, signal, onPreview) => onCompleteInline(editing.id, input, signal, onPreview)
          : undefined}
      />
    </section>
  );

  const previewPane = (
    <section className="draft-pane preview-pane" aria-label="文章内容预览">
      <div className="draft-pane-heading">
        <strong>文章 · 内容预览</strong>
        <span>手机端正文宽度</span>
      </div>
      <RichArticleEditor
        key={`${editing.id}-preview`}
        title={editing.title}
        content={editing.bodyHtml || ""}
        preview
        theme={editing.layoutTheme ?? "news-clean"}
        onChange={() => undefined}
        onUploadFile={uploadImage}
        onImportUrl={importImage}
      />
    </section>
  );

  return (
    <div className="page draft-page draft-page-v2">
      <header className="draft-topbar-v2">
        <button
          className={draftLibraryOpen ? "draft-library-trigger active" : "draft-library-trigger"}
          aria-expanded={draftLibraryOpen}
          onClick={() => setDraftLibraryOpen((open) => !open)}
        >
          <FolderOpen size={17} />
          <span>草稿库</span>
          <small>{currentDrafts.length}</small>
        </button>

        <div className="draft-document-heading">
          <input
            className="draft-title-input"
            value={editing.title}
            onChange={(event) => updateEditing({ title: event.target.value })}
            aria-label="文章标题"
          />
          <div className={saveError ? "draft-save-state error" : "draft-save-state"}>
            <Cloud size={13} />
            <span>{saveStateText}</span>
            {editing.draftStrategy ? <em className="draft-strategy-badge">{strategyLabels[editing.draftStrategy]}</em> : null}
            <i aria-hidden="true" />
            <label className="draft-lifecycle-control">
              <span className="sr-only">草稿状态</span>
              <select
                aria-label="草稿状态"
                value={editing.status}
                disabled={["filled", "published"].includes(editing.status)}
                onChange={(event) => updateEditing({ status: event.target.value as ArticleDraft["status"] })}
              >
                {[...new Set([editing.status, ...manualDraftStatuses])].map((status) => <option key={status} value={status}>{draftStatusLabel[status]}</option>)}
              </select>
            </label>
          </div>
        </div>

        <div className="draft-header-controls">
          <label className="draft-theme-control" title="预览排版主题">
            <Palette size={15} />
            <select
              aria-label="排版主题"
              value={editing.layoutTheme ?? "news-clean"}
              onChange={(event) => updateEditing({ layoutTheme: event.target.value as DraftLayoutTheme })}
            >
              {layoutThemeOptions.map((theme) => <option key={theme.id} value={theme.id}>{theme.label}</option>)}
            </select>
          </label>
          <div className="draft-view-switch" aria-label="编辑与预览视图">
            <button className={viewMode === "edit" ? "active" : ""} aria-pressed={viewMode === "edit"} onClick={() => setViewMode("edit")}>仅编辑</button>
            <button className={viewMode === "split" ? "active" : ""} aria-pressed={viewMode === "split"} onClick={() => setViewMode("split")}><Columns2 size={14} />对照</button>
            <button className={viewMode === "preview" ? "active" : ""} aria-pressed={viewMode === "preview"} onClick={() => setViewMode("preview")}>仅预览</button>
          </div>
          <button className="draft-quick-save" aria-label="保存草稿" title="保存草稿并创建版本（⌘/Ctrl+S）" onClick={() => void save("manual").catch(() => undefined)} disabled={saving}>
            {saving ? <LoaderCircle className="spin" size={17} /> : <Save size={17} />}
          </button>
        </div>
      </header>

      <section className={`draft-next-action next-${nextAction.tab}`} aria-label="当前草稿的下一步">
        <div className="draft-next-action-copy">
          <span>下一步</span>
          <strong>{nextAction.label}</strong>
          <small>{nextAction.detail}</small>
        </div>
        <div className="draft-readiness-summary" aria-label={`发布准备 ${passedReadinessCount}/${readiness.length}`}>
          {draftQuality.dimensions.map((dimension) => (
            <span
              key={dimension.id}
              className={`quality-${dimension.state}`}
              title={dimension.issues.map((issue) => issue.message).join("；") || `${dimension.label}检查已通过`}
            >
              {dimension.label} {dimension.summary}
            </span>
          ))}
        </div>
        <button
          type="button"
          className="secondary-button"
          disabled={nextAction.tab === "agent" && Boolean(agentBusy)}
          onClick={() => {
            setUtilityTab(nextAction.tab);
            if (nextAction.tab === "agent" && draftQuality.actionKind === "quality-repair") {
              void runAgent("optimization", true);
            }
          }}
        >
          {nextAction.tab === "agent" && agentBusy === "optimization"
            ? <><LoaderCircle className="spin" size={14} />正在定向补写</>
            : <>{nextAction.action}<ChevronRight size={14} /></>}
        </button>
      </section>

      {editing.sourceMaterial ? (
        <div className="source-material-banner" role="note">
          <ShieldAlert size={17} />
          <span>
            <strong>{editing.sourceMaterial.mode === "source"
              ? editing.sourceMaterial.kind === "article" ? "来源原文工作副本" : "社区原文工作副本"
              : editing.sourceMaterial.mode === "translation" ? "社区忠实翻译工作副本" : "社区整理工作副本"}</strong>
            <small>文字和图片已保留来源，但转载、翻译和图片权利仍是“发布前需确认”；这里只用于你的私有编辑。</small>
          </span>
          <a href={editing.sourceMaterial.sourceUrl} target="_blank" rel="noreferrer">核对来源 <ExternalLink size={12} /></a>
        </div>
      ) : null}

      <div className={`draft-stage ${draftLibraryOpen ? "library-open" : ""} ${utilityTab ? "utility-open" : ""}`}>
        {draftLibraryOpen ? (
          <aside className="draft-library-drawer" aria-label="草稿库">
            <div className="drawer-title-row">
              <div><strong>草稿库</strong><span>{currentDrafts.length} 篇当前草稿</span></div>
              <button aria-label="关闭草稿库" onClick={() => setDraftLibraryOpen(false)}><X size={16} /></button>
            </div>
            <label className="draft-search-field">
              <Search size={15} />
              <input value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder="搜索标题或来源" />
            </label>
            <div className="draft-list">
              {filteredDrafts.map((draft) => (
                <button
                  key={draft.id}
                  className={draft.id === editing.id ? "draft-list-item active" : "draft-list-item"}
                  disabled={Boolean(switchingDraftId)}
                  onClick={() => void selectDraft(draft.id)}
                >
                  <span className="draft-source">{draft.sources[0]?.label ?? "AI 新闻"}</span>
                  <strong>{draft.title}</strong>
                  <span className={`draft-status ${draft.status}`}>
                    {draftStatusLabel[draft.status]}
                  </span>
                </button>
              ))}
              {!filteredDrafts.length ? <p className="drawer-empty">没有匹配的草稿</p> : null}
            </div>
            {shelvedDraftCount ? (
              <button className="draft-history-toggle" onClick={() => setShowShelvedDrafts((value) => !value)}>
                <Archive size={14} />{showShelvedDrafts ? "隐藏历史旧稿" : `查看历史旧稿 ${shelvedDraftCount}`}
              </button>
            ) : null}
          </aside>
        ) : null}

        <main className="draft-document-area">
          {viewMode === "split" ? (
            <Group className="draft-split-group" orientation={compactLayout ? "vertical" : "horizontal"}>
              <Panel id="draft-editor" defaultSize="55%" minSize="34%">{editorPane}</Panel>
              <Separator className="draft-split-separator" aria-label="拖动调整编辑和预览宽度"><span /></Separator>
              <Panel id="draft-preview" defaultSize="45%" minSize="30%">{previewPane}</Panel>
            </Group>
          ) : viewMode === "edit" ? editorPane : previewPane}
        </main>

        <nav className="draft-utility-rail" aria-label="草稿辅助工具">
          {utilityTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                className={utilityTab === tab.id ? "active" : ""}
                aria-label={tab.label}
                aria-pressed={utilityTab === tab.id}
                title={tab.label}
                onClick={() => setUtilityTab((current) => current === tab.id ? null : tab.id)}
              >
                <Icon size={19} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {utilityTab ? (
          <aside id="draft-utility-panel" className="draft-utility-drawer" role="tabpanel" aria-label={`${utilityTabs.find((tab) => tab.id === utilityTab)?.label}面板`}>
            <div className="drawer-title-row utility-drawer-title">
              <div><strong>{utilityHeading.title}</strong><span>{utilityHeading.subtitle}</span></div>
              <button aria-label="关闭右侧面板" onClick={() => setUtilityTab(null)}><X size={16} /></button>
            </div>

            <div ref={utilityTabListRef} className="utility-tab-list" role="tablist" aria-label="辅助工具分类" onKeyDown={handleUtilityTabKeyDown}>
              {utilityTabs.map((tab) => (
                <button key={tab.id} role="tab" tabIndex={utilityTab === tab.id ? 0 : -1} aria-selected={utilityTab === tab.id} aria-controls="draft-utility-panel" className={utilityTab === tab.id ? "active" : ""} onClick={() => setUtilityTab(tab.id)}>{tab.label}</button>
              ))}
            </div>

            <div className="utility-drawer-scroll">
              {utilityTab === "agent" ? (
                <div className="article-agent-panel">
                  <section className="external-writer-bridge">
                    <div><span className="external-writer-badge">不调用 API</span><strong>用 Gemini 网页版协作写稿</strong></div>
                    <p>把当前草稿、来源链接、事实边界和待核对项复制成一份约束提示词；在你已有的 Google 账号里运行，再把结果贴回编辑器。</p>
                    <div>
                      <button type="button" className="secondary-button" onClick={() => void copyExternalWritingPrompt()}><Copy size={14} />{externalPromptCopied ? "提示词已复制" : "复制证据写作提示词"}</button>
                      <a href="https://gemini.google.com/app" target="_blank" rel="noreferrer"><ExternalLink size={14} />打开 Gemini</a>
                    </div>
                    <small>网页结果不会自动覆盖草稿。粘贴回来后仍需保存，并在“资料”中核对标为待确认的事实。</small>
                  </section>
                  <div className="agent-mode-switch" role="tablist" aria-label="文章 Agent 类型">
                    <button role="tab" aria-selected={agentMode === "analysis"} className={agentMode === "analysis" ? "active" : ""} onClick={() => setAgentMode("analysis")}><BrainCircuit size={14} />理解文章</button>
                    <button role="tab" aria-selected={agentMode === "optimization"} className={agentMode === "optimization" ? "active" : ""} onClick={() => setAgentMode("optimization")}><WandSparkles size={14} />优化文稿</button>
                  </div>

                  <div className="agent-context-strip">
                    <span><CheckCircle2 size={13} />原文</span>
                    <span><CheckCircle2 size={13} />当前草稿</span>
                    <small>{selectedAgentProvider ? `${selectedAgentProvider.name} · ${selectedAgentProvider.model}` : "尚未配置 Agent"}</small>
                  </div>

                  {agentLoading ? (
                    <div className="agent-loading"><LoaderCircle className="spin" size={20} /><span>正在读取历史分析…</span></div>
                  ) : !activeAgentThread ? (
                    <div className="agent-empty">
                      <span className="agent-empty-icon">{agentMode === "analysis" ? <BrainCircuit size={25} /> : <WandSparkles size={25} />}</span>
                      <strong>{agentMode === "analysis" ? "先弄懂，再决定怎么写" : "先找问题，再生成可审阅的改稿"}</strong>
                      <p>{agentMode === "analysis" ? "Agent 会同时读取原文证据和你正在编辑的草稿，讲清事件、术语、遗漏和可能误读。" : "Agent 会核对事实边界，指出表达问题并给出一版优化稿；不会自动覆盖当前正文。"}</p>
                      <button className="primary-button full" disabled={Boolean(agentBusy) || !selectedAgentProvider} onClick={() => void runAgent(agentMode)}>
                        {agentBusy === agentMode ? <LoaderCircle className="spin" size={16} /> : agentMode === "analysis" ? <Sparkles size={16} /> : <WandSparkles size={16} />}
                        {agentMode === "analysis" ? "理解本篇文章" : "检查并优化文稿"}
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="agent-thread-meta">
                        <span>{activeAgentThread.providerName}</span>
                        <span>{activeAgentThread.sourceSnapshot.method === "full-page" ? "已读取完整原文" : activeAgentThread.sourceSnapshot.method === "intake-text" ? "使用导入正文" : "仅有采集摘要"}</span>
                        <button onClick={() => void runAgent(agentMode)} disabled={Boolean(agentBusy)}>{agentBusy === agentMode ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}重新运行</button>
                      </div>

                      {agentMode === "analysis" && activeAgentThread.analysis ? (
                        <div className="agent-result">
                          <section className="agent-summary-block"><span>一句话讲清</span><strong>{activeAgentThread.analysis.summary}</strong></section>
                          <section><h3>这篇文章讲了什么</h3><ul>{activeAgentThread.analysis.keyPoints.map((point) => <li key={point}>{point}</li>)}</ul></section>
                          <section><h3>为什么值得关注</h3><p>{activeAgentThread.analysis.whyItMatters}</p></section>
                          <section className="agent-comparison">
                            <h3>原文与草稿对照</h3>
                            {activeAgentThread.analysis.comparison.accurate.length ? <div className="good"><strong>写对了</strong>{activeAgentThread.analysis.comparison.accurate.map((item) => <span key={item}>{item}</span>)}</div> : null}
                            {activeAgentThread.analysis.comparison.missing.length ? <div className="missing"><strong>漏掉了</strong>{activeAgentThread.analysis.comparison.missing.map((item) => <span key={item}>{item}</span>)}</div> : null}
                            {activeAgentThread.analysis.comparison.potentiallyMisleading.length ? <div className="risk"><strong>可能误读</strong>{activeAgentThread.analysis.comparison.potentiallyMisleading.map((item) => <span key={item}>{item}</span>)}</div> : null}
                          </section>
                          {activeAgentThread.analysis.terms.length ? <section><h3>术语解释</h3><dl>{activeAgentThread.analysis.terms.map((item) => <div key={item.term}><dt>{item.term}</dt><dd>{item.explanation}</dd></div>)}</dl></section> : null}
                          {activeAgentThread.analysis.uncertainties.length ? <section className="agent-warnings"><h3>仍不确定</h3><ul>{activeAgentThread.analysis.uncertainties.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                        </div>
                      ) : null}

                      {agentMode === "optimization" && activeOptimization ? (
                        <div className="agent-result agent-optimization-result">
                          <section className="agent-quality-route">
                            <div><span>建议稿型</span><strong>{strategyLabels[activeOptimization.strategy] || "待判断"}</strong></div>
                            <div><span>改写力度</span><strong>{editModeLabels[activeOptimization.editMode] || "旧版建议"}</strong></div>
                            <small>先判断该不该改，再决定改多少；未列出的文本块保持原样。</small>
                          </section>
                          {activeOptimization.diagnosis.length ? <section><h3>发现的问题</h3><ul>{activeOptimization.diagnosis.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                          {activeOptimization.improvements.length ? <section><h3>准备怎么改</h3><ul>{activeOptimization.improvements.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                          {(activeOptimization.diagnostics ?? []).length ? (
                            <section className="agent-diagnostic-list">
                              <h3>三层诊断</h3>
                              {(activeOptimization.diagnostics ?? []).map((diagnostic, index) => (
                                <div key={`${diagnostic.id}-${diagnostic.blockId || index}`} className={diagnostic.severity}>
                                  <span>{diagnostic.layer === "content" ? "内容" : diagnostic.layer === "structure" ? "结构" : "措辞"}</span>
                                  <p>{diagnostic.message}</p>
                                  {diagnostic.blockId ? <small>{diagnostic.blockId}</small> : null}
                                </div>
                              ))}
                            </section>
                          ) : null}
                          {activeOptimization.editMode === "keep" ? (
                            <section className="agent-keep-result"><CheckCircle2 size={18} /><div><h3>这版可以保留</h3><p>没有为了“去 AI 味”而强行改写。你可以直接继续编辑或进入发布检查。</p></div></section>
                          ) : null}
                          {(activeOptimization.changes ?? []).length ? (
                            <section className="agent-change-list">
                              <h3>逐项审阅修改</h3>
                              {(activeOptimization.changes ?? []).map((change, index) => {
                                const decision = optimizationDecisions[change.id];
                                return (
                                  <article className={`agent-change-card ${decision || "pending"} ${change.factCheckPassed ? "safe" : "unsafe"}`} key={change.id}>
                                    <header><span>修改 {index + 1} · {change.blockId}</span><b>{change.factCheckPassed ? "事实锚点通过" : "需要核对事实"}</b></header>
                                    <p className="change-reason">{change.reason}</p>
                                    <div className="change-before"><small>原文</small><p>{change.before}</p></div>
                                    <div className="change-after"><small>建议</small><p>{change.after || "（删除此段）"}</p></div>
                                    {change.factWarnings.length ? <ul>{change.factWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
                                    <footer>
                                      <button className="secondary-button" disabled={decision === "applied" || Boolean(agentBusy)} onClick={() => ignoreOptimizationChange(change.id)}><X size={13} />{decision === "ignored" ? "恢复建议" : decision === "applied" ? "已应用" : "忽略"}</button>
                                      <button className="primary-button" disabled={Boolean(decision) || Boolean(agentBusy)} onClick={() => void applyOptimization([change])}><Check size={13} />{decision === "applied" ? "已应用" : "应用此项"}</button>
                                    </footer>
                                  </article>
                                );
                              })}
                            </section>
                          ) : null}
                          {!(activeOptimization.changes ?? []).length && activeOptimization.optimizedTitle ? (
                            <section className="agent-proposal legacy-agent-proposal">
                              <span>旧版整稿建议（只读）</span>
                              <h3>{activeOptimization.optimizedTitle}</h3>
                              {(activeOptimization.optimizedParagraphs ?? []).map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
                              {activeOptimization.optimizedTake ? <p>{activeOptimization.optimizedTake}</p> : null}
                              <small>这是升级前保存的结果。重新运行优化后，才能逐项安全应用。</small>
                            </section>
                          ) : null}
                          {activeOptimization.factWarnings.length ? <section className="agent-warnings"><h3>应用前确认</h3><ul>{activeOptimization.factWarnings.map((item) => <li key={item}>{item}</li>)}</ul></section> : null}
                          <div className="agent-proposal-actions">
                            <button className="secondary-button" onClick={() => void copyOptimization()}><Copy size={14} />{agentCopied ? "已复制" : "复制修改建议"}</button>
                            {(activeOptimization.changes ?? []).length ? <button className="primary-button" disabled={Boolean(agentBusy) || !safePendingOptimizationChanges.length} onClick={() => void applyOptimization(safePendingOptimizationChanges, true)}>{agentBusy === "optimization" ? <LoaderCircle className="spin" size={14} /> : <Check size={14} />}应用全部安全项</button> : null}
                          </div>
                          <p className="agent-apply-note">应用前会保存当前版本。系统只替换你接受的原文块；其他标题、段落、列表、图片与图注不会重建。</p>
                        </div>
                      ) : null}

                      <section className="agent-chat-section">
                        <div className="inspector-heading"><h3><MessageSquareText size={14} />继续追问</h3><span>{activeAgentThread.messages.length} 条</span></div>
                        <div className="agent-messages">
                          {activeAgentThread.messages.map((message) => (
                            <article className={`agent-message ${message.role}`} key={message.id}>
                              <span>{message.role === "user" ? "你" : "Agent"}</span>
                              <p>{message.content}</p>
                              {message.grounding ? <small>依据：{message.grounding}</small> : null}
                            </article>
                          ))}
                          {agentBusy === "chat" ? <article className="agent-message assistant thinking"><LoaderCircle className="spin" size={14} /><p>正在结合原文和当前草稿回答…</p></article> : null}
                        </div>
                        {activeAgentThread.messages.at(-1)?.suggestions?.length ? (
                          <div className="agent-suggestions">{activeAgentThread.messages.at(-1)?.suggestions?.map((suggestion) => <button key={suggestion} disabled={Boolean(agentBusy)} onClick={() => void askAgent(suggestion)}>{suggestion}</button>)}</div>
                        ) : null}
                        <div className="agent-question-box">
                          <textarea value={agentQuestion} onChange={(event) => setAgentQuestion(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void askAgent(); } }} placeholder="哪里没看懂？也可以问：这个结论来自原文哪一段？" />
                          <button aria-label="发送追问" title="发送（⌘/Ctrl+Enter）" disabled={!agentQuestion.trim() || Boolean(agentBusy)} onClick={() => void askAgent()}>{agentBusy === "chat" ? <LoaderCircle className="spin" size={15} /> : <SendHorizontal size={15} />}</button>
                        </div>
                      </section>
                    </>
                  )}
                  {agentError ? <div className="agent-error"><Info size={15} /><span>{agentError}</span></div> : null}
                </div>
              ) : null}

              {utilityTab === "sources" ? (
                <DraftEvidencePanel
                  draft={editing}
                  onUpdateFactClaim={updateFactClaim}
                  onResolveFactUncertainty={(item) => updateEditing({
                    uncertainties: editing.uncertainties.filter((entry) => entry !== item),
                  })}
                />
              ) : null}

              {utilityTab === "images" ? (
                <>
                  <section className="utility-section image-import-section">
                    <div className="inspector-heading"><h3>添加图片</h3><span>{insertedMediaIds.size}/{editing.images.length} 已用</span></div>
                    <button className="utility-upload-button" onClick={() => drawerFileInput.current?.click()} disabled={imageBusy}><ImagePlus size={16} />上传本地图片</button>
                    <input
                      ref={drawerFileInput}
                      hidden
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        if (!file) return;
                        setImageBusy(true);
                        setImageError("");
                        try { await uploadImage(file); }
                        catch (error) { setImageError(error instanceof Error ? error.message : String(error)); }
                        finally { setImageBusy(false); event.target.value = ""; }
                      }}
                    />
                    <div className="image-url-fields drawer-image-url-fields">
                      <input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="图片 URL" />
                      <input value={imageCaption} onChange={(event) => setImageCaption(event.target.value)} placeholder="图片说明（可选）" />
                      <button onClick={() => void importDrawerImage()} disabled={!imageUrl.trim() || imageBusy}>{imageBusy ? "正在处理…" : "下载到配图库"}</button>
                    </div>
                    {imageError ? <p className="image-upload-error">{imageError}</p> : null}
                  </section>
                  <section className="utility-section draft-material-library">
                    <div className="inspector-heading"><h3>通用素材库</h3><span>{materials.length} 张</span></div>
                    <label className="draft-material-search"><Search size={13} /><input value={materialSearch} onChange={(event) => setMaterialSearch(event.target.value)} placeholder="搜人物、公司或标签" /></label>
                    <p className="image-library-hint">先把光标放到正文，再点素材；系统会复制一份到当前草稿。</p>
                    <div className="inspector-image-grid material-inspector-grid">
                      {materials.filter((material) => {
                        const query = materialSearch.trim().toLowerCase();
                        return !query || `${material.title} ${material.attribution} ${material.tags.join(" ")} ${material.entityTags.join(" ")}`.toLowerCase().includes(query);
                      }).map((material) => (
                        <button key={material.id} className="inspector-image material-inspector-item" disabled={Boolean(materialBusyId)} title={`插入到当前光标 · ${material.attribution}`} onClick={() => void addMaterial(material)}>
                          <img src={material.publicPath} alt={material.title} />
                          <span>{material.title}</span>
                          <small>{materialBusyId === material.id ? "正在复制…" : material.rights === "check-required" ? "插入 · 权限待确认" : "一键插入"}</small>
                        </button>
                      ))}
                      {!materials.length ? <p className="empty-inspector">素材库还是空的。请先到“AI 设置 → 图片素材库”加入常用图片。</p> : null}
                    </div>
                  </section>
                  <section className="utility-section">
                    <div className="inspector-heading"><h3>本稿配图库</h3><span>{editing.images.length} 张</span></div>
                    <p className="image-library-hint">先把光标放到正文，再点图片插入；同一张图可重复使用。</p>
                    <div className="inspector-image-grid">
                      {editing.images.length ? editing.images.map((placement) => (
                        <article key={placement.id} className={`inspector-image governed-image ${insertedMediaIds.has(placement.id) ? "used" : ""}`}>
                          <button className="governed-image-insert" title="插入到当前光标" onClick={() => insertImage(placement)}>
                            {placement.image.publicPath ? <img src={placement.image.publicPath} alt="" /> : <ImagePlus size={22} />}
                            <span>{placement.caption}</span>
                            <small>{insertedMediaIds.has(placement.id) ? "已在正文 · 再次插入" : "插入到光标"}</small>
                          </button>
                          <div className="image-governance-fields">
                            <label><span>版权状态</span><select value={placement.image.rights} onChange={(event) => updateImageGovernance(placement.id, { rights: event.target.value as typeof placement.image.rights })}><option value="check-required">待确认</option><option value="owned">自有／明确授权</option><option value="licensed">许可使用</option><option value="official">官方来源</option><option value="editorial-screenshot">评论性截图</option><option value="expired">授权已到期</option></select></label>
                            <label><span>来源署名</span><input value={placement.image.attribution} onChange={(event) => updateImageGovernance(placement.id, { attribution: event.target.value })} /></label>
                            <label><span>来源页面</span><input value={placement.image.sourceUrl} onChange={(event) => updateImageGovernance(placement.id, { sourceUrl: event.target.value })} /></label>
                            <label className="inline-check"><input type="checkbox" checked={(placement.image.allowedPlatforms ?? []).includes("xiaoheihe") || (placement.image.allowedPlatforms ?? []).includes("*")} onChange={(event) => updateImagePlatform(placement.id, "xiaoheihe", event.target.checked)} /><span>已确认可用于小黑盒</span></label>
                            <label className="inline-check"><input type="checkbox" checked={(placement.image.allowedPlatforms ?? []).includes("wechat") || (placement.image.allowedPlatforms ?? []).includes("*")} onChange={(event) => updateImagePlatform(placement.id, "wechat", event.target.checked)} /><span>已确认可用于微信公众号</span></label>
                            {placement.image.rights === "licensed" || placement.image.rights === "editorial-screenshot" ? <label><span>授权／使用依据</span><input value={placement.image.evidenceNote ?? ""} onChange={(event) => updateImageGovernance(placement.id, { evidenceNote: event.target.value })} placeholder="例如：官方媒体包许可；用于事件评论" /></label> : null}
                          </div>
                        </article>
                      )) : <p className="empty-inspector">暂时没有来源图。可上传、粘贴截图，或填写图片 URL。</p>}
                    </div>
                  </section>
                </>
              ) : null}

              {utilityTab === "history" ? (
                <>
                  <section className="utility-section history-current-card">
                    <span className="history-current-mark"><Cloud size={15} />当前内容</span>
                    <strong>{editing.title || "未命名草稿"}</strong>
                    <small>{dirty ? "有更改等待自动保存" : `最近保存于 ${formatSaved(lastSavedAt || editing.updatedAt)}`}</small>
                    <button onClick={() => void save("manual").catch(() => undefined)} disabled={saving}>
                      <Save size={14} />立即创建版本
                    </button>
                  </section>
                  <section className="utility-section history-list-section">
                    <div className="inspector-heading">
                      <h3>历史快照</h3>
                      <span>最多保留 30 个</span>
                    </div>
                    {revisionsLoading ? (
                      <div className="history-loading"><LoaderCircle className="spin" size={17} />正在读取版本…</div>
                    ) : revisions.length ? (
                      <div className="draft-revision-list">
                        {revisions.map((revision) => {
                          const characterCount = `${revision.snapshot.title}${textFromHtml(revision.snapshot.bodyHtml || "")}`.replace(/\s/g, "").length;
                          const confirming = restoreConfirmId === revision.id;
                          const restoring = restoringRevisionId === revision.id;
                          return (
                            <article className={`draft-revision-item ${revision.kind}`} key={revision.id}>
                              <div className="revision-meta-row">
                                <span>{revision.label}</span>
                                <time dateTime={revision.updatedAt}>{formatSaved(revision.updatedAt)}</time>
                              </div>
                              <strong>{revision.snapshot.title || "未命名草稿"}</strong>
                              <small>约 {characterCount} 字 · {revision.snapshot.images.length} 张配图</small>
                              {confirming ? (
                                <div className="revision-confirm-actions">
                                  <button className="confirm" onClick={() => void restoreRevision(revision.id)} disabled={Boolean(restoringRevisionId)}>
                                    {restoring ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}确认恢复
                                  </button>
                                  <button onClick={() => setRestoreConfirmId(undefined)} disabled={Boolean(restoringRevisionId)}>取消</button>
                                </div>
                              ) : (
                                <button className="revision-restore-button" onClick={() => setRestoreConfirmId(revision.id)} disabled={Boolean(restoringRevisionId)}>
                                  <RotateCcw size={13} />恢复此版本
                                </button>
                              )}
                            </article>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="history-empty">
                        <History size={23} />
                        <strong>还没有历史版本</strong>
                        <span>继续编辑会自动生成快照，也可以点击上方按钮立即创建。</span>
                      </div>
                    )}
                  </section>
                </>
              ) : null}

              {utilityTab === "publish" ? (
                <>
                  <section className="utility-section">
                    <div className="distribution-heading">
                      <span>一稿多投</span>
                      <h3 className="utility-section-title">多平台分发台</h3>
                      <p>正文只编辑一份；各平台分别做格式、图片和权限检查，再送到草稿箱或编辑器。</p>
                    </div>
                    <div className="distribution-flow" aria-label="多平台分发边界">
                      <span>当前正文</span><i>→</i><span>平台适配</span><i>→</i><span>草稿／编辑器</span><i>→</i><strong>你手动发布</strong>
                    </div>
                    <div className="platform-options">
                      {distributionTargets.map((target) => (
                        <button
                          key={target.id}
                          className={publishPlatform === target.id ? `active status-${target.status}` : `status-${target.status}`}
                          aria-pressed={publishPlatform === target.id}
                          onClick={() => setPublishPlatform(target.id)}
                        >
                          <span>{target.label}</span>
                          <small>{target.operation} · 最终发布由你确认</small>
                          <em>{target.statusLabel}</em>
                          {publishPlatform === target.id ? <CheckCircle2 size={17} /> : null}
                        </button>
                      ))}
                    </div>
                    <div className="distribution-roadmap"><span>下一批适配</span><b>知乎文章</b><b>小红书图文</b><b>X 短帖／线程</b><small>尚未接入，不冒充可用</small></div>
                    {publishPlatform === "xiaoheihe" ? (
                      <div className={publisherReady ? "publisher-connection ready" : "publisher-connection"}>
                        <span><i />{extensionPublisher ? "常用 Chrome 填入助手" : "CDP 备用浏览器"}</span>
                        <small>{publisherStatus?.detail ?? "正在检查连接状态"}</small>
                      </div>
                    ) : null}
                  </section>
                  {publishPlatform === "xiaoheihe" ? (
                    <>
                  <section className="utility-section publishing-prep">
                    <h3>分区与话题</h3>
                    <label>
                      <span>关联社区</span>
                      <select value={editing.community} onChange={(event) => updateEditing({ community: event.target.value })}>
                        {customCommunityOption ? <option value={customCommunityOption}>{customCommunityOption}</option> : null}
                        {recentCommunityOptions.length ? (
                          <optgroup label="最近使用">
                            {recentCommunityOptions.map((community) => <option key={`recent-${community}`} value={community}>{community}</option>)}
                          </optgroup>
                        ) : null}
                        <optgroup label="热门板块">
                          {popularCommunityOptions.map((community) => <option key={community} value={community}>{community}</option>)}
                        </optgroup>
                      </select>
                    </label>
                    <div className="topic-editor">
                      <span>本篇已选</span>
                      <div className="topic-list">
                        {editing.topics.map((topic) => (
                          <button key={topic} onClick={() => updateEditing({ topics: editing.topics.filter((item) => item !== topic) })}>{topic}<X size={13} /></button>
                        ))}
                        {!editing.topics.length ? <small className="topic-empty">尚未选择标签</small> : null}
                      </div>
                      <div className="topic-input-row">
                        <input value={topicInput} onChange={(event) => setTopicInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addTopic(); } }} placeholder="输入新标签" />
                        <button aria-label="添加话题" onClick={addTopic}><Plus size={15} /></button>
                      </div>
                    </div>
                    <div className="topic-history">
                      <div className="topic-history-heading">
                        <span><History size={13} />历史标签</span>
                        <small>发布成功后保留 · 最近 20 个</small>
                      </div>
                      {recentTopics.length ? (
                        <div className="topic-history-list">
                          {recentTopics.map((topic) => {
                            const selectedTopic = includesPublishingValue(editing.topics, topic);
                            return (
                              <button
                                key={topic}
                                className={selectedTopic ? "selected" : ""}
                                disabled={selectedTopic || editing.topics.length >= 5}
                                onClick={() => updateEditing({ topics: [...editing.topics, topic].slice(0, 5) })}
                              >
                                {selectedTopic ? <Check size={12} /> : <Plus size={12} />}{topic}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="topic-history-empty">暂无历史标签。这里不会自动生成，只有你确认发布成功的标签才会出现。</p>
                      )}
                    </div>
                  </section>
                  <section className="utility-section">
                    <div className="inspector-heading">
                      <h3>发布前检查</h3>
                      <button
                        className="preflight-refresh"
                        disabled={preflightBusy}
                        onClick={() => void checkPublisher(true)}
                      >{preflightBusy ? <LoaderCircle className="spin" size={13} /> : <RotateCcw size={13} />}重新检查</button>
                    </div>
                    <div className="publish-checklist">
                      {readiness.map((item) => <span key={item.label} className={item.ok ? "ok" : "warning"}>{item.ok ? <CheckCircle2 size={15} /> : <Info size={15} />}{item.label}</span>)}
                    </div>
                    {preflight ? (
                      <div className={`publisher-preflight-card ${preflight.canQueueFill ? "ready" : "blocked"}`}>
                        <strong>{preflight.summary}</strong>
                        <div className="publisher-capability-list">
                          {preflight.capabilities.map((capability) => (
                            <span key={capability.id} className={capability.status}>
                              {capability.status === "pass" ? <CheckCircle2 size={14} /> : <Info size={14} />}
                              <span><b>{capability.label}</b><small>{capability.detail}</small></span>
                            </span>
                          ))}
                        </div>
                        <small className="manual-publish-note">{preflight.finalPublish.detail}</small>
                      </div>
                    ) : (
                      <button className="secondary-button full" disabled={preflightBusy} onClick={() => void checkPublisher(true)}>
                        {preflightBusy ? <LoaderCircle className="spin" size={15} /> : <CheckCircle2 size={15} />}检查小黑盒兼容性
                      </button>
                    )}
                    {preflightError ? <p className="preflight-error">{preflightError}</p> : null}
                  </section>
                  {fillResult ? (
                    <section className={fillResult.ok ? "fill-result success" : "fill-result warning"}>
                      <strong>{fillResult.receipt?.outcome === "filled" ? "已填入并逐项核验" : fillResult.ok ? "已填入编辑器" : "部分步骤需要处理"}</strong>
                      {fillResult.steps.map((step) => <span key={step.name}>{step.ok ? "✓" : "!"} {step.name}：{step.detail}</span>)}
                      {fillResult.receipt ? <small>交付回执 {fillResult.receipt.attemptId.slice(0, 16)} · {fillResult.receipt.summary}</small> : null}
                      {publishMetadataReady ? (
                        <div className="publication-memory-confirm">
                          <p>在小黑盒完成最终发布后，再确认保存这次分区与标签。</p>
                          <button
                            disabled={rememberedPublication || confirmingPublication}
                            onClick={() => void confirmPublication("xiaoheihe")}
                          >
                            {rememberedPublication
                              ? <><Check size={13} />已保存到历史</>
                              : confirmingPublication
                                ? <><LoaderCircle className="spin" size={13} />正在保存…</>
                                : <><History size={13} />我已发布，保存标签</>}
                          </button>
                        </div>
                      ) : fillResult.ok ? (
                        <p className="publication-memory-blocked">分区或标签未成功填入，本次不会进入历史记录。</p>
                      ) : null}
                    </section>
                  ) : null}
                  {xiaoheihePublication ? (
                    <section className="utility-section published-material-section">
                      <div className="inspector-heading">
                        <h3><Archive size={14} />发布配图沉淀</h3>
                        <span>逐图人工保存</span>
                      </div>
                      <p className="published-material-intro">
                        只保存本次回执确认使用、版权预检通过且本地文件有效的图片；不会自动改变版权状态。
                      </p>
                      {publishedImageStatusLoading ? (
                        <div className="published-material-loading"><LoaderCircle className="spin" size={15} />正在复核发布回执与图片指纹…</div>
                      ) : publishedImageStatuses.length ? (
                        <div className="published-material-list">
                          {publishedImageStatuses.map((status) => {
                            const savingImage = publishedImageSavingId === status.placementId;
                            const statusLabel = status.status === "ready"
                              ? "可以保存"
                              : status.status === "duplicate"
                                ? "素材库已有"
                                : status.status === "saved"
                                  ? "已保存"
                                  : "不可保存";
                            return (
                              <article className={`published-material-card ${status.status}`} key={status.placementId}>
                                <div className="published-material-thumb">
                                  {status.thumbnailUrl ? <img src={status.thumbnailUrl} alt={status.title || "发布配图"} /> : <ImagePlus size={20} />}
                                </div>
                                <div className="published-material-copy">
                                  <div><strong>{status.title || "未命名配图"}</strong><span>{statusLabel}</span></div>
                                  {status.status === "duplicate" ? <p>相同 SHA-256 指纹的图片已在素材库，不会重复保存。</p> : null}
                                  {status.blockers.map((blocker) => <p className="blocker" key={blocker}>{blocker}</p>)}
                                  {status.warnings.map((warning) => <p className="warning" key={warning}>{warning}</p>)}
                                  {status.canSave && !status.warnings.length ? <p className="ready-note">发布证据、授权范围和文件指纹均已通过。</p> : null}
                                </div>
                                <button
                                  disabled={!status.canSave || Boolean(publishedImageSavingId)}
                                  onClick={() => void savePublishedImage(status.placementId)}
                                >
                                  {savingImage
                                    ? <><LoaderCircle className="spin" size={13} />正在保存…</>
                                    : status.status === "saved"
                                      ? <><Check size={13} />已保存</>
                                    : status.status === "duplicate"
                                        ? <><Check size={13} />已在素材库</>
                                        : status.status === "blocked"
                                          ? <><Info size={13} />不可存入</>
                                          : <><Archive size={13} />存入素材库</>}
                                </button>
                              </article>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="published-material-empty">本稿没有可复核的配图。</p>
                      )}
                      {publishedImageError ? <p className="published-material-error">{publishedImageError}</p> : null}
                    </section>
                  ) : null}
                    </>
                  ) : (
                    <WeChatDraftPanel
                      draft={editing}
                      settings={wechatSettings}
                      dirty={dirty}
                      saving={saving}
                      busy={busy}
                      copiedFormatted={copiedRich}
                      onSaveDraft={() => save("manual")}
                      onSync={syncWeChat}
                      onCopyFormatted={copyFormatted}
                      onConfirmPublished={() => confirmPublication("wechat")}
                      onOpenSettings={onOpenPublisherSettings}
                    />
                  )}
                </>
              ) : null}
            </div>

            {utilityTab === "publish" && publishPlatform === "xiaoheihe" ? (
              <div className="utility-publish-actions">
                <div className="publish-secondary-actions">
                  <button onClick={() => void save("manual").catch(() => undefined)} disabled={saving}><Save size={15} />保存</button>
                  <button onClick={() => void copyFormatted()}><Palette size={15} />{copiedRich ? "已复制" : "复制排版"}</button>
                  <button onClick={() => void copy()}><FileText size={15} />{copied ? "已复制" : "纯文本"}</button>
                </div>
                {!publisherReady || loginRequired ? (
                  <button
                    className="outline-accent-button full"
                    onClick={extensionPublisher && !loginRequired ? onOpenPublisherSettings : onLaunchPublisher}
                  >
                    {loginRequired
                      ? "打开小黑盒登录页"
                      : extensionPublisher
                        ? "设置常用 Chrome 填入助手"
                        : "启动 CDP 备用浏览器"}
                  </button>
                ) : null}
                <button
                  className="primary-button full"
                  aria-describedby={`${editing.id}-publish-guidance`}
                  onClick={() => void fill()}
                  disabled={busy || preflightBusy || !publisherReady || preflight?.canQueueFill === false}
                >
                  {busy || preflightBusy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                  {loginRequired ? "登录后重新填入" : "填入小黑盒编辑器"}
                </button>
                <p
                  className={!publisherReady || loginRequired ? "publish-guidance blocked" : evidenceView.factUncertainties.length || uncheckedImageCount ? "publish-guidance warning" : "publish-guidance"}
                  id={`${editing.id}-publish-guidance`}
                >
                  {publishGuidance}
                </p>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </div>
  );
}
