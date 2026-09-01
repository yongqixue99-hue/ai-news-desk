import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Clock3,
  Flame,
  Image as ImageIcon,
  Languages,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingUp,
} from "lucide-react";
import {
  candidateMatchesTopic,
  composeCommunityFeed,
  type CommunityFeedEntry,
} from "../../server/community-feed.js";
import { collectionTopics } from "../../server/topics.js";
import { api, type EditorialIntakeResult } from "../api";
import type {
  Candidate,
  CandidateFeedbackKind,
  CollectionTopicId,
  EditorialIntent,
  Settings,
  SourceConfig,
  WorkflowRun,
} from "../types";
import { EditorialReadingPane } from "./EditorialReadingPane";

type CommunitySortMode = "recommended" | "hot" | "latest";

interface CommunityWorkspaceProps {
  runs: WorkflowRun[];
  sources: SourceConfig[];
  settings: Settings;
  onFeedback: (
    runId: string,
    candidateId: string,
    kind: Extract<CandidateFeedbackKind, "interested" | "not_interested">,
  ) => Promise<void>;
  onRestoreFeedback: (runId: string, candidateId: string) => Promise<void>;
  onCreateDraft: (runId: string, candidateId: string, intent: EditorialIntent) => Promise<void>;
  onAutoBrief: (requests: Array<{ runId: string; candidateIds: string[] }>) => Promise<void>;
}

const containsChinese = (value: string) => /[\u3400-\u9fff]/u.test(value);
const displayTitle = (candidate: Candidate) => candidate.briefing?.titleZh
  ?? (containsChinese(candidate.title) ? candidate.title : "正在生成中文标题…");
const displaySummary = (candidate: Candidate) => candidate.briefing?.summaryZh
  ?? (containsChinese(candidate.excerpt)
    ? candidate.excerpt
    : "正在读取来源并生成中文速览，不需要先打开英文原文。");
const entryKey = (entry: CommunityFeedEntry) => `${entry.runId}:${entry.candidate.id}`;

const formatRelativeTime = (iso: string) => {
  const deltaHours = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  if (!Number.isFinite(deltaHours)) return "时间未知";
  if (deltaHours < 1) return `${Math.max(1, Math.round(deltaHours * 60))} 分钟前`;
  if (deltaHours < 24) return `${Math.round(deltaHours)} 小时前`;
  return `${Math.round(deltaHours / 24)} 天前`;
};

const sortEntries = (items: CommunityFeedEntry[], mode: CommunitySortMode) => [...items].sort((left, right) => {
  if (mode === "hot") {
    const leftHeat = (left.candidate.engagement?.comments ?? 0) * 2 + (left.candidate.engagement?.points ?? 0);
    const rightHeat = (right.candidate.engagement?.comments ?? 0) * 2 + (right.candidate.engagement?.points ?? 0);
    return rightHeat - leftHeat || right.trendScore - left.trendScore;
  }
  if (mode === "latest") return Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt);
  return right.trendScore - left.trendScore;
});

const terminalStatuses = new Set(["complete", "failed", "cancelled"]);

