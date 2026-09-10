import { waitForProductJob, deferredJobMessage } from "../product-job-wait";
import { StoryReader, readingScope, absoluteTime } from "./StoryReader";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  Eye,
  FileStack,
  Image as ImageIcon,
  RefreshCw,
  Search,
} from "lucide-react";
import { api, type DraftOverview, type ProductJob, type StoryDetailResult } from "../api";
import { PageLoading } from "./PageLoading";
import { TodayWorkspaceRail } from "./TodayWorkspaceRail";
import { TopicCategoryPanel, TopicCategoryTabs } from "./TopicCategoryPanel";
import { HomeLayoutDialog } from "./HomeLayoutDialog";
import { defaultHomeLayout, type HomeLayout } from "../../server/home-layout.js";
import { KnowledgeShelf } from "./KnowledgeShelf";
import { beginStarterDraft } from "../starter-draft";
import type {
  AppPage,
  AssignmentMode,
  ContentPackage,
  StoryView,
  TodayView,
} from "../types";

const relativeTime = (value: string) => {
  const deltaMinutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (deltaMinutes < 60) return `${deltaMinutes || 1} 分钟前`;
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
};

const terminalJobStatuses = new Set<ProductJob["status"]>(["complete", "failed", "cancelled"]);

const packageIdFromJob = (job: ProductJob) => {
  if (!job.result || typeof job.result !== "object") return undefined;
  const value = (job.result as { packageId?: unknown }).packageId;
  return typeof value === "string" ? value : undefined;
};

const draftIdFromJob = (job: ProductJob) => {
  if (!job.result || typeof job.result !== "object") return undefined;
  const value = (job.result as { draftId?: unknown }).draftId;
  return typeof value === "string" ? value : undefined;
};

const StoryImage = ({ story, eager = false }: { story: StoryView; eager?: boolean }) => {
  const localCount = story.localImageCount
    ?? story.images.filter((candidate) => Boolean(candidate.localPath && candidate.publicPath)).length;
  const image = story.images.find((candidate) => Boolean(candidate.publicPath)) ?? story.images[0];
  const source = image?.publicPath || image?.url;
  const [failedSource, setFailedSource] = useState<string>();
  const failed = Boolean(source && failedSource === source);
  if (!image || failed) {
    return (
      <div className={`today-story-image empty${failed ? " failed" : ""}`} aria-label={failed ? "图片加载失败" : "当前来源没有合格图片"}>
        <ImageIcon size={22} />
        <span>{failed ? "图片暂不可用，详情中可查看来源" : "暂无合格原图"}</span>
      </div>
    );
  }
  return (
    <div className="today-story-image">
      <img
        src={source}
        alt={image.caption || story.title}
        loading={eager ? "eager" : "lazy"}
        onError={() => setFailedSource(source)}
      />
      <span>{localCount ? `本地 ${localCount} / 发现 ${story.imageCount}` : `发现 ${story.imageCount} · 待缓存`}</span>
    </div>
  );
};

interface StoryRowProps {
  story: StoryView;
  rank?: number;
  featured?: boolean;
  busy?: boolean;
  processing?: boolean;
  onOpen: (story: StoryView) => void;
  onQueue: (story: StoryView, selected: boolean) => void;
  onQuickDraft: (story: StoryView) => void;
}

const StoryRow = ({ story, featured = false, busy = false, onOpen, onQueue }: StoryRowProps) => (
  <article className={`today-story ${featured ? "featured" : "compact"}${story.images.length ? "" : " text-only"}`} data-story-id={story.id}>
    <button type="button" className="today-story-open" onClick={() => onOpen(story)} aria-label={`查看 ${story.title}`}>
      {story.images.length ? <StoryImage story={story} eager={featured} /> : null}
      <div className="today-story-copy">
        <div className="today-story-kicker">
          {featured ? <span className="today-source-name">重点选题</span> : null}
          <span>{story.signals.find(signal => !signal.isCommunity)?.sourceName || story.signals[0]?.sourceName || "来源待核对"}</span>
          <time title={story.publicationDateKnown === false ? "发布时间未知" : absoluteTime(story.publishedAt)}>{story.publicationDateKnown === false ? "发布时间未知" : relativeTime(story.publishedAt)}</time>
          <span className="reading-scope">{readingScope(story.explanation.basis)}</span>
        </div>
        <h3>{story.title}</h3>
        <p className="today-story-summary">{story.summary}</p>
        <div className="today-story-meta"><span>材料：{story.sourceCount} 个来源{story.communitySampleCount ? ` · ${story.communitySampleCount} 条已读样本` : ""}</span><span>热度：{story.trend.direction === "unknown" ? "未知" : story.trend.summary}</span></div>
      </div><ChevronRight className="today-story-chevron" size={20} aria-hidden="true" />
    </button>
    <div className="today-story-actions"><span className="story-value">编辑价值：{story.opportunity?.reason || story.assignment.reason}</span>
      <button type="button" className="text-button" onClick={() => onOpen(story)}>阅读并核对</button>
      <button type="button" className="secondary-button" disabled={busy || story.drafted || story.selected} onClick={() => onQueue(story, true)}>{story.drafted ? "已有草稿" : story.selected ? <><Check size={14} />已保留</> : "留作选题"}</button>
    </div>
  </article>
);

