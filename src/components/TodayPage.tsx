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
  MessageSquareText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from "lucide-react";
import { api, type StoryDetailResult } from "../api";
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

const relativeTime = (value: string) => {
  const deltaMinutes = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 60_000));
  if (deltaMinutes < 60) return `${deltaMinutes || 1} 分钟前`;
  const hours = Math.round(deltaMinutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  return `${Math.round(hours / 24)} 天前`;
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
  const image = story.images[0];
  if (!image) {
    return (
      <div className="today-story-image empty" aria-label="当前来源没有合格图片">
        <ImageIcon size={22} />
        <span>暂无合格原图</span>
      </div>
    );
  }
  return (
    <div className="today-story-image">
      <img
        src={image.publicPath || image.url}
        alt={image.caption || story.title}
        loading={eager ? "eager" : "lazy"}
        onError={(event) => event.currentTarget.closest(".today-story-image")?.classList.add("failed")}
      />
      <span>{story.imageCount} 张相关图</span>
    </div>
  );
};

interface StoryRowProps {
  story: StoryView;
  rank?: number;
  featured?: boolean;
  onOpen: (story: StoryView) => void;
}

const StoryRow = ({ story, rank, featured = false, onOpen }: StoryRowProps) => (
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
  </article>
);

const Funnel = ({ data }: { data: TodayView["funnel"] }) => {
  const steps = [
    ["候选", data.candidateCount],
    ["Story", data.storyCount],
    ["已选择", data.selectedCount],
    ["草稿", data.draftCount],
    ["已同步", data.syncedCount],
    ["已发布", data.publishedCount],
  ] as const;
  return (
    <section className="today-funnel" aria-label="内容生产漏斗">
      <div className="today-section-heading">
        <div><span>生产闭环</span><h2>哪里正在掉队</h2></div>
        <small>{data.feedbackCount} 次选择反馈 · {data.reusableMaterialCount} 个可复用素材</small>
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
    </section>
  );
};

interface StoryDrawerProps {
  detail: StoryDetailResult;
  busy: boolean;
  explanationLoading: boolean;
  explanationError?: string;
  onClose: () => void;
  onRetryExplanation: () => void;
  onFeedback: (kind: "interested" | "not_interested") => void;
  onRestoreFeedback: () => void;
  onBuildPackage: (mode: Exclude<AssignmentMode, "watch" | "skip">) => void;
  onCreateDraft: (contentPackage: ContentPackage) => void;
}

