import { useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  ArrowDownUp,
  ArrowRight,
  BookOpenText,
  CalendarRange,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  Flame,
  Image as ImageIcon,
  Info,
  LoaderCircle,
  Languages,
  Newspaper,
  PanelRightClose,
  PanelRightOpen,
  Pin,
  Plus,
  RefreshCw,
  ScanText,
  Search,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  X,
  TriangleAlert,
} from "lucide-react";
import { WorkflowStepper } from "./WorkflowStepper";
import { QuickDraftModal } from "./QuickDraftModal";
import { CommunityDraftModal, type CommunityDraftMode } from "./CommunityDraftModal";
import { collectionTopics } from "../../server/topics.js";
import { composeCandidateHome } from "../../server/candidate-home.js";
import { isCommunityCandidate } from "../../server/community-feed.js";
import {
  allCollectionTopicIds,
  sourceRoleFor,
  sourceRoutesFor,
  sourceSupportsTopics,
  sourceTopicIds,
} from "../../server/source-routing.js";
import type {
  AiProviderConfig,
  EvidenceReviewSelection,
  IntakeReviewRecord,
  CollectionRequest,
  CollectionTopicId,
  CandidateFeedbackKind,
  Candidate,
  Settings,
  SourceConfig,
  WorkflowRun,
} from "../types";

interface WorkbenchProps {
  settings: Settings;
  sources: SourceConfig[];
  run?: WorkflowRun;
  activeProvider: AiProviderConfig;
  busy: boolean;
  onSettings: (patch: Partial<Settings>) => void;
  onSourceToggle: (source: SourceConfig, selected: boolean) => void;
  onAddSource: () => void;
  onCollect: (filters: CollectionRequest) => void;
  onCancel: () => void;
  onSelect: (candidateId: string, selected: boolean) => void;
  feedbackCount: number;
  onFeedback: (
    candidateId: string,
    kind: Extract<CandidateFeedbackKind, "interested" | "not_interested">,
  ) => Promise<void>;
  onRestoreFeedback: (candidateId: string) => Promise<void>;
  onTogglePersonalization: (enabled: boolean) => Promise<void>;
  onClearFeedback: () => Promise<void>;
  onGenerate: () => void;
  onCommunityDraft: (candidateId: string, mode: CommunityDraftMode) => Promise<void>;
  onOpenDrafts: () => void;
  onClearCandidates: (candidateIds?: string[]) => Promise<void>;
  onBriefCandidates: () => Promise<void>;
  onQuickDraftUrl: (url: string) => Promise<IntakeReviewRecord>;
  onQuickDraftScreenshot: (file: File, note?: string) => Promise<IntakeReviewRecord>;
  onConfirmQuickDraftReview: (reviewId: string, selection: EvidenceReviewSelection) => Promise<void>;
  onOpenAiSettings: () => void;
}

type CandidateSortMode = "recommended" | "heat" | "value" | "latest";

const stageNames = ["采集原始条目", "去重与评分", "核验一手来源", "提取来源原图", "生成中文速读"];

const containsChinese = (value: string) => /[\u3400-\u9fff]/u.test(value);

const briefingBasisLabel = (candidate: Candidate, generating = false) => {
  if (!candidate.briefing) return generating ? "中文摘要生成中" : "中文摘要待生成";
  if (candidate.briefing.basis === "full-source") return "已读原文";
  if (candidate.briefing.basis === "excerpt") return "据来源摘要";
  return "仅据标题";
};

const candidateDisplayTitle = (candidate: Candidate) => candidate.briefing?.titleZh
  ?? candidate.title;

const candidateDisplaySummary = (candidate: Candidate) => candidate.briefing?.summaryZh
  ?? (candidate.excerpt.trim() || "中文标题和摘要尚未生成。");

const stageDisplayLabel = (stage: string) => stage === "生成中文速读" ? "生成中文摘要" : stage;

const candidateSupportsCommunityDraft = (candidate: Candidate) => {
  return isCommunityCandidate(candidate);
};

const activeStepFor = (run?: WorkflowRun) => {
  if (!run) return 1;
  if (["queued", "collecting", "scoring", "extracting"].includes(run.status)) return 1;
  if (run.status === "ready") return 2;
  if (run.status === "generating") return 3;
  if (run.status === "complete") return 3;
  return 1;
};

const formatDate = (date: Date) =>
  new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);

const formatTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));

const inputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const relativeInputDate = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return inputDate(date);
};

const runStageState = (run: WorkflowRun | undefined, stage: string, index: number) => {
  if (!run) return index === 0 ? "current" : "waiting";
  const logIndex = run.logs.findIndex((log) => log.stage === stage);
  const currentIndex = stageNames.findIndex((name) => run.stage.includes(name.replace("来源", "")));
  if (logIndex >= 0 && index < currentIndex) return "complete";
  if (run.status === "ready" || run.status === "generating" || run.status === "complete") {
    if (!run.candidates.length && index >= 2) return "waiting";
    return "complete";
  }
  if (currentIndex === index) return "current";
  if (logIndex >= 0) return "complete";
  return "waiting";
};