const Funnel = ({ data }: { data: TodayView["funnel"] }) => {
  const steps = [
    ["候选", data.candidateCount],
    ["事件", data.storyCount],
    ["待写", data.selectedCount],
    ["草稿", data.draftCount],
    ["已同步", data.syncedCount],
    ["已发布", data.publishedCount],
  ] as const;
  return (
    <section className="today-funnel" aria-label="内容生产漏斗">
      <div className="today-section-heading">
        <div><span>工作记录</span><h2>从选题到发布</h2></div>
        <small>{data.feedbackCount} 次选择反馈 · 素材库 {data.materialLibraryTotal} 张：{data.autoUsableMaterialCount} 张可自动使用，{data.rightsReviewMaterialCount} 张待处理</small>
      </div>
      <ol>
        {steps.map(([label, count], index) => (
          <li key={label}>
            <span>{label}</span>
            <strong>{count}</strong>
            {index < steps.length - 1 ? <ArrowRight size={15} aria-hidden="true" /> : null}
          </li>
        ))}
      </ol>
      <div className={`today-recommendation-health${data.recommendationShortageCount ? " has-shortage" : ""}`}>
        <div>
          <strong>今日推荐 {data.visibleRecommendationCount} / {data.recommendationTarget}</strong>
          <span>{data.recommendationShortageCount
            ? "当前符合条件的题目较少，保留空位；筛选原因见右侧"
            : "当前推荐已达展示上限，成稿与交付仍按各自条件检查"}</span>
        </div>
        {data.recommendationDropReasons.length ? (
          <ul>{data.recommendationDropReasons.map((reason) => <li key={reason.code}><span>{reason.label}</span><strong>{reason.count}</strong></li>)}</ul>
        ) : null}
      </div>
    </section>
  );
};

interface TodayPageProps {
  onNavigate: (page: AppPage) => void;
  onNotice: (kind: "success" | "info" | "error", message: string) => void;
  onOpenDraft?: (draftId: string) => Promise<void> | void;
  onSearch: (query: string) => Promise<void>;
  requestedStoryId?: string;
  onRequestedStoryHandled?: () => void;
}