export function CommunityWorkspace({
  runs,
  sources,
  settings,
  onFeedback,
  onRestoreFeedback,
  onCreateDraft,
  onAutoBrief,
}: CommunityWorkspaceProps) {
  const [topic, setTopic] = useState<"all" | CollectionTopicId>("all");
  const [sortMode, setSortMode] = useState<CommunitySortMode>("recommended");
  const [visibleCount, setVisibleCount] = useState(24);
  const [selectedEntry, setSelectedEntry] = useState<CommunityFeedEntry>();
  const [detail, setDetail] = useState<EditorialIntakeResult>();
  const [readingLoading, setReadingLoading] = useState(false);
  const [readingError, setReadingError] = useState<string>();
  const [draftBusy, setDraftBusy] = useState(false);
  const [feedbackBusy, setFeedbackBusy] = useState<string>();
  const [briefingState, setBriefingState] = useState<"idle" | "loading" | "complete" | "error">("idle");
  const attemptedBriefings = useRef(new Set<string>());
  const readingRequest = useRef(0);
  const readerAnchor = useRef<HTMLDivElement>(null);

  const feed = useMemo(() => composeCommunityFeed(runs, {
    expiryHours: 7 * 24,
    limit: 120,
    personalizationEnabled: settings.personalizationEnabled,
  }), [runs, settings.personalizationEnabled]);
  const availableTopics = useMemo(() => collectionTopics.flatMap((item) => {
    const count = feed.items.filter((entry) => candidateMatchesTopic(entry.candidate, item.id)).length;
    return count ? [{ ...item, count }] : [];
  }), [feed.items]);
  const filteredItems = useMemo(() => sortEntries(
    feed.items.filter((entry) => candidateMatchesTopic(entry.candidate, topic)),
    sortMode,
  ), [feed.items, sortMode, topic]);
  const visibleItems = filteredItems.slice(0, visibleCount);
  const risingCount = feed.items.filter((entry) => entry.trend?.direction === "rising").length;
  const imageReadyCount = feed.items.filter((entry) => entry.candidate.images.some((image) => Boolean(image.publicPath))).length;
  const communitySources = useMemo(() => sources.filter((source) => source.role === "community"), [sources]);

  const pendingBriefingRequests = useMemo(() => {
    const byRun = new Map<string, string[]>();
    for (const entry of filteredItems.slice(0, 20)) {
      if (entry.candidate.briefing) continue;
      const ids = byRun.get(entry.runId) ?? [];
      ids.push(entry.candidate.id);
      byRun.set(entry.runId, ids);
    }
    return [...byRun].map(([runId, candidateIds]) => ({ runId, candidateIds }));
  }, [filteredItems]);
  const pendingSignature = pendingBriefingRequests
    .map((request) => `${request.runId}:${[...request.candidateIds].sort().join(",")}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (topic !== "all" && !availableTopics.some((item) => item.id === topic)) setTopic("all");
  }, [availableTopics, topic]);

  useEffect(() => {
    if (!pendingSignature || attemptedBriefings.current.has(pendingSignature)) return;
    attemptedBriefings.current.add(pendingSignature);
    setBriefingState("loading");
    void onAutoBrief(pendingBriefingRequests)
      .then(() => setBriefingState("complete"))
      .catch(() => setBriefingState("error"));
  }, [onAutoBrief, pendingBriefingRequests, pendingSignature]);

  useEffect(() => {
    if (!filteredItems.length) {
      setSelectedEntry(undefined);
      setDetail(undefined);
      return;
    }
    if (!selectedEntry || !filteredItems.some((entry) => entryKey(entry) === entryKey(selectedEntry))) {
      setSelectedEntry(filteredItems[0]);
    }
  }, [filteredItems, selectedEntry]);

  const loadReadingCard = useCallback(async (entry: CommunityFeedEntry, force = false) => {
    const requestId = readingRequest.current + 1;
    readingRequest.current = requestId;
    setReadingLoading(true);
    setReadingError(undefined);
    try {
      let next = await api.editorialIntake(entry.runId, entry.candidate.id);
      if (readingRequest.current !== requestId) return;
      setDetail(next);
      if (next.story.explanation.status !== "ready" || force) {
        const queued = await api.explainStory(next.story.id, force);
        let job = queued.job;
        for (let attempt = 0; job && attempt < 100 && !terminalStatuses.has(job.status); attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_200));
          job = await api.productJob(job.id);
        }
        if (job && job.status !== "complete") throw new Error(job.error || "原始来源暂时没有读取完成");
        next = await api.editorialIntake(entry.runId, entry.candidate.id);
        if (readingRequest.current !== requestId) return;
        setDetail(next);
      }
    } catch (error) {
      if (readingRequest.current === requestId) setReadingError(error instanceof Error ? error.message : String(error));
    } finally {
      if (readingRequest.current === requestId) setReadingLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedEntry) return;
    setDetail(undefined);
    void loadReadingCard(selectedEntry);
  }, [loadReadingCard, selectedEntry]);

  const updateFeedback = async (entry: CommunityFeedEntry, kind: "interested" | "not_interested" | "restore") => {
    setFeedbackBusy(entry.candidate.id);
    try {
      if (kind === "restore") await onRestoreFeedback(entry.runId, entry.candidate.id);
      else await onFeedback(entry.runId, entry.candidate.id, kind);
    } finally {
      setFeedbackBusy(undefined);
    }
  };

  const createDraft = async (intent: EditorialIntent) => {
    if (!selectedEntry) return;
    setDraftBusy(true);
    try {
      await onCreateDraft(selectedEntry.runId, selectedEntry.candidate.id, intent);
    } finally {
      setDraftBusy(false);
    }
  };

  const selectSignal = (entry: CommunityFeedEntry) => {
    setSelectedEntry(entry);
    if (window.matchMedia("(max-width: 820px)").matches) {
      window.setTimeout(() => readerAnchor.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 40);
    }
  };

  return (
    <div className="page community-square-page community-workspace-page">
      <header className="community-square-header">
        <div>
          <span className="community-page-kicker"><MessagesSquare size={15} />COMMUNITY SIGNALS</span>
          <h1>社区广场</h1>
          <p>左边选线索，右边直接看原文讲解。社区负责发现，来源决定文章写什么。</p>
        </div>
        <div className="community-update-state" role="status">
          {briefingState === "loading" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
          <span><strong>{briefingState === "loading" ? "正在生成中文速览" : "中文速览已自动准备"}</strong><small>{feed.lastUpdatedAt ? `最近更新 ${formatRelativeTime(feed.lastUpdatedAt)}` : "等待首批社区信号"}</small></span>
        </div>
      </header>

      <section className="community-overview compact" aria-label="社区广场概览">
        <div><strong>{feed.items.length}</strong><span>条有效热点</span></div>
        <div><strong>{risingCount}</strong><span>条正在升温</span></div>
        <div><strong>{imageReadyCount}</strong><span>条原图已缓存</span></div>
        <p><TrendingUp size={16} />{feed.expiredCount} 条过期内容已退出；社区热度不作为事实证明。</p>
      </section>

      <section className="community-source-health compact" aria-label="社区来源状态">
        <span className="community-source-health-label"><Activity size={14} />来源覆盖</span>
        <div>{communitySources.map((source) => {
          const status = !source.enabled ? "disabled" : source.health || "unknown";
          return <span key={source.id} className={`community-source-state ${status}`} title={source.lastHealthDetail || source.note}><i />{source.name}</span>;
        })}</div>
      </section>

      <div className="community-filter-bar">
        <div className="community-topic-tabs" aria-label="社区话题">
          <button type="button" className={topic === "all" ? "active" : ""} onClick={() => setTopic("all")}>全部</button>
          {availableTopics.map((item) => <button type="button" key={item.id} className={topic === item.id ? "active" : ""} onClick={() => setTopic(item.id)}>{item.label}<small>{item.count}</small></button>)}
        </div>
        <div className="community-sort-tabs" aria-label="社区排序">
          <button type="button" className={sortMode === "recommended" ? "active" : ""} onClick={() => setSortMode("recommended")}><Sparkles size={13} />推荐</button>
          <button type="button" className={sortMode === "hot" ? "active" : ""} onClick={() => setSortMode("hot")}><Flame size={13} />最热</button>
          <button type="button" className={sortMode === "latest" ? "active" : ""} onClick={() => setSortMode("latest")}><Clock3 size={13} />最新</button>
        </div>
      </div>

      {briefingState === "error" ? <div className="community-inline-warning">部分中文速览暂未生成；点击候选后仍会读取原始来源。</div> : null}

      <div className="community-editorial-workspace">
        <section className="community-signal-list" aria-label="社区候选">
          <header><div><span>候选</span><strong>{filteredItems.length} 条</strong></div><small>选择后在右侧判断，不跳转原站</small></header>
          {visibleItems.length ? visibleItems.map((entry, index) => {
            const selected = selectedEntry && entryKey(selectedEntry) === entryKey(entry);
            const image = entry.candidate.images.find((candidateImage) => candidateImage.publicPath) ?? entry.candidate.images[0];
            return (
              <article key={entryKey(entry)} className={selected ? "selected" : ""}>
                <button type="button" className="community-signal-main" aria-pressed={Boolean(selected)} onClick={() => selectSignal(entry)}>
                  <span className="community-signal-rank">{String(index + 1).padStart(2, "0")}</span>
                  {image ? <img src={image.publicPath || image.url} alt="" loading="lazy" /> : <span className="community-signal-image"><MessagesSquare size={18} /></span>}
                  <span className="community-signal-copy">
                    <span className="community-card-meta"><em>{entry.platform}</em><i>{formatRelativeTime(entry.candidate.publishedAt)}</i>{entry.candidate.briefing ? <i className="translated"><Languages size={10} />中文</i> : null}</span>
                    <strong>{displayTitle(entry.candidate)}</strong>
                    <small>{displaySummary(entry.candidate)}</small>
                    <span className="community-signal-metrics"><i><Flame size={11} />{entry.candidate.engagement?.points ?? "—"}</i><i><MessageCircle size={11} />{entry.candidate.engagement?.comments ?? "—"}</i><i><ImageIcon size={11} />{entry.candidate.imageCount ?? entry.candidate.images.length}</i></span>
                  </span>
                </button>
                <span className="community-signal-feedback">
                  <button type="button" disabled={feedbackBusy === entry.candidate.id} className={entry.candidate.userFeedback === "interested" ? "active" : ""} aria-label="感兴趣" onClick={() => void updateFeedback(entry, entry.candidate.userFeedback === "interested" ? "restore" : "interested")}>{feedbackBusy === entry.candidate.id ? <LoaderCircle className="spin" size={12} /> : <ThumbsUp size={12} />}</button>
                  <button type="button" disabled={feedbackBusy === entry.candidate.id} aria-label="不感兴趣" onClick={() => void updateFeedback(entry, "not_interested")}><ThumbsDown size={12} /></button>
                </span>
              </article>
            );
          }) : <div className="community-list-empty"><MessagesSquare size={25} /><strong>当前分类没有有效热点</strong><span>过期和已忽略内容不会继续占据列表。</span></div>}
          {visibleCount < filteredItems.length ? <button type="button" className="community-load-more" onClick={() => setVisibleCount((count) => count + 16)}>再看 {Math.min(16, filteredItems.length - visibleCount)} 条</button> : null}
        </section>

        <div className="community-reader-slot" ref={readerAnchor}>
          <EditorialReadingPane
            detail={detail}
            loading={readingLoading}
            error={readingError}
            draftBusy={draftBusy}
            onRetry={selectedEntry ? () => void loadReadingCard(selectedEntry, true) : undefined}
            onGenerate={(intent) => void createDraft(intent)}
          />
        </div>
      </div>
    </div>
  );
}
