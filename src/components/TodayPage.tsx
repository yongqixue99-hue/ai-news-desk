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
import { api, type ProductJob, type StoryDetailResult } from "../api";
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
  const [failed, setFailed] = useState(false);
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
        src={image.publicPath || image.url}
        alt={image.caption || story.title}
        loading={eager ? "eager" : "lazy"}
        onError={() => setFailed(true)}
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
          <span className={`assignment-pill mode-${story.assignment.mode}`}>{modeLabels[story.assignment.mode]}</span>
          <span className={`evidence-pill evidence-${story.evidenceStrength}`}>{evidenceLabels[story.evidenceStrength]}</span>
          <span>{relativeTime(story.publishedAt)}</span>
        </div>
        <h3>{story.title}</h3>
        <p className="today-story-summary">{story.summary}</p>
        <ReleaseDossierStrip story={story} compact={!featured} />
        {featured ? (
          <div className="today-story-reasons">
            <p><strong>编辑备注</strong>{story.explanation.editorNote || story.assignment.reason}</p>
            <p><strong>社区怎么说</strong>{story.communitySummary || "尚未形成可引用的社区样本"}</p>
          </div>
        ) : null}
        <div className="today-story-meta">
          <span><FileStack size={14} />{story.sourceCount} 个来源</span>
          <span><MessageSquareText size={14} />{story.communitySampleCount} 条样本</span>
          <span className={`trend-${story.trend.direction}`}><TrendingUp size={14} />{story.trend.summary}</span>
        </div>
      </div>
      <ChevronRight className="today-story-chevron" size={20} aria-hidden="true" />
    </button>
    <div className="today-story-actions" aria-label={`${story.title} 的快捷操作`}>
      <button type="button" className="text-button" onClick={() => onOpen(story)}>查看证据</button>
      <button type="button" className="secondary-button" disabled={busy || story.drafted} onClick={() => onQueue(story, !story.selected)}>
        {story.selected ? <><Check size={14} />已加入待写</> : "加入待写"}
      </button>
      <button type="button" className="primary-button" disabled={busy || processing || !story.assignment.canDraft || story.drafted} onClick={() => onQuickDraft(story)}>
        {story.drafted ? "已有草稿" : <><Sparkles size={14} />{starterDraftActionCopy.primary}</>}
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
        <div><span>生产闭环</span><h2>哪里正在掉队</h2></div>
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
            ? `距离目标还差 ${data.recommendationShortageCount} 条合格事件，原因见右侧`
            : "推荐数量与质量门槛均已达标"}</span>
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
  onSkip,
  onQueue,
  onRestoreFeedback,
  onBuildPackage,
  onStartWriting,
  onGenerateDraft,
  onQuickWrite,
}: StoryDrawerProps) => {
  const { story } = detail;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useDialogA11y<HTMLElement>({ open: true, onClose: busy ? undefined : onClose, initialFocusRef: closeButtonRef });
  const [mode, setMode] = useState<Exclude<AssignmentMode, "watch" | "skip">>(
    story.assignment.canDraft ? story.assignment.mode as Exclude<AssignmentMode, "watch" | "skip"> : "brief",
  );
  const contentPackage = detail.contentPackage;
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
              <span className={`evidence-pill evidence-${story.evidenceStrength}`}>{evidenceLabels[story.evidenceStrength]}</span>
            </div>
            <h2 id="story-drawer-title">{story.title}</h2>
            {story.originalTitle !== story.title ? <p className="story-original-title">原题：{story.originalTitle}</p> : null}
          </div>
          <button ref={closeButtonRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭事件详情"><X size={19} /></button>
        </header>

        <div className="story-drawer-body story-reader-body">
          <div className="story-reader-layout">
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
                        <small>{relativeTime(signal.publishedAt)} · {signal.sourceRole || "discovery"}</small>
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

              <section className="story-detail-section story-visual-section">
                <div className="story-detail-heading">
                  <h3>图片就绪状态</h3>
                  <span>发现 {story.imageCount} · 本地 {story.localImageCount ?? 0} · 可直接发布 {story.publishReadyImageCount ?? 0}</span>
                </div>
                {story.images.length ? (
                  <div className="story-image-grid">
                    {story.images.slice(0, 6).map((image) => (
                      <figure key={image.id}>
                        <img src={image.publicPath || image.url} alt={image.caption || "来源图片"} loading="lazy" />
                        <figcaption>
                          <strong>
                            优先级 {image.editorialPriority ?? (image.rights === "editorial-screenshot" || image.rights === "commentary-screenshot" ? 2 : 1)} · {editorialAssetLabels[image.editorialPriority ?? (image.rights === "editorial-screenshot" || image.rights === "commentary-screenshot" ? 2 : 1)]}
                          </strong>
                          <span>{image.caption || "来源图片"}</span>
                          <span>{image.attribution || "来源待核对"} · {image.localPath && image.publicPath ? "已缓存" : "仅远程"} · {image.rights}</span>
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                ) : <p className="story-empty-copy">暂未发现原图；建立素材包时会继续尝试原文截图、联网检索可核权的人物／公司身份图、事件相关图，全部失败后才现场生成非纪实封面。</p>}
              </section>
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
                  {busy ? <><RefreshCw className="spin" size={13} />正在按 1→5 补图</> : <><RefreshCw size={13} />重新按 1→5 补图</>}
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
                <section className="story-package-builder">
              <div><span>下一步</span><h3>先建立可审查的素材包</h3><p>事实、社区原句和图片会先冻结为证据边界，写稿模型不能凭记忆补充。</p></div>
              {story.assignment.canDraft ? (
                <div className="story-package-actions">
                  <label>稿型<select value={mode} onChange={(event) => setMode(event.target.value as Exclude<AssignmentMode, "watch" | "skip">)}>
                    {["brief", "synthesis", "community", "playbook", "curate"].map((value) => <option key={value} value={value}>{modeLabels[value as AssignmentMode]}</option>)}
                  </select></label>
                  <button type="button" className="primary-button" disabled={busy || processing} onClick={() => onBuildPackage(mode)}>
                    {busy ? <><RefreshCw className="spin" size={16} />按 1→5 顺序补图</> : <><FileStack size={16} />生成素材包</>}
                  </button>
                </div>
              ) : null}
              {activeJob?.type === "build-content-package" && !terminalJobStatuses.has(activeJob.status) ? (
                <div className="story-package-job" role="status">
                  <div><RefreshCw className="spin" size={14} /><strong>{activeJob.stage || "正在建立素材包"}</strong><span>{Math.round(activeJob.progress * 100)}%</span></div>
                  <progress value={activeJob.progress} max={1}>{Math.round(activeJob.progress * 100)}%</progress>
                </div>
              ) : null}
                </section>
              )}
            </article>
          </div>
        </div>

        <footer className="story-drawer-footer">
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
}

export function TodayPage({ onNavigate, onNotice, onOpenDraft, onSearch }: TodayPageProps) {
  const [today, setToday] = useState<TodayView>();
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
    kind: "package" | "evidence" | "quick-write" | "draft";
    storyId: string;
  }>());

  const loadToday = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      setToday(await api.today());
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (!quiet) setLoading(false);
    }
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
    return () => events.close();
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
        await new Promise((resolve) => window.setTimeout(resolve, 1_500));
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

  const openStory = async (story: StoryView) => {
    const requestId = explanationRequestRef.current + 1;
    explanationRequestRef.current = requestId;
    setExplanationError(undefined);
    setExplanationLoading(false);
    setBusy(true);
    try {
      const next = await api.story(story.id);
      setDetail(next);
      void api.recordStoryEvent(story.id, "opened").catch(() => undefined);
      if (next.story.explanation.status !== "ready") void hydrateExplanation(story.id, requestId);
    } catch (openError) {
      onNotice("error", openError instanceof Error ? openError.message : String(openError));
    } finally {
      setBusy(false);
    }
  };

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
        onNotice("error", jobError instanceof Error ? jobError.message : String(jobError));
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
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="page today-page">
      <header className="today-header">
        <div>
          <span className="today-date">{new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date())}</span>
          <h1>今日编辑台</h1>
          <p>先判断今天该写什么，再进入事实、社区与图片素材包。</p>
        </div>
        <div className="today-header-actions">
          {today ? <span className="today-updated"><Clock3 size={14} />{relativeTime(today.generatedAt)}更新</span> : null}
          <button type="button" className="secondary-button" disabled={loading} onClick={() => void loadToday()}><RefreshCw className={loading ? "spin" : ""} size={16} />重新整理</button>
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
          />
        </div>
        <button type="submit" className="primary-button" disabled={!searchQuery.trim() || searching}>
          {searching ? <><RefreshCw className="spin" size={16} />搜索中</> : <><Search size={16} />搜索最近 7 天</>}
        </button>
        <p>实时读取已启用的官网与新闻来源；X 和社区帖子不参与这次事实搜索。</p>
      </form>

      <section className="today-metrics" aria-label="今日覆盖概览">
        {metrics.map(({ label, value, icon: Icon }) => <div key={label}><Icon size={17} /><span>{label}</span><strong>{value}</strong></div>)}
      </section>

      {error ? (
        <div className="today-error"><AlertTriangle size={18} /><div><strong>今日推荐读取失败</strong><p>{error}</p></div><button type="button" onClick={() => void loadToday()}>重试</button></div>
      ) : null}

      {loading && !today ? <div className="today-loading"><span className="loading-mark" />正在聚合事件、证据和社区讨论…</div> : null}

      {today ? (
        <>
          <section className="today-section today-must-read">
            <div className="today-section-heading">
              <div><span>今日事件推荐</span><h2>今天最值得判断的事件</h2></div>
              <p>按事件聚合相似报道，只保留证据足够、仍在时效窗口内且尚未写过的内容。</p>
            </div>
            {today.mustReads.length ? (
              <div className="today-featured-list">{today.mustReads.map((story, index) => (
                <StoryRow key={story.id} story={story} rank={index + 1} featured busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />
              ))}</div>
            ) : (
              <div className="today-empty"><Eye size={22} /><div><strong>暂时没有达到必写门槛的事件</strong><p>可以去新闻工作台补充来源，或查看仍在观察的事件。</p></div><button type="button" className="secondary-button" onClick={() => onNavigate("workbench")}>打开新闻工作台</button></div>
            )}
          </section>

          <div className="today-lower-grid">
            <section className="today-section">
              <div className="today-section-heading"><div><span>次级候选</span><h2>值得浏览，但不必立刻写</h2></div><button type="button" className="text-button" onClick={() => onNavigate("workbench")}>查看全部新闻 <ArrowRight size={14} /></button></div>
              <div className="today-secondary-list">
                {today.secondary.length ? today.secondary.map((story) => (
                  <StoryRow key={story.id} story={story} busy={busy} processing={backgroundProcessing} onOpen={openStory} onQueue={queueStory} onQuickDraft={quickWrite} />
                )) : <p className="story-empty-copy">当前没有额外可成稿候选。</p>}
              </div>
            </section>

            <aside className="today-watch-column">
              <section className="today-watch-list">
                <div className="today-section-heading"><div><span>继续观察</span><h2>有热度，证据还没跟上</h2></div></div>
                {today.watching.length ? today.watching.map((story) => (
                  <button type="button" key={story.id} onClick={() => openStory(story)}>
                    <span>{story.title}</span><small>{story.assignment.blockers[0] || story.assignment.reason}</small><ChevronRight size={15} />
                  </button>
                )) : <p className="story-empty-copy">没有等待补证的事件。</p>}
              </section>

              {today.diagnostics.length ? (
                <section className="today-diagnostics">
                  <div className="today-section-heading"><div><span>来源诊断</span><h2>{today.diagnostics.length} 个来源需要处理</h2></div></div>
                  {today.diagnostics.slice(0, 6).map((diagnostic) => (
                    <div key={diagnostic.sourceId}><AlertTriangle size={15} /><p><strong>{diagnostic.name}</strong><span>{diagnostic.detail}</span></p><small>{diagnostic.consecutiveFailures} 次失败</small></div>
                  ))}
                  <button type="button" className="text-button" onClick={() => onNavigate("sources")}>去来源页诊断 <ArrowRight size={14} /></button>
                </section>
              ) : null}
            </aside>
          </div>

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

          <Funnel data={today.funnel} />
        </>
      ) : null}

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
