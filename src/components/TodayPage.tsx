import { packageUncertaintiesFor } from "../../server/package-reading-status.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  ExternalLink,
  Eye,
  FileStack,
  Image as ImageIcon,
  Images,
  MessageSquareText,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { api, type DraftOverview, type ProductJob, type StoryDetailResult } from "../api";
import { PageLoading } from "./PageLoading";
import { TodayWorkspaceRail } from "./TodayWorkspaceRail";
import { TopicCategoryPanel, TopicCategoryTabs } from "./TopicCategoryPanel";
import { HomeLayoutDialog } from "./HomeLayoutDialog";
import { defaultHomeLayout, type HomeLayout } from "../../server/home-layout.js";
import { StoryAssetGallery } from "./StoryAssetGallery";
import { KnowledgeShelf } from "./KnowledgeShelf";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { beginStarterDraft, starterDraftActionCopy } from "../starter-draft";
import type {
  AppPage,
  AssignmentMode,
  ContentPackage,
  EvidenceStrength,
  StorySignalView,
  StoryView,
  TodayView,
} from "../types";

const modeLabels: Record<AssignmentMode, string> = {
  brief: "快讯",
  synthesis: "多源综合",
  community: "社区观察",
  playbook: "方案教程",
  curate: "导读",
  watch: "继续观察",
  skip: "退出候选",
};

const evidenceLabels: Record<EvidenceStrength, string> = {
  strong: "强证据",
  moderate: "可用证据",
  weak: "证据不足",
};

const explanationBasisLabels = {
  "full-source": "已读来源正文",
  excerpt: "依据来源摘要",
  title: "目前仅有标题",
} as const;

const editorialAssetLabels = {
  1: "原新闻图片",
  2: "原文截图",
  3: "人物／公司资料图",
  4: "事件相关素材",
  5: "AI 生成兜底",
} as const;

const relativeTime = (value: string) => {
  const deltaMinutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (deltaMinutes < 60) return `${deltaMinutes || 1} 分钟前`;
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
};

const releaseStatusLabels = {
  released: "已发布",
  preview: "官方预告",
  reported: "待核实发布状态",
} as const;

const dossierFacetStatusLabels = {
  ready: "已齐",
  partial: "待完善",
  missing: "缺失",
} as const;

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