export function TodayPage({ onNavigate, onNotice, onOpenDraft, onSearch, requestedStoryId, onRequestedStoryHandled }: TodayPageProps) {
  const [category, setCategory] = useState("news");
  const [listQuery, setListQuery] = useState("");
  const [listView, setListView] = useState("all");
  const [listSort, setListSort] = useState("recommended");
  const [listTime, setListTime] = useState("all");
  const [incomingToday, setIncomingToday] = useState<TodayView>();
  const todayRef = useRef<TodayView | undefined>(undefined);
  const [actionError, setActionError] = useState<string>();
  const [openingStory, setOpeningStory] = useState<Pick<StoryView, "id">>();
  const [openError, setOpenError] = useState<string>();
  const originRef = useRef<{ element: HTMLElement | null; x: number; y: number } | undefined>(undefined);
  const [layout, setLayout] = useState<HomeLayout>(defaultHomeLayout);
  const [customizing, setCustomizing] = useState(false);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [keywordNews, setKeywordNews] = useState<StoryView[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordError, setKeywordError] = useState<string>();
  const activeColumn = layout.columns.find((column) => column.id === category) ?? layout.columns[0];
  const applyLayout = (next: HomeLayout) => {
    setLayout(next);
    setCategory((current) => next.columns.some(column => column.id === current) ? current : next.columns[Math.min(Math.max(0, layout.columns.findIndex(column => column.id === current)), next.columns.length - 1)]!.id);
  };
  useEffect(() => {
    let alive = true;
    void api.homeLayout().then((next) => { if (alive) { applyLayout(next); setLayoutLoaded(true); } })
      .catch(() => { if (alive) setLayoutLoaded(false); });
    return () => { alive = false; };
  }, []);
  const customize = async () => {
    if (layoutLoaded) { setCustomizing(true); return; }
    try { applyLayout(await api.homeLayout()); setLayoutLoaded(true); setCustomizing(true); }
    catch { onNotice("error", "栏目设置暂未读取，请稍后重试。"); }
  };
  useEffect(() => {
    if (activeColumn.source !== "news" || !activeColumn.keyword) return;
    let alive = true;
    setKeywordLoading(true); setKeywordNews([]); setKeywordError(undefined);
    void api.homeNews(activeColumn.keyword).then((stories) => { if (alive) setKeywordNews(stories); })
      .catch(() => { if (alive) setKeywordError("当前栏目暂未读取，可切换栏目后重试。"); })
      .finally(() => { if (alive) setKeywordLoading(false); });
    return () => { alive = false; };
  }, [activeColumn.id, activeColumn.keyword, activeColumn.source]);
  const [today, setToday] = useState<TodayView>();
  useEffect(() => { todayRef.current = today; }, [today]);
  const [drafts, setDrafts] = useState<DraftOverview>();
  const [draftError, setDraftError] = useState<string>();
  const [openingDraftId, setOpeningDraftId] = useState<string>();
  const loadRequestRef = useRef(0);
  const [detail, setDetail] = useState<StoryDetailResult>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState<string>();
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [activeStoryJob, setActiveStoryJob] = useState<ProductJob>();
  const explanationRequestRef = useRef(0);
  const activeStoryJobRef = useRef<ProductJob | undefined>(undefined);
  const handledJobIdsRef = useRef(new Set<string>());
  const storyJobIntentsRef = useRef(new Map<string, {
    kind: "package" | "evidence" | "quick-write" | "draft" | "assets";
    storyId: string;
  }>());

  const loadToday = useCallback(async (quiet = false) => {
    const requestId = ++loadRequestRef.current;
    if (!quiet) setLoading(true);
    const [recommendations, overview] = await Promise.allSettled([api.today(), api.draftOverview()]);
    if (requestId !== loadRequestRef.current) return;
    if (recommendations.status === "fulfilled") {
      const next = recommendations.value;
      const current = todayRef.current;
      if (quiet && current) {
        const groups = ["mustReads", "secondary", "interesting", "backlog", "releaseHighlights", "knowledge"] as const;
        const signature = (value: TodayView) => JSON.stringify(groups.map(key => (value[key] ?? []).map(story => [story.id, story.lastSeenAt, story.summary])));
        if (signature(current) !== signature(next)) setIncomingToday(next);
        const updated = new Map([...groups.flatMap(key => next[key] ?? []), ...(next.pending ?? []), ...next.watching].map(story => [story.id, story]));
        const stable = { ...current, pending: next.pending, watching: next.watching, funnel: next.funnel };
        for (const key of groups) stable[key] = (current[key] ?? []).map(story => updated.has(story.id) ? { ...story, selected: updated.get(story.id)!.selected, drafted: updated.get(story.id)!.drafted } : story);
        setToday(stable);
      } else { setToday(next); setIncomingToday(undefined); }
      setError(undefined);
    } else {
      setError(recommendations.reason instanceof Error ? recommendations.reason.message : String(recommendations.reason));
    }
    if (overview.status === "fulfilled") {
      setDrafts(overview.value);
      setDraftError(undefined);
    } else setDraftError("最近草稿读取失败");
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadToday();
    const events = new EventSource("/api/events");
    events.addEventListener("workflow", () => void loadToday(true));
    events.addEventListener("jobs", (event) => {
      try {
        const jobs = JSON.parse((event as MessageEvent<string>).data) as ProductJob[];
        const active = activeStoryJobRef.current;
        const updated = active ? jobs.find((job) => job.id === active.id) : undefined;
        if (updated) setActiveStoryJob(updated);
      } catch {
        // The next SSE snapshot is authoritative; a malformed frame is ignored.
      }
    });
    return () => {
      loadRequestRef.current += 1;
      explanationRequestRef.current += 1;
      events.close();
    };
  }, [loadToday]);

  useEffect(() => {
    activeStoryJobRef.current = activeStoryJob;
  }, [activeStoryJob]);

  const closeStory = useCallback(() => {
    explanationRequestRef.current += 1;
    setExplanationLoading(false);
    setExplanationError(undefined);
    setDetail(undefined);
    setBusy(false);
    const origin = originRef.current;
    window.requestAnimationFrame(() => { (origin?.element?.isConnected ? origin.element : document.querySelector<HTMLElement>(".rail-open"))?.focus({ preventScroll: true }); if (origin) window.scrollTo(origin.x, origin.y); });
  }, []);

  const hydrateExplanation = useCallback(async (storyId: string, requestId: number, force = false) => {
    setExplanationLoading(true);
    setExplanationError(undefined);
    try {
      const queued = await api.explainStory(storyId, force);
      if (queued.story.explanation.status === "ready" && !queued.job) {
        if (explanationRequestRef.current === requestId) {
          setDetail((current) => current?.story.id === storyId ? { ...current, story: queued.story } : current);
        }
        return;
      }
      let job = queued.job;
      if (!job) throw new Error("正文讲解任务没有成功启动");
      const waited = await waitForProductJob(job, { read: api.productJob, current: () => explanationRequestRef.current === requestId });
      job = waited.job;
      if (explanationRequestRef.current !== requestId) return;
      if (waited.deferred) { setExplanationError(deferredJobMessage(job)); return; }
      if (job.status !== "complete") throw new Error(job.error || "正文讲解暂时没有完成");
      const refreshed = await api.story(storyId);
      if (explanationRequestRef.current === requestId) {
        setDetail((current) => current?.story.id === storyId ? refreshed : current);
      }
    } catch (loadError) {
      if (explanationRequestRef.current === requestId) {
        setExplanationError(loadError instanceof Error ? loadError.message : String(loadError));
      }
    } finally {
      if (explanationRequestRef.current === requestId) setExplanationLoading(false);
    }
  }, []);

  const openStory = useCallback(async (story: Pick<StoryView, "id">) => {
    const requestId = explanationRequestRef.current + 1;
    explanationRequestRef.current = requestId;
    setExplanationError(undefined);
    setExplanationLoading(false);
    setActionError(undefined); setOpenError(undefined); setOpeningStory(story);
    originRef.current = { element: document.activeElement instanceof HTMLElement ? document.activeElement : null, x: window.scrollX, y: window.scrollY };
    setBusy(true);
    try {
      const next = await api.story(story.id);
      if (explanationRequestRef.current !== requestId) return;
      setDetail(next);
      void api.recordStoryEvent(story.id, "opened").catch(() => undefined);
      // Opening the reader is strictly cache-only. AI reading is explicit.
    } catch (openError) {
      if (explanationRequestRef.current === requestId) setOpenError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      if (explanationRequestRef.current === requestId) { setBusy(false); setOpeningStory(undefined); }
    }
  }, [onNotice]);

  useEffect(() => {
    if (!requestedStoryId) return;
    void openStory({ id: requestedStoryId });
    onRequestedStoryHandled?.();
  }, [requestedStoryId, openStory, onRequestedStoryHandled]);

  const retryExplanation = () => {
    if (!detail) return;
    const requestId = explanationRequestRef.current + 1;
    explanationRequestRef.current = requestId;
    void hydrateExplanation(detail.story.id, requestId, true);
  };

  const updateQueuedState = async (story: StoryView, selected: boolean) => {
    const signal = story.signals.find((item) => !item.isCommunity) ?? story.signals[0];
    if (!signal) throw new Error("这条事件还没有可加入待写的新闻候选");
    await api.selectCandidate(signal.runId, signal.candidateId, selected);
    if (selected && !story.signals.some((item) => item.feedback === "interested")) {
      await api.recordStoryEvent(story.id, "interested", "加入待写").catch(() => undefined);
    }
    setDetail((current) => current?.story.id === story.id
      ? { ...current, story: { ...current.story, selected } }
      : current);
  };

  const queueStory = async (story: StoryView, selected: boolean) => {
    setBusy(true);
    try {
      await updateQueuedState(story, selected);
      onNotice("success", selected ? "已加入待写，可继续选择其他事件。" : "已从待写中移除。");
      await loadToday(true);
    } catch (queueError) {
      onNotice("error", queueError instanceof Error ? queueError.message : String(queueError));
    } finally {
      setBusy(false);
    }
  };

  const skipStory = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      if (detail.story.selected) await updateQueuedState(detail.story, false);
      await api.recordStoryEvent(detail.story.id, "not_interested");
      onNotice("success", "已跳过这条事件；它不会继续占据今日首屏。");
      setDetail(undefined);
      await loadToday(true);
    } catch (feedbackError) {
      onNotice("error", feedbackError instanceof Error ? feedbackError.message : String(feedbackError));
    } finally {
      setBusy(false);
    }
  };

  const restoreFeedback = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.restoreStoryFeedback(detail.story.id);
      setDetail((current) => current ? { ...current, story: result.story } : current);
      onNotice("success", "已撤销这次选择。");
      await loadToday(true);
    } catch (restoreError) {
      onNotice("error", restoreError instanceof Error ? restoreError.message : String(restoreError));
    } finally {
      setBusy(false);
    }
  };

  const supplementEvidence = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const queued = await api.supplementStoryEvidence(detail.story.id);
      if (queued.job && !terminalJobStatuses.has(queued.job.status)) {
        storyJobIntentsRef.current.set(queued.job.id, { kind: "evidence", storyId: detail.story.id });
        setActiveStoryJob(queued.job);
        onNotice("info", "独立来源核验已进入后台；你可以继续查看和选择其他新闻。");
      } else {
        setDetail((current) => current ? { ...current, story: queued.story } : current);
        onNotice("info", queued.story.evidenceStrength === "strong" ? "这条事件已经是强证据。" : "本轮没有找到新的独立来源。");
      }
    } catch (evidenceError) {
      onNotice("error", evidenceError instanceof Error ? evidenceError.message : String(evidenceError));
    } finally {
      setBusy(false);
    }
  };

  const collectAssets = async () => {
    if (!detail) return;
    setBusy(true);
    try {
      const queued = await api.collectStoryAssets(detail.story.id);
      storyJobIntentsRef.current.set(queued.job.id, { kind: "assets", storyId: detail.story.id });
      setActiveStoryJob(queued.job);
      onNotice("info", "正在读取原文图片与图表；可以继续浏览，完成后素材会自动更新。");
    } catch (error) { onNotice("error", error instanceof Error ? error.message : String(error)); }
    finally { setBusy(false); }
  };

  const buildPackage = async (mode: Exclude<AssignmentMode, "watch" | "skip">) => {
    if (!detail) return;
    setBusy(true);
    try {
      const queued = await api.createContentPackage(detail.story.id, mode, Boolean(detail.contentPackage));
      if (queued.contentPackage) {
        setDetail((current) => current ? { ...current, contentPackage: queued.contentPackage } : current);
        onNotice("success", queued.reused ? "已打开同一证据版本的素材包。" : "素材包已建立；事实、原句与图片都可以逐项检查。");
      } else {
        storyJobIntentsRef.current.set(queued.job.id, { kind: "package", storyId: detail.story.id });
        setActiveStoryJob(queued.job);
        onNotice("info", "素材包已进入后台；可以关闭详情并继续选题，进度会实时更新。");
      }
    } catch (packageError) {
      setActionError(packageError instanceof Error ? packageError.message : String(packageError));
    } finally {
      setBusy(false);
    }
  };

  const generateDraftFromPackage = async (contentPackage: ContentPackage) => {
    const launch = await beginStarterDraft(contentPackage.id, api.createDraftFromPackage);
    if (launch.kind === "queued") {
      storyJobIntentsRef.current.set(launch.job.id, { kind: "draft", storyId: contentPackage.storyId });
      setActiveStoryJob(launch.job);
      onNotice("info", "正在根据已核验素材生成基础稿；完成后会自动打开编辑器。");
      setDetail(undefined);
      await loadToday(true);
      return;
    }
    onNotice("success", launch.reused
      ? "这份基础稿已经生成过，已为你重新打开。"
      : `基础稿已生成，并带入 ${launch.draft.images.length} 张来源图片；现在可以直接删改。`);
    setDetail(undefined);
    if (onOpenDraft) await onOpenDraft(launch.draft.id);
    else onNavigate("drafts");
  };

  const generateDraft = async (contentPackage: ContentPackage) => {
    setBusy(true);
    try {
      await generateDraftFromPackage(contentPackage);
    } catch (draftError) {
      setActionError(draftError instanceof Error ? draftError.message : String(draftError));
      onNotice("error", draftError instanceof Error ? draftError.message : String(draftError));
    } finally {
      setBusy(false);
    }
  };

  const startWritingFromPackage = async (contentPackage: ContentPackage) => {
    setBusy(true);
    try {
      const result = await api.createHumanDraftFromPackage(contentPackage.id);
      onNotice(
        "success",
        result.reused
          ? "已重新打开这份空白草稿；原来的修改都还在。"
          : `已从空白开始，并带入 ${result.draft.factClaims?.length ?? 0} 条事实和 ${result.draft.images.length} 张来源图片。`,
      );
      setDetail(undefined);
      if (onOpenDraft) await onOpenDraft(result.draft.id);
      else onNavigate("drafts");
    } catch (draftError) {
      setActionError(draftError instanceof Error ? draftError.message : String(draftError));
      onNotice("error", draftError instanceof Error ? draftError.message : String(draftError));
    } finally {
      setBusy(false);
    }
  };

  const quickWrite = async (
    story: StoryView,
    requestedMode?: Exclude<AssignmentMode, "watch" | "skip">,
  ) => {
    if (!story.assignment.canDraft) {
      onNotice("info", story.assignment.blockers[0] || "这条事件还需要补充证据后才能成稿。");
      return;
    }
    const mode = requestedMode ?? story.assignment.mode as Exclude<AssignmentMode, "watch" | "skip">;
    setActionError(undefined);
    setBusy(true);
    try {
      if (!story.selected) await updateQueuedState(story, true);
      const queued = await api.createContentPackage(story.id, mode);
      if (!queued.contentPackage) {
        storyJobIntentsRef.current.set(queued.job.id, { kind: "quick-write", storyId: story.id });
        setActiveStoryJob(queued.job);
        onNotice("info", "素材包正在后台准备；完成后会自动打开写作台，你可以继续选题。");
        return;
      }
      if (queued.contentPackage.status !== "ready") {
        const refreshed = await api.story(story.id);
        setDetail(refreshed);
        onNotice("info", "素材检查发现阻断项，请先在事件详情中处理。");
        await loadToday(true);
        return;
      }
      await generateDraftFromPackage(queued.contentPackage);
    } catch (draftError) {
      setActionError(draftError instanceof Error ? draftError.message : String(draftError));
      onNotice("error", draftError instanceof Error ? draftError.message : String(draftError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    const job = activeStoryJob;
    if (!job || !terminalJobStatuses.has(job.status) || handledJobIdsRef.current.has(job.id)) return;
    handledJobIdsRef.current.add(job.id);
    const intent = storyJobIntentsRef.current.get(job.id);
    storyJobIntentsRef.current.delete(job.id);
    void (async () => {
      try {
        if (job.status !== "complete") throw new Error(job.error || "后台任务没有完成，请在任务中心重试");
        if (!intent) return;
        if (intent.kind === "draft") {
          const draftId = draftIdFromJob(job);
          if (!draftId) throw new Error("基础稿任务完成，但没有返回草稿 ID");
          const result = (job.result ?? {}) as { reused?: boolean; imageCount?: number };
          onNotice("success", result.reused
            ? "这份基础稿已经生成过，已为你重新打开。"
            : `基础稿已生成，并带入 ${result.imageCount ?? 0} 张来源图片；现在可以直接删改。`);
          setDetail(undefined);
          if (onOpenDraft) await onOpenDraft(draftId);
          else onNavigate("drafts");
        } else if (intent.kind === "assets") {
          const refreshed = await api.story(intent.storyId);
          setDetail((current) => current?.story.id === intent.storyId ? refreshed : current);
          onNotice("info", `已保存 ${refreshed.story.localImageCount ?? 0} 张来源素材，可在「图片与图表」中查看。`);
        } else if (intent.kind === "evidence") {
          const refreshed = await api.story(intent.storyId);
          setDetail((current) => current?.story.id === intent.storyId ? refreshed : current);
          onNotice(refreshed.story.evidenceStrength === "strong" ? "success" : "info", refreshed.story.evidenceStrength === "strong"
            ? `已补入独立来源，当前共 ${refreshed.story.factSourceCount} 个事实来源。`
            : "本轮没有找到足够匹配的独立来源，事件继续留在当前证据级别。");
        } else {
          const packageId = packageIdFromJob(job);
          if (!packageId) throw new Error("素材包任务完成，但没有返回素材包 ID");
          const contentPackage = await api.contentPackage(packageId);
          if (intent.kind === "quick-write" && contentPackage.status === "ready") {
            await generateDraftFromPackage(contentPackage);
          } else {
            setDetail((current) => current?.story.id === intent.storyId ? { ...current, contentPackage } : current);
            onNotice(contentPackage.status === "ready" ? "success" : "info", contentPackage.status === "ready"
              ? "素材包已建立；事实、原句与图片都可以逐项检查。"
              : "素材包已完成检查，但仍有阻断项需要处理。");
          }
        }
        await loadToday(true);
      } catch (jobError) {
        setActionError(jobError instanceof Error ? jobError.message : String(jobError));
        onNotice("error", job.type === "build-content-package" && job.status === "failed"
          ? "文章资料暂未准备好，选题已保留。可在右下角任务中重试或回到选题。"
          : jobError instanceof Error ? jobError.message : String(jobError));
      } finally {
        setActiveStoryJob((current) => current?.id === job.id ? undefined : current);
      }
    })();
  }, [activeStoryJob, loadToday, onNotice]);

  const submitSearch = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query || searching) return;
    setSearching(true);
    try {
      await onSearch(query);
    } catch (searchError) {
      onNotice("error", searchError instanceof Error ? searchError.message : String(searchError));
    } finally {
      setSearching(false);
    }
  };

  const resumeDraft = async (draftId: string) => {
    setOpeningDraftId(draftId);
    try {
      if (onOpenDraft) await onOpenDraft(draftId);
      else onNavigate("drafts");
    } catch (openError) {
      onNotice("error", openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpeningDraftId(undefined);
    }
  };

  const newsPool = activeColumn.keyword ? keywordNews : !today ? [] : listView === "important" ? today.mustReads : listView === "interesting" ? today.interesting ?? [] : listView === "backlog" ? today.backlog : [...today.mustReads, ...today.secondary, ...(today.interesting ?? []), ...today.backlog, ...(today.releaseHighlights ?? [])];
  const visibleNews = newsPool.filter((story, i, all) => all.findIndex(s => s.id === story.id) === i)
    .filter(story => `${story.title} ${story.originalTitle} ${story.summary}`.toLocaleLowerCase().includes(listQuery.trim().toLocaleLowerCase())
      && (listTime === "all" || (story.publicationDateKnown !== false && Date.now() - Date.parse(story.publishedAt) <= Number(listTime) * 3_600_000)))
    .sort((a, b) => listSort === "latest" ? (b.publicationDateKnown === false ? 0 : Date.parse(b.publishedAt) || 0) - (a.publicationDateKnown === false ? 0 : Date.parse(a.publishedAt) || 0) : 0);

  return (
    <div className="page today-page">
      <div className="today-edition"><span><i aria-hidden="true" />个人科技编辑室</span><span>AI NEWS DESK <span aria-hidden="true">/</span> 每日选题</span></div>
      <header className="today-header">
        <div>
          <h1>今日编辑台</h1>
          <p>发现值得写的事，把好文章留给读者。</p>
        </div>
        <div className="today-header-actions">
          <span className="today-date">{new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span>
          <div>{today ? <span className="today-updated"><Clock3 size={13} />{today.collection ? `最近读取：${relativeTime(today.collection.collectedAt)}` : "尚无采集记录"}</span> : null}
          <button type="button" className="text-button today-refresh" title="重新整理已有事件；搜索才会读取外部新闻源" disabled={loading} onClick={() => void loadToday()}><RefreshCw className={loading ? "spin" : ""} size={14} />重新整理</button></div>
        </div>
      </header>

      <form className="today-news-search" onSubmit={submitSearch}>
        <div className="today-news-search-field">
          <Search size={19} aria-hidden="true" />
          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            maxLength={120}
            aria-label="搜索想写的新闻"
            placeholder="搜索模型、公司或事件，例如 GPT-6 Astra"
            aria-describedby="today-search-help"
          />
        </div>
        <button type="submit" className="primary-button" disabled={!searchQuery.trim() || searching}>
          {searching ? <><RefreshCw className="spin" size={16} />搜索中</> : <><Search size={16} />搜索最近 7 天</>}
        </button>
        <p id="today-search-help">联网搜索 · 最近 7 个香港自然日 · 已启用的官网与新闻来源；可能调用速读模型。X 和社区帖子不参与这次事实搜索。</p>
      </form>

      {today?.collection ? <aside className="today-collection-status" aria-label="最近一轮采集">
        <span>最近一轮 · {today.collection.sourceCount} 个来源 · {today.collection.rawCount} 条原始信息 → {today.collection.candidateCount} 条候选</span>
        {today.collection.failedSourceCount || today.collection.partialSourceCount ? <button type="button" className="text-button" onClick={() => onNavigate("sources")}>
          {[
            today.collection.failedSourceCount ? `${today.collection.failedSourceCount} 个来源读取失败` : "",
            today.collection.partialSourceCount ? `${today.collection.partialSourceCount} 个来源覆盖不完整` : "",
          ].filter(Boolean).join("，")} · 查看原因
        </button> : null}
      </aside> : null}



      {error ? (
        <div className="today-error" role="alert"><AlertTriangle size={18} /><div><strong>{today ? "刷新失败，保留上次内容" : "今日推荐读取失败"}</strong><p>{today ? "已有列表和选题仍可查看。可以重试读取。" : "本地列表暂不可用，可以重试。"}</p><details><summary>具体原因</summary>{error}</details></div><button type="button" onClick={() => void loadToday()}>重试</button></div>
      ) : null}

      {loading && !today ? <PageLoading label="正在整理今天的选题与草稿…" /> : null}

      {openingStory && !detail ? <p className="reader-task" role="status">正在读取已有材料…</p> : null}
      {openError ? <div className="today-error" role="alert"><div><strong>阅读器暂未打开</strong><p>列表和选题仍然保留，请重新点击该条目重试。</p><details><summary>具体原因</summary>{openError}</details></div></div> : null}
      {incomingToday ? <div className="news-update" role="status"><span>有更新的内容，当前列表保持原顺序。</span><button className="text-button" disabled={Boolean(detail)} onClick={() => { setToday(incomingToday); setIncomingToday(undefined); }}>显示更新</button></div> : null}
      <div className="today-editorial-grid">
        <div className="today-reading-column">
          <TopicCategoryTabs value={activeColumn.id} columns={layout.columns} onChange={setCategory} onCustomize={() => void customize()} />
          {activeColumn.source === "news" ? <div role="tabpanel" id={`topic-panel-${activeColumn.id}`} aria-labelledby={`topic-tab-${activeColumn.id}`} tabIndex={0}>
            <div className="news-list-toolbar">
              <label className="topic-filter-input"><Search size={16} /><input type="search" aria-label="筛选当前新闻列表" placeholder="筛选当前列表 · 不联网" value={listQuery} onChange={e => setListQuery(e.target.value)} /></label>
              <label>视图<select aria-label="新闻视图" value={listView} onChange={e => setListView(e.target.value)}><option value="all">全部推荐</option><option value="important">今日重点</option><option value="interesting">有趣实践</option><option value="backlog">近期补看</option></select></label>
              <label>排序<select aria-label="新闻排序" value={listSort} onChange={e => setListSort(e.target.value)}><option value="recommended">编辑推荐</option><option value="latest">发布时间</option></select></label>
              <label>时间<select aria-label="新闻时间" value={listTime} onChange={e => setListTime(e.target.value)}><option value="all">当前范围</option><option value="48">近 48 小时</option><option value="168">近 7 天</option></select></label>
            </div>
            <div className="news-scope"><span>{activeColumn.keyword ? `近 7 天已采集新闻 · 关键词「${activeColumn.keyword}」` : "已有推荐 · 新闻 48 小时 / 发布 7 天 / 实践 30 天"}</span><span>{visibleNews.length} 条</span></div>
            <section className="today-section today-must-read">
              <div className="today-section-heading"><div><h2>{activeColumn.keyword ? activeColumn.label : "值得阅读的选题"}</h2></div><span className="desk-section-caption">先核对，再决定写什么</span></div>
              {keywordLoading ? <p role="status">正在读取已保存内容…</p> : keywordError ? <p role="alert">{keywordError}</p> : visibleNews.length ? <div className="today-featured-list">{visibleNews.map((story, index) => <StoryRow key={story.id} story={story} featured={index === 0} busy={busy} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />)}</div>
                : <div className="today-empty"><Eye size={24} /><div><strong>{listQuery || listView !== "all" || listTime !== "all" ? "当前筛选没有结果" : today?.collection ? "本轮没有符合条件的推荐" : "还没有读取新闻"}</strong><p>{activeColumn.keyword ? "已采集新闻中暂无匹配内容。可用上方搜索补充线索。" : "可以调整筛选，或去工作台读取来源。没有合格选题时保留空位。"}</p></div><button className="secondary-button" onClick={() => { if (listQuery || listView !== "all" || listTime !== "all") { setListQuery(""); setListView("all"); setListTime("all"); } else onNavigate("workbench"); }}>{listQuery || listView !== "all" || listTime !== "all" ? "清除筛选" : "打开新闻工作台"}</button></div>}
            </section>
          </div> : <TopicCategoryPanel key={activeColumn.id} columnId={activeColumn.id} keyword={activeColumn.keyword} platform={activeColumn.source} onOpenStory={openStory}
            onChanged={() => void loadToday(true)} onNavigate={onNavigate} onNotice={onNotice} />}
        </div>
        {today ? <TodayWorkspaceRail showDrafts={layout.showDrafts} today={today} drafts={drafts} draftError={draftError} openingDraftId={openingDraftId} onRetry={() => void loadToday(true)} onNavigate={onNavigate} onOpenDraft={(draftId) => void resumeDraft(draftId)} onOpenStory={openStory} /> : <aside className="today-workspace-rail"><button type="button" className="text-button" onClick={() => onNavigate("drafts")}>打开我的稿件 <ArrowRight size={15} /></button></aside>}
      </div>
      {today ? <>
        {activeColumn.source === "news" && !activeColumn.keyword ? <KnowledgeShelf stories={today.knowledge ?? []} onOpen={openStory} /> : null}
          <div className="desk-operational-details">
            {today.diagnostics.length ? (
              <details className="desk-disclosure">
                <summary><span><AlertTriangle size={16} />来源运行提示 <strong>{today.diagnostics.length}</strong></span><span>展开诊断 <ChevronRight size={15} /></span></summary>
                <section className="today-diagnostics" aria-label="来源诊断">
                  {today.diagnostics.map((diagnostic) => (
                    <div key={diagnostic.sourceId}><AlertTriangle size={15} /><p><strong>{diagnostic.name}</strong><span>{diagnostic.detail}</span></p><small>{diagnostic.consecutiveFailures ? `${diagnostic.consecutiveFailures} 次失败` : "检查匹配"}</small></div>
                  ))}
                  <button type="button" className="text-button" onClick={() => onNavigate("sources")}>去来源页诊断 <ArrowRight size={14} /></button>
                </section>
              </details>
            ) : null}
            <details className="desk-disclosure"><summary><span><FileStack size={16} />工作记录与推荐覆盖</span><span>查看统计 <ChevronRight size={15} /></span></summary><Funnel data={today.funnel} /></details>
          </div>
      </> : null}

      {customizing ? <HomeLayoutDialog initial={layout} onClose={() => setCustomizing(false)} onSaved={(next) => { const removed = !next.columns.some(column => column.id === activeColumn.id); const index = Math.min(layout.columns.findIndex(column => column.id === activeColumn.id), next.columns.length - 1); applyLayout(next); setCustomizing(false); if (removed) window.requestAnimationFrame(() => document.getElementById(`topic-tab-${next.columns[Math.max(0, index)]!.id}`)?.focus()); }} /> : null}
      {detail ? (
        <StoryReader
          detail={detail}
          busy={busy}
          activeJob={activeStoryJob && activeStoryJob.payload && typeof activeStoryJob.payload === "object"
            && "storyId" in activeStoryJob.payload
            && String((activeStoryJob.payload as { storyId: unknown }).storyId) === detail.story.id
            ? activeStoryJob
            : undefined}
          explanationLoading={explanationLoading}
          explanationError={explanationError}
          actionError={actionError}
          onClose={closeStory}
          onRetryExplanation={retryExplanation}
          onSupplementEvidence={() => void supplementEvidence()}
          onCollectAssets={() => void collectAssets()}
          onSkip={skipStory}
          onQueue={(selected) => void queueStory(detail.story, selected)}
          onRestoreFeedback={restoreFeedback}
          onBuildPackage={buildPackage}
          onStartWriting={(contentPackage) => void startWritingFromPackage(contentPackage)}
          onGenerateDraft={generateDraft}
          onQuickWrite={(mode) => void quickWrite(detail.story, mode)}
        />
      ) : null}
    </div>
  );
}