export function Workbench({
  settings,
  sources,
  run,
  activeProvider,
  busy,
  onSettings,
  onSourceToggle,
  onAddSource,
  onCollect,
  onCancel,
  onSelect,
  feedbackCount,
  onFeedback,
  onRestoreFeedback,
  onTogglePersonalization,
  onClearFeedback,
  onGenerate,
  onCommunityDraft,
  onOpenDrafts,
  onClearCandidates,
  onBriefCandidates,
  onQuickDraftUrl,
  onQuickDraftScreenshot,
  onConfirmQuickDraftReview,
  onOpenAiSettings,
}: WorkbenchProps) {
  const [dateFrom, setDateFrom] = useState(() => relativeInputDate(-1));
  const [dateTo, setDateTo] = useState(() => relativeInputDate(0));
  const [keywords, setKeywords] = useState("");
  const [candidateSort, setCandidateSort] = useState<CandidateSortMode>("recommended");
  const [quickDraftOpen, setQuickDraftOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [runRailOpen, setRunRailOpen] = useState(true);
  const [rankingHelpOpen, setRankingHelpOpen] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState<string>();
  const [communityDraftCandidate, setCommunityDraftCandidate] = useState<Candidate>();
  const [keyboardCursor, setKeyboardCursor] = useState(0);
  const keywordInputRef = useRef<HTMLInputElement>(null);
  const candidates = (run?.candidates ?? []).filter((candidate) => !isCommunityCandidate(candidate));
  const sortedCandidates = useMemo(() => [...candidates].sort((left, right) => {
    if (candidateSort === "heat") return right.heatScore - left.heatScore;
    if (candidateSort === "value") return right.score - left.score;
    if (candidateSort === "latest") return Date.parse(right.publishedAt) - Date.parse(left.publishedAt);
    const personalizationDelta = settings.personalizationEnabled
      ? (right.personalizationScore ?? 0) - (left.personalizationScore ?? 0)
      : 0;
    return right.recommendationScore - left.recommendationScore + personalizationDelta;
  }), [candidateSort, candidates, settings.personalizationEnabled]);
  const recommendationRankedCandidates = useMemo(() => [...candidates].sort((left, right) => {
    const personalizationDelta = settings.personalizationEnabled
      ? (right.personalizationScore ?? 0) - (left.personalizationScore ?? 0)
      : 0;
    return right.recommendationScore - left.recommendationScore + personalizationDelta;
  }), [candidates, settings.personalizationEnabled]);
  const candidateHome = useMemo(() => composeCandidateHome(recommendationRankedCandidates, {
    now: new Date().toISOString(),
    expiryHours: 48,
    secondaryCount: 4,
  }), [recommendationRankedCandidates]);
  const otherCandidateIds = useMemo(
    () => new Set(candidateHome.others.map((candidate) => candidate.id)),
    [candidateHome.others],
  );
  const tableCandidates = useMemo(
    () => sortedCandidates.filter((candidate) => otherCandidateIds.has(candidate.id)),
    [otherCandidateIds, sortedCandidates],
  );
  const missingBriefingCount = candidates.filter((candidate) => !candidate.briefing).length;
  const selected = candidates.filter((candidate) => candidate.selected);

  useEffect(() => {
    setKeyboardCursor((current) => Math.min(current, Math.max(0, sortedCandidates.length - 1)));
  }, [sortedCandidates.length]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      const target = event.target;
      const typing = target instanceof HTMLInputElement
        || target instanceof HTMLTextAreaElement
        || target instanceof HTMLSelectElement
        || (target instanceof HTMLElement && target.isContentEditable);
      const interactive = target instanceof Element && Boolean(target.closest(
        "button, a, summary, [role='button'], [role='link'], [role='menuitem']",
      ));
      if (event.key === "/" && !typing && !interactive && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        keywordInputRef.current?.focus();
        return;
      }
      if (typing || interactive || event.metaKey || event.ctrlKey || event.altKey || !sortedCandidates.length) return;
      const key = event.key.toLowerCase();
      if (key === "j" || key === "k") {
        event.preventDefault();
        const delta = key === "j" ? 1 : -1;
        const next = (keyboardCursor + delta + sortedCandidates.length) % sortedCandidates.length;
        setKeyboardCursor(next);
        const candidate = sortedCandidates[next];
        window.requestAnimationFrame(() => {
          const element = document.getElementById(`candidate-${candidate.id}`);
          element?.focus({ preventScroll: true });
          element?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
        return;
      }
      const current = sortedCandidates[keyboardCursor];
      if ((key === "a" || event.key === " ") && current) {
        event.preventDefault();
        onSelect(current.id, !current.selected);
        if (!current.selected) setRunRailOpen(true);
        return;
      }
      if (key === "g" && selected.length && run && ["ready", "complete"].includes(run.status) && !busy) {
        event.preventDefault();
        onGenerate();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [busy, keyboardCursor, onGenerate, onSelect, run, selected.length, sortedCandidates]);
  const comprehensive = allCollectionTopicIds.every((topicId) => settings.collectionTopics.includes(topicId));
  const activeChannel: "all" | CollectionTopicId = comprehensive
    ? "all"
    : settings.collectionTopics.length === 1
      ? settings.collectionTopics[0]
      : "all";
  const visibleSources = sources.filter((source) =>
    source.enabled
    && sourceRoleFor(source) !== "community"
    && (activeChannel === "all" || sourceSupportsTopics(source, [activeChannel])),
  );
  const selectedSources = visibleSources.filter((source) => source.selected);
  const selectedSourceCount = selectedSources.length;
  const topicDiscoveryEnabled = selectedSources.some((source) => source.kind === "google_news");
  const activeStep = activeStepFor(run);
  const collectionIsActive = Boolean(run && ["queued", "collecting", "scoring", "extracting"].includes(run.status));
  const briefingGenerationActive = Boolean(collectionIsActive && run?.stage.includes("生成中文速读"));
  const runIsActive = collectionIsActive || run?.status === "generating";
  const quickIntakeActive = Boolean(runIsActive && (run?.origin === "link-intake" || run?.origin === "screenshot-intake"));
  const quickIntakeRun = Boolean(run?.origin === "link-intake" || run?.origin === "screenshot-intake");
  const quickStagePosition = run?.status === "complete"
    ? 3
    : /生成|核验/u.test(run?.stage || "")
      ? 2
      : 1;
  const candidatesWereCleared = Boolean(run?.candidatesClearedAt);
  const runOnlyContainsCommunity = Boolean(run?.candidates.length && candidates.length === 0);
  const runHasNoResults = Boolean(run && !candidatesWereCleared && !runOnlyContainsCommunity && !runIsActive && !["failed", "cancelled"].includes(run.status) && candidates.length === 0);
  const selectChannel = (channel: "all" | CollectionTopicId) => {
    onSettings({ collectionTopics: channel === "all" ? [...allCollectionTopicIds] : [channel] });
  };
  const sourceRouteLabel = (source: SourceConfig) => {
    if (source.kind === "google_news") return "补充搜索（可选）";
    if (source.kind === "hackernews") return "热门讨论";
    if (source.kind === "last30days") return "近 30 天社区趋势";
    if (source.kind === "github") return "项目发布与真实问题";
    if (activeChannel === "esports" && source.note) return source.note;
    if (activeChannel === "all") return `${sourceTopicIds(source).length} 个可用栏目`;
    return sourceRoutesFor(source, [activeChannel])[0]?.label
      ?? collectionTopics.find((topic) => topic.id === activeChannel)?.label
      ?? "默认栏目";
  };
  const dateRangeDays = dateFrom && dateTo
    ? Math.floor((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000) + 1
    : 0;
  const invalidDateRange = !dateFrom || !dateTo || dateFrom > dateTo || dateRangeDays > 31;
  const startCollection = () => onCollect({
    sourceIds: selectedSources.map((source) => source.id),
    topicIds: settings.collectionTopics,
    dateFrom,
    dateTo,
    keywords: keywords.trim() || undefined,
  });
  const updateFeedback = async (
    candidateId: string,
    action: () => Promise<void>,
  ) => {
    setFeedbackBusy(candidateId);
    try {
      await action();
    } finally {
      setFeedbackBusy(undefined);
    }
  };

  return (
    <div className="page workbench-page">
      <header className="page-header workbench-header">
        <div>
          <h1>新闻工作台</h1>
          <p>只看媒体与官方来源；社区热点已移到独立的社区广场。</p>
        </div>
        <div className="header-meta">
          <span><CalendarDays size={17} />{formatDate(new Date())}</span>
          <span className="next-run"><Clock3 size={17} />下次采集 {settings.scheduleTime}</span>
        </div>
      </header>

      <WorkflowStepper active={activeStep} />

      <div className={`workbench-grid ${runRailOpen ? "" : "run-rail-collapsed-layout"}`}>
        <section className="workflow-surface" aria-label="采集控制台">
          <div className="collection-controls">
            <label className="field-control date-range-control">
              <span className="control-label"><CalendarRange size={15} />搜寻日期</span>
              <span className="date-range-fields">
                <input type="date" aria-label="开始日期" value={dateFrom} max={dateTo || relativeInputDate(0)} onChange={(event) => setDateFrom(event.target.value)} />
                <ArrowRight size={15} />
                <input type="date" aria-label="结束日期" value={dateTo} min={dateFrom} max={relativeInputDate(0)} onChange={(event) => setDateTo(event.target.value)} />
              </span>
              <small>{dateFrom > dateTo ? "开始日期不能晚于结束日期" : dateRangeDays > 31 ? "单次最多搜索 31 天" : `本次包含 ${dateRangeDays} 天`}</small>
            </label>
            <label className="field-control keyword-control">
              <span className="control-label"><Search size={15} />搜索关键词</span>
              <span className="input-with-icon">
                <Search size={16} />
                <input
                  ref={keywordInputRef}
                  type="search"
                  value={keywords}
                  maxLength={120}
                  onChange={(event) => setKeywords(event.target.value)}
                  placeholder="如：OpenAI、苹果、政策"
                />
              </span>
              <small>多个关键词用逗号分隔，匹配其中任意一个</small>
            </label>
            <label className="field-control">
              <span className="control-label">成稿模式</span>
              <span className="select-wrap">
                <select value="separate" disabled aria-label="成稿模式：分别成稿">
                  <option value="separate">分别成稿</option>
                </select>
                <ChevronDown size={16} />
              </span>
              <small>每条待写候选独立生成一篇草稿</small>
            </label>
            <label className="field-control image-policy-control">
              <span className="control-label">图片策略</span>
              <span className="select-wrap">
                <select
                  value={settings.imagePolicy}
                  onChange={(event) =>
                    onSettings({ imagePolicy: event.target.value as Settings["imagePolicy"] })
                  }
                >
                  <option value="source">优先官方／来源原图</option>
                  <option value="screenshot">网页截图</option>
                  <option value="none">不配图</option>
                </select>
                <ChevronDown size={16} />
              </span>
            </label>
          </div>

          <div className="source-selector">
            <div className="topic-selector">
              <div className="section-inline-heading">
                <span>搜寻频道</span>
                <small>{runIsActive ? "当前任务已锁定；修改会用于下一次" : "选择频道后，下方只显示有对应栏目的官网"}</small>
              </div>
              <div className="topic-options">
                <button
                  type="button"
                  className={activeChannel === "all" ? "topic-option selected" : "topic-option"}
                  aria-pressed={activeChannel === "all"}
                  onClick={() => selectChannel("all")}
                >
                  {activeChannel === "all" ? <Check size={13} /> : null}
                  综合
                </button>
                {collectionTopics.map((topic) => {
                  const selectedTopic = activeChannel === topic.id;
                  return (
                    <button
                      type="button"
                      key={topic.id}
                      className={selectedTopic ? "topic-option selected" : "topic-option"}
                      aria-pressed={selectedTopic}
                      title={topic.description}
                      onClick={() => selectChannel(topic.id)}
                    >
                      {selectedTopic ? <Check size={13} /> : null}
                      {topic.label}
                    </button>
                  );
                })}
              </div>
              <p className={topicDiscoveryEnabled ? "topic-search-note" : "topic-search-note warning"}>
                {topicDiscoveryEnabled
                  ? activeChannel === "all"
                    ? "Google News 补充搜索已开启：会按频道、日期和关键词扩大候选；最终仍回到原发布网站核验。"
                    : `已切换到${collectionTopics.find((topic) => topic.id === activeChannel)?.label ?? "当前"}频道；Google News 只补充候选，已选官网仍按对应栏目采集。`
                  : "Google News 补充搜索未开启：不影响已选官网采集；需要扩大范围时，可在下方来源中勾选。"}
              </p>
            </div>
            <div className="source-collapse-heading">
              <button
                className="source-collapse-trigger"
                aria-expanded={sourcesOpen}
                onClick={() => setSourcesOpen((open) => !open)}
              >
                <span><strong>采集来源</strong><small>已选择 {selectedSourceCount} / {visibleSources.length}</small></span>
                <ChevronDown size={16} />
              </button>
              <button className="text-button" onClick={onAddSource}><Plus size={15} />管理新闻源</button>
            </div>
            {sourcesOpen ? (
              <div className="source-options source-options-collapsible">
                {visibleSources.map((source) => (
                  <label key={source.id} className={source.selected ? "source-option selected" : "source-option"}>
                    <input
                      type="checkbox"
                      checked={source.selected}
                      onChange={(event) => onSourceToggle(source, event.target.checked)}
                    />
                    <span className="custom-check">{source.selected ? <Check size={13} /> : null}</span>
                    <span className="source-option-copy">
                      <strong>{source.name}</strong>
                      <small>{sourceRouteLabel(source)}</small>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="source-collapsed-summary">
                <span>{selectedSources.slice(0, 5).map((source) => source.name).join("、") || "尚未选择来源"}</span>
                {selectedSources.length > 5 ? <small>等 {selectedSources.length} 个来源</small> : null}
              </div>
            )}
            <div className="collect-row">
              <p>{sourcesOpen ? "官网链接用于人工查看；RSS 与新闻索引仅在后台采集。采集后会去重、评分并读取来源原图。" : "来源已收起；展开后可增减官网或开启 Google News 补充搜索。"}</p>
              <div className="collect-actions">
                {collectionIsActive ? (
                  <button className="secondary-button danger-button" onClick={onCancel} disabled={busy}>
                    <X size={16} />取消
                  </button>
                ) : null}
                <button className="primary-button" onClick={startCollection} disabled={runIsActive || !selectedSourceCount || invalidDateRange || busy}>
                  {collectionIsActive ? <LoaderCircle className="spin" size={17} /> : <RefreshCw size={17} />}
                  {collectionIsActive ? "正在采集" : run?.status === "generating" ? "正在成稿" : "开始采集"}
                </button>
              </div>
            </div>
          </div>

          <div className="candidate-region">
            <div className="table-heading">
              <div className="candidate-heading-copy">
                <h2>候选新闻</h2>
                <span>{run ? `${run.rawCount} 条原始记录${run.filteredRawCount !== undefined ? ` · ${run.filteredRawCount} 条符合搜索条件` : ""} · ${candidates.length} 条候选` : "尚未启动今日采集"}</span>
              </div>
              <div className="candidate-toolbar">
                <span className="candidate-shortcuts" title="键盘快捷键：J/K 浏览，A 或空格加入待写，G 生成，/ 搜索">J/K 浏览 · A 加入 · G 生成</span>
                <label className="personalization-toggle" title="只调整综合推荐顺序，不改新闻价值或公开传播证据">
                  <input
                    type="checkbox"
                    checked={settings.personalizationEnabled}
                    onChange={(event) => void onTogglePersonalization(event.target.checked)}
                  />
                  <span className="personalization-switch" aria-hidden="true" />
                  <span>个性化 {settings.personalizationEnabled ? "开" : "关"}</span>
                </label>
                <button
                  className="candidate-clear-button preference-clear-button"
                  disabled={!feedbackCount || busy}
                  title={`清空 ${feedbackCount} 条历史偏好；不会删除候选或草稿`}
                  onClick={() => {
                    if (window.confirm(`清空全部 ${feedbackCount} 条编辑偏好？候选和草稿不会删除。`)) {
                      void onClearFeedback();
                    }
                  }}
                ><RotateCcw size={13} />清空偏好</button>
                <label className="candidate-sort" title="只有公开互动或多家独立跟进才算传播证据；没有数据不会被判为低热度">
                  <ArrowDownUp size={14} />
                  <select value={candidateSort} onChange={(event) => setCandidateSort(event.target.value as CandidateSortMode)}>
                    <option value="recommended">综合推荐</option>
                    <option value="heat">公开传播优先</option>
                    <option value="value">价值优先</option>
                    <option value="latest">最新发布</option>
                  </select>
                  <ChevronDown size={13} />
                </label>
                <button
                  className={rankingHelpOpen ? "ranking-help-button active" : "ranking-help-button"}
                  aria-expanded={rankingHelpOpen}
                  onClick={() => setRankingHelpOpen((open) => !open)}
                  title="新闻价值与公开传播证据如何区分"
                ><Info size={14} /><span>指标说明</span></button>
                {missingBriefingCount ? (
                  <button
                    className="secondary-button compact candidate-briefing-trigger"
                    disabled={runIsActive || busy}
                    title={`补全 ${missingBriefingCount} 条中文标题和摘要；失败不会影响候选`}
                    onClick={() => void onBriefCandidates()}
                  >{busy ? <LoaderCircle className="spin" size={14} /> : <Languages size={14} />}补全中文摘要</button>
                ) : null}
                <button className="secondary-button compact quick-draft-trigger" onClick={() => setQuickDraftOpen(true)}><ScanText size={15} />截图／链接成稿</button>
                <button
                  className="candidate-clear-button"
                  disabled={!candidates.length || runIsActive || busy}
                  title="只清空当前候选；已有草稿和运行记录会保留"
                  onClick={() => {
                    if (window.confirm(`清空当前 ${candidates.length} 条新闻候选？社区广场内容、已有草稿和运行记录都会保留。`)) {
                      void onClearCandidates(candidates.map((candidate) => candidate.id));
                    }
                  }}
                ><Trash2 size={14} />清空</button>
                {run?.status === "complete" ? (
                  <button className="secondary-button compact" onClick={onOpenDrafts}>查看草稿</button>
                ) : null}
              </div>
            </div>
            {rankingHelpOpen ? (
              <div className="candidate-ranking-note" role="note">
                <Info size={16} />
                <p><strong>新闻价值和公开传播是两件事。</strong>“新闻价值”是对影响、时效、证据与相关性的编辑评分；“公开传播”只认来源公开的积分／评论，或多家独立媒体同时跟进。没有这些数据就显示“暂无数据”，不再用媒体名气和发布时间猜一个低热度。高价值但暂无传播数据并不矛盾。个性化只微调综合推荐顺序，不改这两类信号。</p>
              </div>
            ) : null}
            {candidateHome.featured ? (
              <section className="candidate-recommendation-board" aria-labelledby="collection-priority-title">
                <header className="candidate-recommendation-heading">
                  <div>
                    <span className="candidate-section-kicker"><Pin size={13} />置顶</span>
                    <div><h3 id="collection-priority-title">本次采集优先候选</h3><p>这是本次采集中的候选级排序；同一事件可能有多条来源，且只保留 48 小时有效窗口内的条目。</p></div>
                  </div>
                  <span>{candidateHome.active.length} 条仍在 48 小时有效窗口内</span>
                </header>
                <article
                  id={`candidate-${candidateHome.featured.id}`}
                  tabIndex={0}
                  className={`${candidateHome.featured.selected ? "candidate-featured selected" : "candidate-featured"}${sortedCandidates[keyboardCursor]?.id === candidateHome.featured.id ? " keyboard-active" : ""}`}
                >
                  <div className="candidate-featured-copy">
                    <div className="candidate-card-meta">
                      <span>{candidateHome.featured.sourceName}</span>
                      <span>{candidateHome.featured.evidence}</span>
                      <span className={`briefing-basis ${candidateHome.featured.briefing?.basis ?? "pending"}`}>{briefingBasisLabel(candidateHome.featured, briefingGenerationActive)}</span>
                      <span>价值 {candidateHome.featured.score}/15</span>
                    </div>
                    <h4>{candidateDisplayTitle(candidateHome.featured)}</h4>
                    <p>{candidateDisplaySummary(candidateHome.featured)}</p>
                    <div className="candidate-original-title">
                      <span>原标题</span>
                      <b lang={containsChinese(candidateHome.featured.title) ? "zh-CN" : "en"}>{candidateHome.featured.title}</b>
                    </div>
                  </div>
                  <div className="candidate-card-actions">
                    <button
                      type="button"
                      className={candidateHome.featured.selected ? "candidate-pick-button selected" : "candidate-pick-button"}
                      onClick={() => {
                        onSelect(candidateHome.featured!.id, !candidateHome.featured!.selected);
                        if (!candidateHome.featured!.selected) setRunRailOpen(true);
                      }}
                    >{candidateHome.featured.selected ? <Check size={14} /> : <Plus size={14} />}{candidateHome.featured.selected ? "已加入待写" : "加入待写"}</button>
                    {candidateSupportsCommunityDraft(candidateHome.featured) ? (
                      <button
                        type="button"
                        className="community-draft-button"
                        onClick={() => setCommunityDraftCandidate(candidateHome.featured)}
                      ><Languages size={14} />社区内容入稿</button>
                    ) : null}
                    <a className="view-source-button" href={candidateHome.featured.canonicalUrl ?? candidateHome.featured.url} target="_blank" rel="noreferrer"><BookOpenText size={14} />原文</a>
                  </div>
                </article>
                {candidateHome.recommended.length ? (
                  <div className="candidate-secondary-section">
                    <div className="candidate-secondary-heading"><strong>其他优先候选</strong><span>同属本次采集，可先看中文摘要再决定是否加入待写</span></div>
                    <div className="candidate-secondary-grid">
                      {candidateHome.recommended.map((candidate) => (
                        <article
                          id={`candidate-${candidate.id}`}
                          tabIndex={0}
                          className={`${candidate.selected ? "candidate-secondary-card selected" : "candidate-secondary-card"}${sortedCandidates[keyboardCursor]?.id === candidate.id ? " keyboard-active" : ""}`}
                          key={candidate.id}
                        >
                          <div className="candidate-card-meta">
                            <span>{candidate.sourceName}</span>
                            <span className={`briefing-basis ${candidate.briefing?.basis ?? "pending"}`}>{briefingBasisLabel(candidate, briefingGenerationActive)}</span>
                          </div>
                          <h4>{candidateDisplayTitle(candidate)}</h4>
                          <p>{candidateDisplaySummary(candidate)}</p>
                          <small lang={containsChinese(candidate.title) ? "zh-CN" : "en"}>原题 · {candidate.title}</small>
                          <footer>
                            <span>价值 {candidate.score}/15 · {formatTime(candidate.publishedAt)}</span>
                            <div>
                              <button
                                type="button"
                                aria-label={`${candidate.selected ? "从待写移除" : "加入待写"}：${candidate.title}`}
                                title={candidate.selected ? "从待写移除" : "加入待写"}
                                onClick={() => {
                                  onSelect(candidate.id, !candidate.selected);
                                  if (!candidate.selected) setRunRailOpen(true);
                                }}
                              >{candidate.selected ? <Check size={13} /> : <Plus size={13} />}</button>
                              {candidateSupportsCommunityDraft(candidate) ? (
                                <button
                                  type="button"
                                  onClick={() => setCommunityDraftCandidate(candidate)}
                                  aria-label={`社区内容入稿：${candidate.title}`}
                                  title="保留原文、忠实翻译或社区整理"
                                ><Languages size={13} /></button>
                              ) : null}
                              <a href={candidate.canonicalUrl ?? candidate.url} target="_blank" rel="noreferrer" aria-label={`查看原文：${candidate.title}`} title="查看原文"><BookOpenText size={13} /></a>
                            </div>
                          </footer>
                        </article>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            ) : null}
            {candidates.length ? (
              <div className="candidate-list-heading">
                <div><h3>更多候选</h3><span>{tableCandidates.length} 条 · 可按上方条件重新排序</span></div>
                {candidateHome.expired.length ? <span><Archive size={13} />已自动移出 {candidateHome.expired.length} 条超过 48 小时的候选</span> : null}
              </div>
            ) : null}
            <div className="candidate-table-wrap">
              <table className="candidate-table">
                <thead>
                  <tr>
                    <th aria-label="选择" />
                    <th>价值 / 传播</th>
                    <th>来源</th>
                    <th>候选新闻</th>
                    <th>发布时间</th>
                    <th>原图</th>
                    <th>编辑偏好</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {!candidates.length ? (
                    <tr className={runHasNoResults ? "empty-row warning" : "empty-row"}>
                      <td colSpan={8}>
                        {runHasNoResults ? <TriangleAlert size={26} /> : candidatesWereCleared ? <Trash2 size={26} /> : quickIntakeActive ? <LoaderCircle className="spin" size={26} /> : <Newspaper size={26} />}
                        <strong>{runHasNoResults ? "本次采集完成，但没有找到候选新闻" : candidatesWereCleared ? "当前候选列表已清空" : quickIntakeActive ? run?.stage : "点一次“开始采集”，候选会自动出现在这里"}</strong>
                        <span>
                          {runHasNoResults
                            ? run?.rawCount
                              ? `读取了 ${run.rawCount} 条原始记录，但都没有通过日期、关键词、频道或价值过滤。`
                              : "没有读到原始记录；请检查官网来源状态、日期范围和网络。"
                            : candidatesWereCleared
                              ? "来源记录和已有草稿仍然保留；重新采集即可恢复一批新候选。"
                              : quickIntakeActive
                                ? "任务在后台运行；完成后会自动打开可继续编辑的草稿。"
                                : "也可以直接提交截图或链接，生成一篇可编辑草稿。"}
                        </span>
                        {runHasNoResults || candidatesWereCleared ? (
                          <div className="empty-run-actions">
                            {runHasNoResults ? <button className="secondary-button" onClick={onAddSource}>检查新闻源</button> : null}
                            <button className="secondary-button" onClick={() => setQuickDraftOpen(true)}>截图／链接成稿</button>
                            <button className="primary-button" onClick={startCollection}>重新采集</button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ) : tableCandidates.length ? tableCandidates.map((candidate) => {
                    const hasPublicEngagement = candidate.engagement?.points !== undefined
                      || candidate.engagement?.comments !== undefined;
                    const engagementLabel = [
                      candidate.engagement?.points !== undefined ? `${candidate.engagement.points} 分` : "",
                      candidate.engagement?.comments !== undefined ? `${candidate.engagement.comments} 评` : "",
                    ].filter(Boolean).join(" · ");
                    const hasCrossSourcePickup = candidate.relatedSources.length > 1;
                    const hasPropagationEvidence = hasPublicEngagement || hasCrossSourcePickup;
                    const propagationLabel = [
                      engagementLabel,
                      hasCrossSourcePickup ? `${candidate.relatedSources.length} 家跟进` : "",
                    ].filter(Boolean).join(" · ");
                    const heatTitle = hasPublicEngagement
                      ? `可核验公开互动：${engagementLabel}${hasCrossSourcePickup ? `；${candidate.relatedSources.length} 家独立来源跟进` : ""}`
                      : hasCrossSourcePickup
                        ? `可核验传播证据：${candidate.relatedSources.length} 家独立来源跟进`
                        : "来源没有公开阅读/互动数据，也没有检测到多家独立跟进；这表示暂无数据，不代表热度低";
                    return (
                    <tr
                      id={`candidate-${candidate.id}`}
                      key={candidate.id}
                      tabIndex={0}
                      className={`${candidate.selected ? "selected" : ""}${sortedCandidates[keyboardCursor]?.id === candidate.id ? " keyboard-active" : ""}`.trim() || undefined}
                    >
                      <td>
                        <label className="row-checkbox">
                          <input
                            type="checkbox"
                            aria-label={`加入待写：${candidateDisplayTitle(candidate)}`}
                            checked={candidate.selected}
                            onChange={(event) => {
                              onSelect(candidate.id, event.target.checked);
                              if (event.target.checked) setRunRailOpen(true);
                            }}
                          />
                          <span>{candidate.selected ? <Check size={13} /> : null}</span>
                        </label>
                      </td>
                      <td>
                        <div className="candidate-signals">
                          <span className={`score score-${Math.min(3, Math.floor(candidate.score / 4))}`}>价值 {candidate.score}/15</span>
                          {settings.personalizationEnabled && candidate.personalizationScore ? (
                            <span
                              className={`personalization-score ${candidate.personalizationScore > 0 ? "positive" : "negative"}`}
                              title={(candidate.personalizationReasons ?? []).join("；")}
                            >个性化 {candidate.personalizationScore > 0 ? "+" : ""}{candidate.personalizationScore}</span>
                          ) : null}
                          <span
                            className={hasPropagationEvidence ? "heat-score public" : "heat-score unknown"}
                            title={heatTitle}
                          >{hasPropagationEvidence ? <Flame size={12} /> : <Info size={12} />}{hasPropagationEvidence ? propagationLabel : "传播暂无数据"}</span>
                        </div>
                      </td>
                      <td>
                        <span className="source-name">{candidate.sourceName}</span>
                        <span className="source-evidence">{candidate.evidence}{candidate.relatedSources.length > 1 ? ` · ${candidate.relatedSources.length} 家跟进` : ""}</span>
                      </td>
                      <td>
                        <div className="candidate-title">
                          <strong>{candidateDisplayTitle(candidate)}</strong>
                          <span>{candidateDisplaySummary(candidate)}</span>
                          <small lang={containsChinese(candidate.title) ? "zh-CN" : "en"}>原题 · {candidate.title}</small>
                        </div>
                      </td>
                      <td><time dateTime={candidate.publishedAt}>{formatTime(candidate.publishedAt)}</time></td>
                      <td>
                        <span className="image-count"><ImageIcon size={15} />{candidate.imageCount === null ? "选中后读取" : `${candidate.imageCount} 张`}</span>
                      </td>
                      <td>
                        <div className="candidate-feedback-actions">
                          {candidate.userFeedback ? (
                            <>
                              <span className={`candidate-feedback-state ${candidate.userFeedback}`}>
                                {candidate.userFeedback === "interested"
                                  ? "感兴趣"
                                  : candidate.userFeedback === "not_interested" ? "不感兴趣" : "已发布"}
                              </span>
                              <button
                                type="button"
                                disabled={feedbackBusy === candidate.id}
                                onClick={() => void updateFeedback(
                                  candidate.id,
                                  () => onRestoreFeedback(candidate.id),
                                )}
                              ><RotateCcw size={12} />恢复</button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                aria-label={`感兴趣：${candidate.title}`}
                                title="感兴趣"
                                disabled={feedbackBusy === candidate.id}
                                onClick={() => void updateFeedback(
                                  candidate.id,
                                  () => onFeedback(candidate.id, "interested"),
                                )}
                              ><ThumbsUp size={13} /></button>
                              <button
                                type="button"
                                aria-label={`不感兴趣：${candidate.title}`}
                                title="不感兴趣"
                                disabled={feedbackBusy === candidate.id}
                                onClick={() => void updateFeedback(
                                  candidate.id,
                                  () => onFeedback(candidate.id, "not_interested"),
                                )}
                              ><ThumbsDown size={13} /></button>
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        <div className="candidate-source-actions">
                          {candidateSupportsCommunityDraft(candidate) ? (
                            <button type="button" className="community-draft-button compact" onClick={() => setCommunityDraftCandidate(candidate)}>
                              <Languages size={14} />社区入稿
                            </button>
                          ) : null}
                          <a className="view-source-button" href={candidate.canonicalUrl ?? candidate.url} target="_blank" rel="noreferrer" aria-label={`查看原文：${candidate.title}`}>
                            <BookOpenText size={15} />
                            查看原文
                          </a>
                        </div>
                      </td>
                    </tr>
                    );
                  }) : (
                    <tr className="empty-row compact">
                      <td colSpan={8}>
                        <Check size={24} />
                        <strong>{candidateHome.featured ? "优先候选已集中在上方推荐区" : "当前没有仍在有效期内的候选"}</strong>
                        <span>{candidateHome.featured ? "继续采集后，更多候选会显示在这里。" : "超过 48 小时的未处理候选已自动退出首页，运行记录仍然保留。"}</span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {runRailOpen ? (
        <aside className="run-rail">
          <div className="run-rail-heading"><h2>本次运行</h2><button aria-label="收起本次运行" title="收起本次运行" onClick={() => setRunRailOpen(false)}><PanelRightClose size={16} /></button></div>
          <div className="run-stage-list">
            <div className={!run ? "run-stage current" : "run-stage complete"}>
              <span className="run-stage-node">{run ? <Check size={14} /> : null}</span>
              <div><strong>{run ? "已启动" : "等待启动"}</strong><span>{run ? formatTime(run.createdAt) : "等待你或定时心跳"}</span></div>
            </div>
            {quickIntakeRun ? ["接收素材", "识别正文与图片", "生成可编辑草稿"].map((stage, index) => {
              const complete = index < quickStagePosition;
              const current = run?.status === "generating" && index === quickStagePosition;
              return (
                <div className={`run-stage ${complete ? "complete" : current ? "current" : "waiting"}`} key={stage}>
                  <span className="run-stage-node">{complete ? <Check size={14} /> : current ? <LoaderCircle className="spin" size={14} /> : null}</span>
                  <div><strong>{stage}</strong><span>{complete ? "已完成" : current ? "进行中" : "等待"}</span></div>
                </div>
              );
            }) : stageNames.map((stage, index) => {
              const state = runStageState(run, stage, index);
              return (
                <div className={`run-stage ${state}`} key={stage}>
                  <span className="run-stage-node">{state === "complete" ? <Check size={14} /> : state === "current" ? <LoaderCircle className="spin" size={14} /> : null}</span>
                  <div><strong>{stageDisplayLabel(stage)}</strong><span>{state === "complete" ? "已完成" : state === "current" ? "进行中" : runHasNoResults && index >= 2 ? "无候选，未执行" : "等待"}</span></div>
                </div>
              );
            })}
          </div>
          {runHasNoResults ? (
            <div className="run-empty-warning" role="status">
              <TriangleAlert size={17} />
              <span><strong>运行完成，但结果为空</strong><small>请检查来源日志，或放宽日期、关键词与频道后重试。</small></span>
            </div>
          ) : null}
          {run?.error ? <div className="run-error">{run.error}</div> : null}
          <section className="selection-summary" aria-labelledby="selection-summary-title">
            <header className="selection-summary-heading">
              <strong id="selection-summary-title">选型总结</strong>
              <span>已加入 {selected.length} 条待写</span>
            </header>
            {selected.length ? (
              <ol className="selection-summary-list">
                {selected.map((candidate) => (
                  <li key={candidate.id}>
                    <div>
                      <strong>{candidateDisplayTitle(candidate)}</strong>
                      <span>{candidate.sourceName} · {candidate.evidence}</span>
                      <small>
                        {candidate.imageCount === null
                          ? "来源图待读取"
                          : candidate.imageCount > 0
                            ? `${candidate.imageCount} 张来源图`
                            : "缺少来源图"}
                        {candidate.relatedSources.length > 1 ? ` · ${candidate.relatedSources.length} 家来源跟进` : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      aria-label={`从待写移除：${candidateDisplayTitle(candidate)}`}
                      title="从待写移除"
                      onClick={() => onSelect(candidate.id, false)}
                    >
                      <X size={13} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="selection-summary-empty">还没有待写候选。可从左侧优先候选或表格中加入。</p>
            )}
          </section>
          <div className="run-rail-actions">
            <button
              className="primary-button full"
              onClick={onGenerate}
              disabled={!run || !["ready", "complete"].includes(run.status) || !selected.length || busy}
            >
              {busy || run?.status === "generating" ? <LoaderCircle className="spin" size={17} /> : null}
              {run?.status === "generating" ? `正在生成 ${selected.length} 篇草稿` : `生成 ${selected.length} 篇草稿`}
            </button>
          </div>
        </aside>
        ) : (
          <aside className="run-rail-mini" aria-label="本次运行已收起">
            <button aria-label="展开本次运行" title="展开本次运行" onClick={() => setRunRailOpen(true)}><PanelRightOpen size={17} /><span>运行</span></button>
            {runIsActive ? <LoaderCircle className="spin" size={15} /> : run ? <Check size={15} /> : null}
          </aside>
        )}
      </div>

      <footer className="run-provenance">
        <div><span>运行 ID</span><strong>{run?.id ?? "尚未创建"}</strong></div>
        <div><span>搜索范围</span><strong>{run?.dateFrom && run.dateTo ? `${run.dateFrom} 至 ${run.dateTo}` : `定时任务 · 过去 ${run?.windowHours ?? settings.windowHours} 小时`}</strong></div>
        <div><span>关键词</span><strong>{run?.keywords || "未限定"}</strong></div>
        <div><span>来源追溯</span><strong>已开启（保留原始链接与 Horizon Run ID）</strong></div>
        <div><span>频道快照</span><strong>{collectionTopics.filter((topic) => (run?.topicIds ?? settings.collectionTopics).includes(topic.id)).map((topic) => topic.label).join("／")}</strong></div>
      </footer>
      {quickDraftOpen ? (
        <QuickDraftModal
          provider={activeProvider}
          onClose={() => setQuickDraftOpen(false)}
          onOpenAiSettings={() => { setQuickDraftOpen(false); onOpenAiSettings(); }}
          onSubmitUrl={onQuickDraftUrl}
          onSubmitScreenshot={onQuickDraftScreenshot}
          onConfirmReview={onConfirmQuickDraftReview}
        />
      ) : null}
      {communityDraftCandidate ? (
        <CommunityDraftModal
          candidate={communityDraftCandidate}
          provider={activeProvider}
          onClose={() => setCommunityDraftCandidate(undefined)}
          onCreate={onCommunityDraft}
        />
      ) : null}
    </div>
  );
}