const uniqueSourceSignals = (signals: StorySignalView[]) => {
  const seen = new Set<string>();
  return signals.filter((signal) => {
    const rawUrl = signal.discussionUrl || signal.url;
    let key = `${signal.sourceName}:${rawUrl}`;
    try {
      const url = new URL(rawUrl);
      key = `${url.hostname}${url.pathname.replace(/\/$/u, "")}`;
    } catch {
      // Keep the stable source-and-URL fallback for malformed legacy records.
    }
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const PackageStatus = ({ contentPackage }: { contentPackage: ContentPackage }) => (
  <div className={`today-package-status ${contentPackage.status}`}>
    {contentPackage.status === "ready" ? <Check size={16} /> : <AlertTriangle size={16} />}
    <span>{contentPackage.status === "ready" ? "素材包已具备成稿条件" : "素材包仍有阻断项"}</span>
  </div>
);

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

const ReleaseDossierStrip = ({ story, compact = false }: { story: StoryView; compact?: boolean }) => {
  const dossier = story.releaseDossier;
  if (!dossier) return null;
  return (
    <div className={`release-dossier-strip${compact ? " compact" : ""}`}>
      <div className="release-dossier-summary">
        <span>{releaseStatusLabels[dossier.releaseStatus]}</span>
        <strong>专题资料 {dossier.readyCount}/{dossier.totalCount}</strong>
      </div>
      <div className="release-dossier-facets" aria-label="模型发布资料完整度">
        {dossier.facets.map((facet) => (
          <span key={facet.id} className={`dossier-facet ${facet.status}`}>{facet.label}</span>
        ))}
      </div>
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

const StoryRow = ({ story, rank, featured = false, busy = false, processing = false, onOpen, onQueue, onQuickDraft }: StoryRowProps) => (
  <article className={featured ? "today-story featured" : "today-story compact"}>
    {rank ? <span className="today-story-rank">0{rank}</span> : null}
    <button type="button" className="today-story-open" onClick={() => onOpen(story)} aria-label={`查看 ${story.title}`}>
      <StoryImage story={story} eager={featured && rank === 1} />
      <div className="today-story-copy">
        <div className="today-story-kicker">
          <span className="today-source-name">{story.signals.find((signal) => !signal.isCommunity)?.sourceName || story.signals[0]?.sourceName || "来源待核对"}</span>
          <span className={`assignment-pill mode-${story.assignment.mode}`}>{modeLabels[story.assignment.mode]}</span>
          <span className={`evidence-pill evidence-${story.evidenceStrength}`}>{story.explanation.basis === "full-source" ? evidenceLabels[story.evidenceStrength] : "原文待读取"}</span>
          <span>{relativeTime(story.publishedAt)}</span>
        </div>
        <h3>{story.title}</h3>
        <p className="today-story-summary">{story.summary}</p>
        {story.opportunity ? <span className="today-opportunity"><strong>{story.opportunity.label}</strong>{story.opportunity.reason}</span> : null}
        {story.preferenceReasons?.length ? <span className="today-opportunity">推荐偏好：{story.preferenceReasons.join("；")}</span> : null}
        <ReleaseDossierStrip story={story} compact={!featured} />
        {featured ? (
          <div className="today-story-reasons">
            <p><strong>编辑备注</strong>{story.explanation.editorNote || story.assignment.reason}</p>
            {story.communitySummary ? <p><strong>社区线索</strong>{story.communitySummary}</p> : null}
          </div>
        ) : null}
        <div className="today-story-meta">
          <span><FileStack size={14} />{story.sourceCount} 个来源</span>
          {story.communitySampleCount ? <span><MessageSquareText size={14} />{story.communitySampleCount} 条样本</span> : null}
          {story.trend.direction !== "unknown" ? <span className={`trend-${story.trend.direction}`}><TrendingUp size={14} />{story.trend.summary}</span> : null}
        </div>
      </div>
      <ChevronRight className="today-story-chevron" size={20} aria-hidden="true" />
    </button>
    <div className="today-story-actions" aria-label={`${story.title} 的快捷操作`}>
      <button type="button" className="text-button" onClick={() => onOpen(story)}>查看证据</button>
      <button type="button" className="secondary-button" aria-pressed={story.selected} disabled={busy || story.drafted} onClick={() => onQueue(story, !story.selected)}>
        {story.selected ? <><Check size={14} />已加入待写</> : "加入待写"}
      </button>
      <button type="button" className="primary-button" disabled={busy || processing || !story.assignment.canDraft || story.drafted} onClick={() => onQuickDraft(story)}>
        {story.drafted ? "已有草稿" : <><Pencil size={14} />生成基础稿<ArrowRight size={14} /></>}
      </button>
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

interface StoryDrawerProps {
  detail: StoryDetailResult;
  busy: boolean;
  activeJob?: ProductJob;
  explanationLoading: boolean;
  explanationError?: string;
  onClose: () => void;
  onRetryExplanation: () => void;
  onSupplementEvidence: () => void;
  onCollectAssets: () => void;
  onSkip: () => void;
  onQueue: (selected: boolean) => void;
  onRestoreFeedback: () => void;
  onBuildPackage: (mode: Exclude<AssignmentMode, "watch" | "skip">) => void;
  onStartWriting: (contentPackage: ContentPackage) => void;
  onGenerateDraft: (contentPackage: ContentPackage) => void;
  onQuickWrite: (mode: Exclude<AssignmentMode, "watch" | "skip">) => void;
}

const StoryDrawer = ({
  detail,
  busy,
  activeJob,
  explanationLoading,
  explanationError,
  onClose,
  onRetryExplanation,
  onSupplementEvidence,
  onCollectAssets,
  onSkip,
  onQueue,
  onRestoreFeedback,
  onBuildPackage,
  onStartWriting,
  onGenerateDraft,
  onQuickWrite,
}: StoryDrawerProps) => {
  const { story } = detail;
  const [readerView, setReaderView] = useState<"summary" | "images">("summary");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLElement>({ open: true, onClose: busy ? undefined : onClose, initialFocusRef: closeButtonRef });
  const [mode, setMode] = useState<Exclude<AssignmentMode, "watch" | "skip">>(
    story.technicalArticle ? "curate" : story.assignment.canDraft ? story.assignment.mode as Exclude<AssignmentMode, "watch" | "skip"> : "brief",
  );
  const contentPackage = detail.contentPackage;
  const packageUncertainties = contentPackage ? packageUncertaintiesFor(contentPackage) : [];
  const processing = Boolean(activeJob && !terminalJobStatuses.has(activeJob.status));
  const factSignals = uniqueSourceSignals(story.signals.filter((signal) => !signal.isCommunity));
  const communitySignals = uniqueSourceSignals(story.signals.filter((signal) => signal.isCommunity));

  return (
    <div className="story-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside ref={dialogRef} className="story-drawer" role="dialog" aria-modal="true" aria-labelledby="story-drawer-title" tabIndex={-1}>
        <header className="story-drawer-header">
          <div>
            <div className="today-story-kicker">
              <span className={`assignment-pill mode-${story.assignment.mode}`}>{modeLabels[story.assignment.mode]}</span>
              <span className={`evidence-pill evidence-${story.evidenceStrength}`}>{contentPackage?.sources.some((source) => source.basis === "full-source" && !source.isCommunity) ? "原文已核对" : story.explanation.basis === "full-source" ? evidenceLabels[story.evidenceStrength] : "原文待读取"}</span>
            </div>
            <h2 id="story-drawer-title">{story.title}</h2>
            {story.originalTitle !== story.title ? <p className="story-original-title">原题：{story.originalTitle}</p> : null}
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭事件详情"><X size={19} /></button>
        </header>

        <nav className="story-reader-tabs" aria-label="事件视图">
          <button type="button" aria-pressed={readerView === "summary"} onClick={() => setReaderView("summary")}><BookOpen size={15} />事件摘要</button>
          <button type="button" aria-pressed={readerView === "images"} onClick={() => setReaderView("images")}><Images size={15} />图片与图表 <span>{story.imageCount}</span></button>
          <small>阅读来源，再形成自己的文章</small>
        </nav>
        <div className="story-drawer-body story-reader-body">
          {readerView === "images" ? <>
            {processing ? <div className="asset-collection-progress" role="status"><RefreshCw className="spin" size={15} /><span>{activeJob?.stage || "正在准备素材"}</span><progress value={activeJob?.progress ?? 0} max={1} /></div> : null}
            <StoryAssetGallery images={story.images} localCount={story.localImageCount ?? 0} publishReadyCount={story.publishReadyImageCount ?? 0} reports={detail.assetCollection?.sourceReports} busy={busy || processing} onCollect={onCollectAssets} />
          </> : <div className="story-reader-layout">
            <aside className="story-reader-sidebar" aria-label="事件来源与判断">
              <section className="story-decision-band story-decision-stack">
                <div><span>建议</span><strong>{story.assignment.reason}</strong></div>
                <div><span>热度</span><strong>{story.trend.summary}</strong></div>
              </section>

              {story.assignment.blockers.length ? (
                <div className="story-blockers"><AlertTriangle size={18} /><div><strong>当前不能成稿</strong>{story.assignment.blockers.map((item) => <p key={item}>{item}</p>)}</div></div>
              ) : null}

              {story.releaseDossier ? (
                <section className="story-release-dossier" aria-label="模型发布专题资料">
                  <div className="story-release-dossier-heading">
                    <div><span>{releaseStatusLabels[story.releaseDossier.releaseStatus]}</span><strong>模型发布资料</strong></div>
                    <em>{story.releaseDossier.readyCount}/{story.releaseDossier.totalCount}</em>
                  </div>
                  <ul>
                    {story.releaseDossier.facets.map((facet) => (
                      <li key={facet.id} className={facet.status}>
                        <div><strong>{facet.label}</strong><span>{facet.detail}</span></div>
                        <em>{dossierFacetStatusLabels[facet.status]}</em>
                      </li>
                    ))}
                  </ul>
                  <p>{story.releaseDossier.nextAction}</p>
                </section>
              ) : null}

              <section className="story-detail-section story-source-section">
                <div className="story-detail-heading">
                  <h3>文章来源</h3><span>{story.sourceCount} 个</span>
                  {story.evidenceStrength !== "strong" || Boolean(story.releaseDossier && story.releaseDossier.readyCount < story.releaseDossier.totalCount) ? (
                    <button type="button" className="text-button" disabled={busy || processing} onClick={onSupplementEvidence}>
                      {activeJob?.type === "supplement-story-evidence" && !terminalJobStatuses.has(activeJob.status)
                        ? <><RefreshCw className="spin" size={13} />{activeJob.stage || "正在寻找来源与专题资料"}</>
                        : <><ShieldCheck size={13} />{story.releaseDossier ? "自动补齐资料" : "自动补强证据"}</>}
                    </button>
                  ) : <span className="evidence-ready-copy"><Check size={13} />已达到强证据</span>}
                </div>
                <div className="story-source-groups">
                  <div>
                    <h4>事实来源</h4>
                    {factSignals.length ? factSignals.slice(0, 8).map((signal) => (
                      <a key={`${signal.runId}:${signal.candidateId}`} href={signal.url} target="_blank" rel="noreferrer" className="story-source-row">
                        <span>{signal.sourceName}</span>
                        <strong>{signal.titleZh || signal.title}</strong>
                        <small>{signal.publicationDateKnown === false ? "日期待读取核对" : relativeTime(signal.publishedAt)} · {{ official: "官方来源", research: "研究资料", verification: "媒体核验", discovery: "发现线索", community: "社区讨论" }[signal.sourceRole || "discovery"]}</small>
                        <ExternalLink size={14} />
                      </a>
                    )) : <p className="story-empty-copy">尚无可建立事实主干的来源。</p>}
                  </div>
                  <div>
                    <h4>社区讨论</h4>
                    {communitySignals.length ? communitySignals.slice(0, 6).map((signal) => (
                      <a key={`${signal.runId}:${signal.candidateId}`} href={signal.discussionUrl || signal.url} target="_blank" rel="noreferrer" className="story-source-row">
                        <span>{signal.sourceName}</span>
                        <strong>{signal.summaryZh || signal.titleZh || signal.title}</strong>
                        <small>{signal.engagement?.points ?? 0} 积分 · {signal.engagement?.comments ?? 0} 评论</small>
                        <ExternalLink size={14} />
                      </a>
                    )) : <p className="story-empty-copy">当前没有关联社区讨论。</p>}
                  </div>
                </div>
              </section>

              <button className="story-material-shortcut" type="button" onClick={() => setReaderView("images")}><Images size={21} /><span><strong>查看原文图片与图表</strong><small>{story.imageCount} 张已发现 · {story.localImageCount ?? 0} 张已保存</small></span><ArrowRight size={17} /></button>
            </aside>

            <article className="story-reader-content">
              <section className="story-explanation-section">
                <div className="story-explanation-heading">
                  <div><span>中文摘要</span><h3>这条新闻讲了什么</h3></div>
                  <div className="story-explanation-heading-actions">
                    <span className={`story-explanation-state ${story.explanation.status}`}>
                      {explanationLoading ? <><RefreshCw className="spin" size={13} />正在读取正文</> : explanationBasisLabels[story.explanation.basis]}
                    </span>
                    {!explanationLoading && story.explanation.status === "ready" ? (
                      <button type="button" className="text-button story-rephrase-button" onClick={onRetryExplanation}>
                        <RefreshCw size={12} />换种说法
                      </button>
                    ) : null}
                  </div>
                </div>

                {explanationLoading ? (
                  <div className="story-explanation-progress"><span className="loading-mark" /><p><strong>先显示已有信息</strong><small>正文读完后会自动换成新版中文摘要，不影响继续浏览。</small></p></div>
                ) : null}
                {explanationError ? (
                  <div className="story-explanation-error"><AlertTriangle size={16} /><p><strong>详细正文暂时没读完</strong><span>{explanationError}</span></p><button type="button" onClick={onRetryExplanation}>重试</button></div>
                ) : null}

                <div className="story-explanation-lead">
                  <p>{story.explanation.readerBrief}</p>
                </div>

                {story.explanation.editorNote ? (
                  <div className="story-editor-note">
                    <span>编辑备注</span>
                    <p>{story.explanation.editorNote}</p>
                  </div>
                ) : null}

                {story.explanation.keyPoints.length > 1 ? (
                  <div className="story-explanation-points">
                    <h4>具体信息</h4>
                    <ul>{story.explanation.keyPoints.slice(0, 4).map((point) => <li key={point}>{point}</li>)}</ul>
                  </div>
                ) : null}

                {story.communitySummary || story.communityFocus.length ? (
                  <div className="story-community-explanation">
                    <span><MessageSquareText size={15} />社区里在讨论什么</span>
                    {story.communitySummary ? <p>{story.communitySummary}</p> : null}
                    {story.communityFocus.length ? <ul>{story.communityFocus.map((focus) => <li key={focus}>{focus}</li>)}</ul> : null}
                    {story.disagreement ? <small>主要分歧：{story.disagreement}</small> : null}
                  </div>
                ) : null}

                {story.explanation.unknowns.length ? (
                  <div className="story-unknowns">
                    <span>还缺的信息</span>
                    <ul>{story.explanation.unknowns.slice(0, 2).map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                ) : null}
              </section>

              {contentPackage ? (
                <section className="story-detail-section package-section">
              <div className="story-detail-heading">
                <h3>成稿素材包</h3>
                <span>{modeLabels[contentPackage.mode]}</span>
                <button type="button" className="text-button" disabled={busy || processing} onClick={() => onBuildPackage(contentPackage.mode)}>
                  {busy ? <><RefreshCw className="spin" size={13} />正在更新</> : <><RefreshCw size={13} />重新整理素材</>}
                </button>
              </div>
              <PackageStatus contentPackage={contentPackage} />
              {activeJob?.type === "build-content-package" && !terminalJobStatuses.has(activeJob.status) ? (
                <div className="story-package-job" role="status">
                  <div><RefreshCw className="spin" size={14} /><strong>{activeJob.stage || "正在建立素材包"}</strong><span>{Math.round(activeJob.progress * 100)}%</span></div>
                  <progress value={activeJob.progress} max={1}>{Math.round(activeJob.progress * 100)}%</progress>
                  <small>任务在后台运行；当前步骤会持续更新。</small>
                </div>
              ) : null}
              {contentPackage.status === "ready" ? (
                <div className="package-draft-action">
                  <div><strong>素材边界已经冻结</strong><span>系统先按证据生成一版基础稿；你可以直接在编辑器里重写、删改，让它更像你。</span></div>
                  <div className="package-draft-buttons">
                    <button type="button" className="primary-button" disabled={busy || processing} onClick={() => onGenerateDraft(contentPackage)}>
                      {busy ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}{starterDraftActionCopy.primary}
                    </button>
                    <button type="button" className="secondary-button" disabled={busy || processing} onClick={() => onStartWriting(contentPackage)}>
                      <Pencil size={16} />{starterDraftActionCopy.blank}
                    </button>
                  </div>
                </div>
              ) : null}
              {contentPackage.blockers.length ? (
                <ul className="package-blocker-list">{contentPackage.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
              ) : null}
              <div className="package-fact-list">
                {contentPackage.facts.map((fact) => (
                  <article key={fact.id}>
                    <span className={`claim-status ${fact.status}`}>{fact.status === "supported" ? "已支持" : fact.status === "partially-supported" ? "单源支持" : fact.status === "conflicted" ? "有冲突" : "待核验"}</span>
                    <p>{fact.text}</p>
                    <small>{fact.note}</small>
                  </article>
                ))}
              </div>
              {contentPackage.discussionSamples.length ? (
                <div className="package-community-samples">
                  <h4>社区原句 <span>{contentPackage.communityEvidenceLabel}</span></h4>
                  {contentPackage.discussionSamples.slice(0, 6).map((sample) => (
                    <blockquote key={sample.id}>
                      <p>{sample.originalText}</p>
                      <footer><a href={sample.permalink} target="_blank" rel="noreferrer">{sample.author} · {sample.platform}</a><span>{sample.kind}</span></footer>
                    </blockquote>
                  ))}
                </div>
              ) : null}
              {contentPackage.assets.length ? (
                <div className="package-assets-strip">
                  {contentPackage.assets.slice(0, 8).map((asset) => (
                    <figure key={asset.id} className={`rights-${asset.rightsDecision}`}>
                      <img src={asset.url} alt={asset.caption || asset.role} loading="lazy" />
                      <figcaption>
                        <strong>优先级 {asset.editorialPriority ?? (asset.origin === "library" ? 4 : 1)} · {editorialAssetLabels[asset.editorialPriority ?? (asset.origin === "library" ? 4 : 1)]}</strong>
                        <span>{asset.localReady ? "本地就绪" : "仅远程"} · {asset.rightsReason}</span>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              ) : null}
                </section>
              ) : (
                <details className="story-package-builder">
              <summary><FileStack size={16} /><span>想先核对依据？检查成稿素材包</span><ChevronRight size={15} /></summary>
              <p>生成基础稿时会自动整理事实和原文图表。也可以先单独检查素材，再决定怎么写。</p>
              {story.assignment.canDraft ? (
                <div className="story-package-actions">
                  <label>稿型<select value={mode} onChange={(event) => setMode(event.target.value as Exclude<AssignmentMode, "watch" | "skip">)}>
                    {["brief", "synthesis", "community", "playbook", "curate"].map((value) => <option key={value} value={value}>{modeLabels[value as AssignmentMode]}</option>)}
                  </select></label>
                  <button type="button" className="secondary-button" disabled={busy || processing} onClick={() => onBuildPackage(mode)}>
                    {busy ? <><RefreshCw className="spin" size={16} />正在整理原文素材</> : <><FileStack size={16} />先整理素材包</>}
                  </button>
                </div>
              ) : null}
              {activeJob?.type === "build-content-package" && !terminalJobStatuses.has(activeJob.status) ? (
                <div className="story-package-job" role="status">
                  <div><RefreshCw className="spin" size={14} /><strong>{activeJob.stage || "正在建立素材包"}</strong><span>{Math.round(activeJob.progress * 100)}%</span></div>
                  <progress value={activeJob.progress} max={1}>{Math.round(activeJob.progress * 100)}%</progress>
                </div>
              ) : null}
                </details>
              )}
            </article>
          </div>}
        </div>

        <footer className="story-drawer-footer">
          <p className="story-footer-note">原文图表随素材整理 · 生成后可以逐张删改</p>
          {story.ignored ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={onRestoreFeedback}><RotateCcw size={15} />恢复到今日候选</button>
          ) : (
            <>
              <button type="button" className="secondary-button" disabled={busy} onClick={onSkip}>跳过</button>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onQueue(!story.selected)}>
                {story.selected ? <><Check size={15} />移出待写</> : <><FileStack size={15} />加入待写</>}
              </button>
              <button type="button" className="primary-button" disabled={busy || processing || !story.assignment.canDraft} onClick={() => onQuickWrite(mode)}><Sparkles size={15} />{starterDraftActionCopy.primary}</button>
            </>
          )}
        </footer>
      </aside>
    </div>
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
  const [layout, setLayout] = useState<HomeLayout>(defaultHomeLayout);
  const [customizing, setCustomizing] = useState(false);
  const [layoutLoaded, setLayoutLoaded] = useState(false);
  const [keywordNews, setKeywordNews] = useState<StoryView[]>([]);
  const [keywordLoading, setKeywordLoading] = useState(false);
  const [keywordError, setKeywordError] = useState<string>();
  const activeColumn = layout.columns.find((column) => column.id === category) ?? layout.columns[0];
  const applyLayout = (next: HomeLayout) => {
    setLayout(next);
    setCategory((current) => next.columns.some((column) => column.id === current) ? current : next.columns[0].id);
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
      setToday(recommendations.value);
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
      for (let attempt = 0; attempt < 160 && !["complete", "failed", "cancelled"].includes(job.status); attempt += 1) {
        if (explanationRequestRef.current !== requestId) return;
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
        if (explanationRequestRef.current !== requestId) return;
        job = await api.productJob(job.id);
      }
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
    setBusy(true);
    try {
      const next = await api.story(story.id);
      if (explanationRequestRef.current !== requestId) return;
      setDetail(next);
      void api.recordStoryEvent(story.id, "opened").catch(() => undefined);
      if (next.story.explanation.status !== "ready") void hydrateExplanation(story.id, requestId);
    } catch (openError) {
      if (explanationRequestRef.current === requestId) onNotice("error", openError instanceof Error ? openError.message : String(openError));
    } finally {
      if (explanationRequestRef.current === requestId) setBusy(false);
    }
  }, [hydrateExplanation, onNotice]);

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
      onNotice("error", packageError instanceof Error ? packageError.message : String(packageError));
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
        onNotice("error", job.type === "build-content-package" && job.status === "failed"
          ? "文章资料暂未准备好，选题已保留。可在右下角任务中重试或回到选题。"
          : jobError instanceof Error ? jobError.message : String(jobError));
      } finally {
        setActiveStoryJob((current) => current?.id === job.id ? undefined : current);
      }
    })();
  }, [activeStoryJob, loadToday, onNotice]);

  const coverage = today?.coverage;
  const backgroundProcessing = Boolean(activeStoryJob && !terminalJobStatuses.has(activeStoryJob.status));
  const metrics = useMemo(() => [
    { label: "活跃事件", value: coverage?.activeStoryCount ?? 0, icon: BookOpen },
    { label: "正在升温", value: coverage?.risingCount ?? 0, icon: TrendingUp },
    { label: "来源图 2+", value: coverage?.sourceImageReadyCount ?? coverage?.imageReadyCount ?? 0, icon: ImageIcon },
    { label: "发布图 2+", value: coverage?.publishReadyStoryCount ?? 0, icon: Images },
    { label: "强证据", value: coverage?.strongEvidenceCount ?? 0, icon: ShieldCheck },
  ], [coverage]);

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
        <p id="today-search-help">实时读取已启用的官网与新闻来源；X 和社区帖子不参与这次事实搜索。</p>
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

      {today ? <section className="today-metrics" aria-label="今日覆盖概览">
        {metrics.map(({ label, value, icon: Icon }) => <div key={label}><Icon size={17} /><span>{label}</span><strong>{value}</strong></div>)}
      </section> : null}

      {error ? (
        <div className="today-error" role="alert"><AlertTriangle size={18} /><div><strong>今日推荐读取失败</strong><p>{error}</p></div><button type="button" onClick={() => void loadToday()}>重试</button></div>
      ) : null}

      {loading && !today ? <PageLoading label="正在整理今天的选题与草稿…" /> : null}

      <div className="today-editorial-grid">
        <div className="today-reading-column">
          <TopicCategoryTabs value={activeColumn.id} columns={layout.columns} onChange={setCategory} onCustomize={() => void customize()} />
          {activeColumn.source === "news" ? <div role="tabpanel" id={`topic-panel-${activeColumn.id}`} aria-labelledby={`topic-tab-${activeColumn.id}`} tabIndex={0}>
            {activeColumn.keyword ? <section className="today-section home-keyword-news">
              <div className="today-section-heading"><div><span>近 7 天已采集新闻 · 关键词「{activeColumn.keyword}」</span><h2>{activeColumn.label}</h2></div><small>{keywordNews.length} 条</small></div>
              {keywordLoading ? <p role="status" className="story-empty-copy">正在整理栏目…</p> : keywordError ? <p role="alert" className="story-empty-copy">{keywordError}</p> : keywordNews.length ? keywordNews.map((story) => <StoryRow key={story.id} story={story} busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />) : <p className="story-empty-copy">已采集新闻中暂无匹配内容。可用上方搜索补充线索。</p>}
            </section> : <>
            {today ? <>
          {today.releaseHighlights?.length ? <section className="today-release-highlights" aria-label="近期重要发布">
            <div className="release-highlights-heading"><span>RELEASE RADAR</span><h2>近期重要发布</h2><small>过去 7 天 · 官方发布线索</small></div>
            <div className="release-highlights-list">{today.releaseHighlights.map((story) => <button type="button" key={story.id} onClick={() => openStory(story)}>
              <span className="release-status"><i />{story.drafted ? "已进入写作" : story.releaseDossier?.facets.find((facet) => facet.id === "official")?.status === "ready" ? "已定位官方原文" : "原文待核对"}<small>{relativeTime(story.publishedAt)}</small></span>
              <strong>{story.title}</strong><span className="release-open">查看发布资料 <ArrowRight size={14} /></span>
            </button>)}</div>
          </section> : null}
          <section className="today-section today-must-read">
            <div className="today-section-heading">
              <div><span>今日重点 / {String(today.mustReads.length).padStart(2, "0")}</span><h2>今天，先看这几件事</h2></div>
              <span className="desk-section-caption">已合并同一事件的报道</span>
            </div>
            {today.mustReads.length ? (
              <div className="today-featured-list">{today.mustReads.map((story, index) => (
                <StoryRow key={story.id} story={story} rank={index + 1} featured busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />
              ))}</div>
            ) : (
              <div className="today-empty"><Eye size={28} /><div><strong>下一篇好文章，从一条线索开始</strong><p>暂时没有符合推荐条件的事件。搜索你关注的主题，或去工作台读取新闻源。</p></div><button type="button" className="secondary-button" onClick={() => onNavigate("workbench")}>打开新闻工作台 <ArrowRight size={15} /></button></div>
            )}
          </section>

            <section className="today-section">
              <div className="today-section-heading"><div><span>更多线索</span><h2>也值得花一分钟</h2></div><button type="button" className="text-button" onClick={() => onNavigate("workbench")}>全部新闻 <ArrowRight size={14} /></button></div>
              <div className="today-secondary-list">
                {today.secondary.length ? today.secondary.map((story) => (
                  <StoryRow key={story.id} story={story} busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />
                )) : <p className="story-empty-copy">当前没有额外可成稿候选。</p>}
              </div>
            </section>

          {today.interesting?.length ? <section className="today-section today-interesting">
            <div className="today-section-heading"><div><span>不只追热度</span><h2>有趣，也有用</h2></div><small>具体实践与新鲜题材 · 最多 2 条</small></div>
            <div className="today-secondary-list">{today.interesting.map((story) => <StoryRow key={story.id} story={story} busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />)}</div>
          </section> : null}
          {today.backlog.length ? (
            <section className="today-section today-backlog">
              <div className="today-section-heading">
                <div><span>近 7 日补看</span><h2>错过但仍值得写的事件</h2></div>
                <p>不挤占 48 小时内的今日推荐；只补回尚未写过、证据足够的旧事件。</p>
              </div>
              <div className="today-secondary-list">
                {today.backlog.map((story) => (
                  <StoryRow key={story.id} story={story} busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />
                ))}
              </div>
            </section>
          ) : null}


            </> : null}</>}
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

      {customizing ? <HomeLayoutDialog initial={layout} onClose={() => setCustomizing(false)} onSaved={(next) => { applyLayout(next); setCustomizing(false); }} /> : null}
      {detail ? (
        <StoryDrawer
          detail={detail}
          busy={busy}
          activeJob={activeStoryJob && activeStoryJob.payload && typeof activeStoryJob.payload === "object"
            && "storyId" in activeStoryJob.payload
            && String((activeStoryJob.payload as { storyId: unknown }).storyId) === detail.story.id
            ? activeStoryJob
            : undefined}
          explanationLoading={explanationLoading}
          explanationError={explanationError}
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