const StoryDrawer = ({
  detail,
  busy,
  explanationLoading,
  explanationError,
  onClose,
  onRetryExplanation,
  onFeedback,
  onRestoreFeedback,
  onBuildPackage,
  onCreateDraft,
}: StoryDrawerProps) => {
  const { story } = detail;
  const [mode, setMode] = useState<Exclude<AssignmentMode, "watch" | "skip">>(
    story.assignment.canDraft ? story.assignment.mode as Exclude<AssignmentMode, "watch" | "skip"> : "brief",
  );
  const contentPackage = detail.contentPackage;
  const factSignals = uniqueSourceSignals(story.signals.filter((signal) => !signal.isCommunity));
  const communitySignals = uniqueSourceSignals(story.signals.filter((signal) => signal.isCommunity));

  return (
    <div className="story-drawer-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <aside className="story-drawer" role="dialog" aria-modal="true" aria-labelledby="story-drawer-title">
        <header className="story-drawer-header">
          <div>
            <div className="today-story-kicker">
              <span className={`assignment-pill mode-${story.assignment.mode}`}>{modeLabels[story.assignment.mode]}</span>
              <span className={`evidence-pill evidence-${story.evidenceStrength}`}>{evidenceLabels[story.evidenceStrength]}</span>
            </div>
            <h2 id="story-drawer-title">{story.title}</h2>
            {story.originalTitle !== story.title ? <p className="story-original-title">原题：{story.originalTitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="关闭 Story 详情"><X size={19} /></button>
        </header>

        <div className="story-drawer-body story-reader-body">
          <div className="story-reader-layout">
            <aside className="story-reader-sidebar" aria-label="Story 来源与判断">
              <section className="story-decision-band story-decision-stack">
                <div><span>建议</span><strong>{story.assignment.reason}</strong></div>
                <div><span>热度</span><strong>{story.trend.summary}</strong></div>
              </section>

              {story.assignment.blockers.length ? (
                <div className="story-blockers"><AlertTriangle size={18} /><div><strong>当前不能成稿</strong>{story.assignment.blockers.map((item) => <p key={item}>{item}</p>)}</div></div>
              ) : null}

              <section className="story-detail-section story-source-section">
                <div className="story-detail-heading"><h3>文章来源</h3><span>{story.sourceCount} 个</span></div>
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
                <div className="story-detail-heading"><h3>原文图片</h3><span>{story.imageCount} 张</span></div>
                {story.images.length ? (
                  <div className="story-image-grid">
                    {story.images.slice(0, 6).map((image) => (
                      <figure key={image.id}>
                        <img src={image.publicPath || image.url} alt={image.caption || "来源图片"} loading="lazy" />
                        <figcaption><strong>{image.caption || "来源图片"}</strong><span>{image.attribution || "来源待核对"} · {image.rights}</span></figcaption>
                      </figure>
                    ))}
                  </div>
                ) : <p className="story-empty-copy">没有发现相关原图；系统不会用无关 AI 生图补位。</p>}
              </section>
            </aside>

            <article className="story-reader-content">
              <section className="story-explanation-section">
                <div className="story-explanation-heading">
                  <div><span>编辑速读</span><h3>这条新闻讲了什么</h3></div>
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
                  <div className="story-explanation-progress"><span className="loading-mark" /><p><strong>先显示已有信息</strong><small>正文读完后会自动换成新版编辑速读，不影响继续浏览。</small></p></div>
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
              <div className="story-detail-heading"><h3>成稿素材包</h3><span>{modeLabels[contentPackage.mode]}</span></div>
              <PackageStatus contentPackage={contentPackage} />
              {contentPackage.status === "ready" ? (
                <div className="package-draft-action">
                  <div><strong>素材边界已经冻结</strong><span>成稿只能使用下列事实、原句、来源和图片。</span></div>
                  <button type="button" className="primary-button" disabled={busy} onClick={() => onCreateDraft(contentPackage)}>
                    {busy ? <RefreshCw className="spin" size={16} /> : <Sparkles size={16} />}生成图文草稿
                  </button>
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
                      <figcaption><strong>{asset.role}</strong><span>{asset.rightsReason}</span></figcaption>
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
                  <button type="button" className="primary-button" disabled={busy} onClick={() => onBuildPackage(mode)}>
                    {busy ? <RefreshCw className="spin" size={16} /> : <FileStack size={16} />}生成素材包
                  </button>
                </div>
              ) : null}
                </section>
              )}
            </article>
          </div>
        </div>

        <footer className="story-drawer-footer">
          {story.ignored || story.signals.some((signal) => signal.feedback === "interested") ? (
            <button type="button" className="secondary-button" disabled={busy} onClick={onRestoreFeedback}><RotateCcw size={15} />撤销选择</button>
          ) : (
            <>
              <button type="button" className="secondary-button" disabled={busy} onClick={() => onFeedback("not_interested")}>不感兴趣</button>
              <button type="button" className="primary-button" disabled={busy} onClick={() => onFeedback("interested")}><Sparkles size={15} />值得写</button>
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
}

export function TodayPage({ onNavigate, onNotice }: TodayPageProps) {
  const [today, setToday] = useState<TodayView>();
  const [detail, setDetail] = useState<StoryDetailResult>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [explanationLoading, setExplanationLoading] = useState(false);
  const [explanationError, setExplanationError] = useState<string>();
  const explanationRequestRef = useRef(0);

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
    return () => events.close();
  }, [loadToday]);

  const closeStory = useCallback(() => {
    explanationRequestRef.current += 1;
    setExplanationLoading(false);
    setExplanationError(undefined);
    setDetail(undefined);
  }, []);

  useEffect(() => {
    if (!detail) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeStory();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [closeStory, detail]);

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

  const recordFeedback = async (kind: "interested" | "not_interested") => {
    if (!detail) return;
    setBusy(true);
    try {
      await api.recordStoryEvent(detail.story.id, kind);
      onNotice("success", kind === "interested" ? "已记为值得写，后续推荐会保留这类主题。" : "已退出今日候选，不会继续占据首屏。");
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

  const buildPackage = async (mode: Exclude<AssignmentMode, "watch" | "skip">) => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api.createContentPackage(detail.story.id, mode);
      setDetail((current) => current ? { ...current, contentPackage: result.contentPackage } : current);
      onNotice("success", result.reused ? "已打开同一证据版本的素材包。" : "素材包已建立；事实、原句与图片都可以逐项检查。");
      await loadToday(true);
    } catch (packageError) {
      onNotice("error", packageError instanceof Error ? packageError.message : String(packageError));
    } finally {
      setBusy(false);
    }
  };

  const createDraft = async (contentPackage: ContentPackage) => {
    setBusy(true);
    try {
      const queued = await api.createDraftFromPackage(contentPackage.id);
      let job = queued.job;
      if (!queued.draft) {
        onNotice("info", "成稿任务已进入可恢复队列；你可以留在当前页面，完成后会自动打开草稿。");
        for (let attempt = 0; attempt < 600 && !["complete", "failed", "cancelled"].includes(job.status); attempt += 1) {
          await new Promise((resolve) => window.setTimeout(resolve, 1_500));
          job = await api.productJob(job.id);
        }
      }
      if (job.status !== "complete") throw new Error(job.error || "成稿任务没有完成，请到运行记录查看");
      const result = (job.result ?? {}) as { reused?: boolean; imageCount?: number };
      onNotice("success", result.reused || queued.reused
        ? "这份素材包已经生成过草稿，已为你打开。"
        : `图文草稿已生成，并带入 ${result.imageCount ?? queued.draft?.images.length ?? 0} 张来源图片。`);
      setDetail(undefined);
      onNavigate("drafts");
    } catch (draftError) {
      onNotice("error", draftError instanceof Error ? draftError.message : String(draftError));
    } finally {
      setBusy(false);
    }
  };

  const coverage = today?.coverage;
  const metrics = useMemo(() => [
    { label: "活跃 Story", value: coverage?.activeStoryCount ?? 0, icon: BookOpen },
    { label: "正在升温", value: coverage?.risingCount ?? 0, icon: TrendingUp },
    { label: "至少 2 张图", value: coverage?.imageReadyCount ?? 0, icon: ImageIcon },
    { label: "强证据", value: coverage?.strongEvidenceCount ?? 0, icon: ShieldCheck },
  ], [coverage]);

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
              <div><span>必看 3 条</span><h2>今天最值得判断的事件</h2></div>
              <p>只保留证据足够、仍在时效窗口内且尚未写过的 Story。</p>
            </div>
            {today.mustReads.length ? (
              <div className="today-featured-list">{today.mustReads.map((story, index) => <StoryRow key={story.id} story={story} rank={index + 1} featured onOpen={openStory} />)}</div>
            ) : (
              <div className="today-empty"><Eye size={22} /><div><strong>暂时没有达到必写门槛的 Story</strong><p>可以去新闻工作台补充来源，或查看仍在观察的事件。</p></div><button type="button" className="secondary-button" onClick={() => onNavigate("workbench")}>打开新闻工作台</button></div>
            )}
          </section>

          <div className="today-lower-grid">
            <section className="today-section">
              <div className="today-section-heading"><div><span>次级候选</span><h2>值得浏览，但不必立刻写</h2></div><button type="button" className="text-button" onClick={() => onNavigate("workbench")}>查看全部新闻 <ArrowRight size={14} /></button></div>
              <div className="today-secondary-list">
                {today.secondary.length ? today.secondary.map((story) => <StoryRow key={story.id} story={story} onOpen={openStory} />) : <p className="story-empty-copy">当前没有额外可成稿候选。</p>}
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

          <Funnel data={today.funnel} />
        </>
      ) : null}

      {detail ? (
        <StoryDrawer
          detail={detail}
          busy={busy}
          explanationLoading={explanationLoading}
          explanationError={explanationError}
          onClose={closeStory}
          onRetryExplanation={retryExplanation}
          onFeedback={recordFeedback}
          onRestoreFeedback={restoreFeedback}
          onBuildPackage={buildPackage}
          onCreateDraft={createDraft}
        />
      ) : null}
    </div>
  );
}
