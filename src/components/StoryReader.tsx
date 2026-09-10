import { useReaderHistory } from "../hooks/useReaderHistory";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Check, ExternalLink, FileStack, PanelRightClose, PanelRightOpen, RefreshCw, X } from "lucide-react";
import { api, type ProductJob, type StoryDetailResult } from "../api";
import type { AssignmentMode, ContentPackage } from "../types";
import type { SourceMaterialSnapshot } from "../../server/product-types.js";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { StoryAssetGallery } from "./StoryAssetGallery";
import { starterDraftActionCopy } from "../starter-draft";

export const readingScope = (basis?: string, partial = false) => partial ? "部分缺失" : basis === "full-source" ? "已读正文" : basis === "excerpt" ? "已读摘要" : "仅标题";
export const absoluteTime = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) + "（UTC+8）" : "时间未知";
const modes = { brief: "快讯", synthesis: "多源综合", community: "社区观察", playbook: "方案教程", curate: "导读" };
type Mode = Exclude<AssignmentMode, "watch" | "skip">;
const tabs = [{ id: "summary", label: "编辑速读" }, { id: "original", label: "原始正文" }, { id: "facts", label: "事实依据" }, { id: "community", label: "社区观点" }, { id: "images", label: "图片与图表" }] as const;
type View = typeof tabs[number]["id"];

export interface StoryReaderProps {
  detail: StoryDetailResult; busy: boolean; activeJob?: ProductJob;
  explanationLoading: boolean; explanationError?: string; actionError?: string;
  onClose: () => void; onRetryExplanation: () => void; onSupplementEvidence: () => void; onCollectAssets: () => void;
  onSkip: () => void; onQueue: (selected: boolean) => void; onRestoreFeedback: () => void;
  onBuildPackage: (mode: Mode) => void; onStartWriting: (contentPackage: ContentPackage) => void;
  onGenerateDraft: (contentPackage: ContentPackage) => void; onQuickWrite: (mode: Mode) => void;
}

export function StoryReader({ detail, busy, activeJob, explanationLoading, explanationError, actionError, onClose, onRetryExplanation, onSupplementEvidence, onCollectAssets, onSkip, onQueue, onRestoreFeedback, onBuildPackage, onStartWriting, onGenerateDraft, onQuickWrite }: StoryReaderProps) {
  useReaderHistory(onClose);
  const { story, contentPackage } = detail;
  const [view, setView] = useState<View>("summary");
  const [sidebar, setSidebar] = useState(false);
  const [mode, setMode] = useState<Mode>(story.technicalArticle ? "curate" : story.assignment.canDraft ? story.assignment.mode as Mode : "brief");
  const [materials, setMaterials] = useState<SourceMaterialSnapshot[]>([...(contentPackage?.sourceEvidence ?? []), ...(contentPackage?.sourceMaterials ?? [])]);
  const [readingState, setReadingState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [readAttempt, setReadAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  const ref = useDialogA11y<HTMLElement>({ open: true, onClose, initialFocusRef: closeRef });
  const processing = Boolean(activeJob && !["complete", "failed", "cancelled"].includes(activeJob.status));
  const blocked = contentPackage?.status === "blocked" ? contentPackage.blockers : !story.assignment.canDraft ? story.assignment.blockers : [];
  const partial = materials.some(m => m.truncated || m.extractionWarnings?.length);
  const basis = materials.length ? "full-source" : story.explanation.basis;
  const keyPoints = story.explanation.keyPoints.filter(point => point.trim() !== (story.explanation.readerBrief || story.summary).trim());
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = overflow; };
  }, []);
  useEffect(() => {
    if (view !== "original") return;
    let alive = true; setReadingState("loading");
    void api.storyReading(story.id).then(next => { if (alive) { setMaterials(next); setReadingState("ready"); } })
      .catch(() => { if (alive) setReadingState("error"); });
    return () => { alive = false; };
  }, [view, story.id, readAttempt]);
  const changeView = (next: View) => { setView(next); ref.current?.querySelector(".story-drawer-body")?.scrollTo(0, 0); };
  return <div className="story-drawer-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={ref} className="story-drawer a1-reader" role="dialog" aria-modal="true" aria-labelledby="story-drawer-title" tabIndex={-1}>
      <header className="story-drawer-header"><div>
        <div className="today-story-kicker"><span>{story.signals[0]?.sourceName || "来源待核对"}</span><span className="reading-scope">{readingScope(basis, partial)}</span><span>{story.selected ? "已保留" : "尚未保留"}</span></div>
        <h2 id="story-drawer-title">{story.title}</h2>
        {story.originalTitle !== story.title ? <p className="story-original-title">原题：{story.originalTitle}</p> : null}
      </div><button ref={closeRef} type="button" className="icon-button" onClick={onClose} aria-label="关闭事件详情"><X size={20} /></button></header>
      <div className="reader-navigation"><nav className="story-reader-tabs" aria-label="事件视图" role="tablist">
        {tabs.map((tab, i) => <button key={tab.id} role="tab" type="button" id={`reader-tab-${tab.id}`} aria-controls="reader-panel" aria-selected={view === tab.id} tabIndex={view === tab.id ? 0 : -1} onClick={() => changeView(tab.id)} onKeyDown={event => {
          const index = event.key === "ArrowRight" ? (i + 1) % tabs.length : event.key === "ArrowLeft" ? (i + tabs.length - 1) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : undefined;
          if (index !== undefined) { event.preventDefault(); document.getElementById(`reader-tab-${tabs[index]!.id}`)?.focus(); }
        }}>{tab.label}{tab.id === "images" ? ` ${story.imageCount}` : ""}</button>)}
      </nav><button className="text-button reader-sidebar-toggle" aria-expanded={sidebar} aria-controls="reader-evidence-sidebar" onClick={() => setSidebar(!sidebar)}>{sidebar ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}来源侧栏</button></div>
      <div className="story-drawer-body">
        {blocked.length ? <div className="reader-blocking" role="status"><AlertTriangle size={17} /><div><strong>材料尚不支持成稿</strong><p>{blocked.join("；")}</p><span>可以先保留选题，或补读材料后重试准备。</span></div></div> : null}
        {actionError ? <div className="reader-blocking" role="alert"><AlertTriangle size={17} /><div><strong>本次准备未完成{story.selected ? "，选题已保留" : ""}</strong><p>已有材料仍可阅读。可以重试准备，或在任务中心恢复。</p><details><summary>查看具体原因</summary>{actionError}</details></div></div> : null}
        {processing ? <div className="reader-task" role="status"><RefreshCw size={16} className="spin" /><span>{activeJob?.status === "queued" ? "任务已排队" : activeJob?.stage || "正在准备材料"} · 可关闭阅读器，稍后在任务中心继续。</span></div> : null}
        <div className={`reader-columns${sidebar ? " with-sidebar" : ""}`}>
          <article className="reader-canvas" role="tabpanel" id="reader-panel" aria-labelledby={`reader-tab-${view}`} tabIndex={0}>
            {view === "summary" ? <>
              <div className="reader-section-heading"><h3>编辑速读</h3><span>{readingScope(story.explanation.basis)}</span></div>
              <p className="reader-lead">{story.explanation.readerBrief || story.summary || "目前只有标题，尚无速读内容。"}</p>
              {story.explanation.editorNote ? <div className="reader-editor-note"><strong>编辑备注</strong><p>{story.explanation.editorNote}</p></div> : null}
              {keyPoints.length ? <section><h4>具体信息</h4><ul>{keyPoints.map(p => <li key={p}>{p}</li>)}</ul></section> : null}
              {story.explanation.unknowns.length ? <div className="reader-limit"><strong>当前材料缺口</strong><ul>{story.explanation.unknowns.map(p => <li key={p}>{p}</li>)}</ul></div> : null}
              {explanationError?.startsWith("任务仍在") ? <div className="reader-limit" role="status"><strong>任务仍在后台处理</strong><p>{explanationError}</p></div> : explanationError ? <div className="reader-limit" role="alert"><strong>补读或速读生成未完成</strong><p>当前显示已有内容，可以重试；后台任务可从任务中心恢复。</p><details><summary>具体原因</summary>{explanationError}</details></div> : null}
              <button className="secondary-button" disabled={explanationLoading} onClick={onRetryExplanation}><RefreshCw size={15} className={explanationLoading ? "spin" : ""} />{explanationLoading ? "正在补读与生成速读" : story.explanation.status === "ready" ? "重新生成速读" : "补读原文并生成速读"}</button>
              <p className="reader-help">此操作会联网读取来源，并调用当前速读模型。</p>
              <details className="story-package-builder"><summary><FileStack size={16} />写作材料与稿型</summary>
                <p>{contentPackage ? `已有冻结素材包 · ${contentPackage.facts.length} 条事实 · ${absoluteTime(contentPackage.createdAt)}` : "准备写作会先整理来源并冻结素材包，按既有事实条件检查。"}</p>
                <label>稿型<select value={mode} onChange={e => setMode(e.target.value as Mode)}>{Object.entries(modes).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
                <button className="secondary-button" disabled={busy || processing || !story.assignment.canDraft} onClick={() => onBuildPackage(mode)}>单独整理素材包</button>
                {contentPackage?.status === "ready" ? <div className="reader-package-actions"><button className="primary-button" disabled={busy || processing} onClick={() => onGenerateDraft(contentPackage)}>{starterDraftActionCopy.primary}</button><button className="secondary-button" disabled={busy || processing} onClick={() => onStartWriting(contentPackage)}>{starterDraftActionCopy.blank}</button></div> : null}
              </details>
            </> : null}
            {view === "original" ? <><div className="reader-section-heading"><h3>原始正文</h3><span>已有快照 · 不联网</span></div>
              {readingState === "loading" ? <p role="status">正在读取本地材料…</p> : null}
              {readingState === "error" ? <div className="reader-limit" role="alert"><strong>本地正文读取失败</strong><p>保留已有材料和选题，可以重试读取。</p><button className="secondary-button" onClick={() => setReadAttempt(a => a + 1)}>重试读取快照</button></div> : null}
              {materials.map((m, i) => <section className="reader-source-document" key={`${m.url}:${i}`}><h4>{m.originalTitle}</h4><div className="reader-document-meta"><a href={m.url} target="_blank" rel="noreferrer">{m.sourceLabel} <ExternalLink size={13} /></a><span>{m.author || "作者未记录"}</span><time>{absoluteTime(m.capturedAt)} · 已保存快照</time></div>
                {m.truncated || m.extractionWarnings?.length ? <div className="reader-limit"><strong>部分缺失</strong><p>{m.extractionWarnings?.join("；") || "来源正文已截断，不能视为全文。"}</p></div> : null}
                <div className="reader-original-text">{m.originalText}</div><p className="reader-help">{m.rightsNotice}</p></section>)}
              {!materials.length && readingState === "ready" ? <div className="reader-limit"><strong>尚无已保存的正文</strong><p>目前可用范围：{readingScope(story.explanation.basis)}。可以在“编辑速读”中补读原文，或打开来源核对。</p></div> : null}
            </> : null}
            {view === "facts" ? <><div className="reader-section-heading"><h3>事实依据</h3><span>{contentPackage?.facts.length ?? 0} 条已冻结记录</span></div>
              {contentPackage?.facts.length ? contentPackage.facts.map(fact => <section className="reader-fact" key={fact.id}><span className="reading-scope">{{ supported: "来源支持", "partially-supported": "部分支持", conflicted: "存在冲突", unverified: "待核对" }[fact.status]}</span><p>{fact.text}</p>{fact.note ? <p className="reader-help">{fact.note}</p> : null}
                <details><summary>展开原句、位置与日期</summary>{fact.quotations?.length ? fact.quotations.map((q, i) => <blockquote key={i}><p>{q.text}</p><a href={q.sourceUrl} target="_blank" rel="noreferrer">原始位置：{q.sourceUrl}<ExternalLink size={13} /></a><small>来源日期：{absoluteTime(contentPackage.sources.find(s => s.url === q.sourceUrl)?.publishedAt)}</small></blockquote>) : <p>这条旧记录没有逐字引文，可沿来源核对；不能以速读代替原句。</p>}<p className="reader-help">适用条件以以上原句为准；未单独标记的条件需对照原文。</p></details>
              </section>) : <p>尚未冻结逐条事实。来源可供阅读，不能将编辑速读当成已核验事实。</p>}
              {story.opportunity?.practice ? <details><summary>实践选题角度</summary><p>{story.opportunity.practice.angle}</p><p>{story.opportunity.practice.audience} · 建议{story.opportunity.practice.format === "playbook" ? "实践教程" : "导读整理"}</p>{story.opportunity.practice.materials.map(material => <p key={material.url}><a href={material.url} target="_blank" rel="noreferrer">{material.label}</a></p>)}<p>{story.opportunity.practice.limitations}</p><small>保留原始日期，实践推荐窗口为 30 天。</small></details> : null}<SourceLinks story={story} />
            </> : null}
            {view === "community" ? <><div className="reader-section-heading"><h3>社区观点</h3><span>实际读取 {contentPackage?.discussionSamples.length ?? 0} 条</span></div>
              <p className="reader-limit">{(contentPackage?.discussionSamples.length ?? 0) < 5 ? "有限样本，不能代表社区。" : contentPackage?.communityEvidenceLabel || "仅展示已读取的样本。"} 回答总数和评论总数不计作已读样本。</p>
              {contentPackage?.discussionSamples.map(sample => <blockquote key={sample.id}><p>{sample.originalText}</p>{sample.translatedText ? <p>译文：{sample.translatedText}</p> : null}<a href={sample.permalink} target="_blank" rel="noreferrer">{sample.author} · {sample.platform} <ExternalLink size={13} /></a><small>{absoluteTime(sample.publishedAt)}</small></blockquote>)}
            </> : null}
            {view === "images" ? <StoryAssetGallery images={story.images} localCount={story.localImageCount ?? 0} publishReadyCount={story.publishReadyImageCount ?? 0} reports={detail.assetCollection?.sourceReports} busy={busy || processing} onCollect={onCollectAssets} /> : null}
          </article>
          {sidebar ? <aside className="reader-evidence-sidebar" id="reader-evidence-sidebar" aria-label="来源与材料范围"><h3>来源与材料</h3><p>材料范围：{readingScope(basis, partial)}</p><p>热度：{story.trend.direction === "unknown" ? "未知，尚无可比较观测" : story.trend.summary}</p><p>编辑价值：{story.opportunity?.reason || story.assignment.reason}</p>{story.releaseDossier ? <details className="reader-dossier"><summary>模型发布资料 {story.releaseDossier.readyCount}/{story.releaseDossier.totalCount}</summary>{story.releaseDossier.facets.map(facet => <p key={facet.id}><strong>{facet.label} · {{ready:"已齐",partial:"部分材料",missing:"缺失"}[facet.status]}</strong><br />{facet.detail}</p>)}<p>{story.releaseDossier.nextAction}</p></details> : null}{story.opportunity?.practice ? <details><summary>实践选题角度</summary><p>{story.opportunity.practice.angle}</p><p>{story.opportunity.practice.audience} · 建议{story.opportunity.practice.format === "playbook" ? "实践教程" : "导读整理"}</p>{story.opportunity.practice.materials.map(material => <p key={material.url}><a href={material.url} target="_blank" rel="noreferrer">{material.label}</a></p>)}<p>{story.opportunity.practice.limitations}</p><small>保留原始日期，实践推荐窗口为 30 天。</small></details> : null}<SourceLinks story={story} /><button className="secondary-button" disabled={busy || processing} onClick={onSupplementEvidence}>补读来源与证据</button><p className="reader-help">会联网并可能调用当前模型。</p></aside> : null}
        </div>
      </div>
      <footer className="story-drawer-footer"><span className="story-footer-note">准备写作将整理材料并调用当前模型</span>
        {story.ignored ? <button className="secondary-button" onClick={onRestoreFeedback}>恢复选题</button> : <>
          <button className="text-button reader-skip" disabled={busy} onClick={onSkip}>跳过</button>
          <button className="secondary-button" disabled={busy || story.selected} onClick={() => onQueue(true)}>{story.selected ? <><Check size={15} />已保留</> : <><FileStack size={15} />留作选题</>}</button>
          <button className="primary-button" disabled={busy || processing || !story.assignment.canDraft || contentPackage?.status === "blocked" || story.drafted} onClick={() => onQuickWrite(mode)}>{processing ? "正在准备" : story.drafted ? "已有草稿" : "准备写作"}<ArrowRight size={15} /></button>
        </>}
      </footer>
    </section>
  </div>;
}

function SourceLinks({ story }: { story: StoryDetailResult["story"] }) {
  return <div className="reader-source-links">{story.signals.map(signal => <details key={`${signal.runId}:${signal.candidateId}`}><summary>{signal.sourceName} · {signal.isCommunity ? "发现与讨论" : "事件来源"}</summary><a href={signal.url} target="_blank" rel="noreferrer">{signal.title}<ExternalLink size={13} /></a><p>{signal.author || "作者未记录"} · {signal.publicationDateKnown === false ? "发布时间未知" : absoluteTime(signal.publishedAt)}</p><p>观察时间：{absoluteTime(signal.fetchedAt)}</p><p>读取范围：{readingScope(signal.briefingBasis)}</p>{signal.excerpt ? <blockquote>{signal.excerpt}</blockquote> : null}{signal.isCommunity ? <p>互动：{signal.engagement?.points === undefined ? "积分未知" : `${signal.engagement.points} 积分`} · {signal.engagement?.comments === undefined ? "评论数未知" : `${signal.engagement.comments} 条评论`}</p> : null}</details>)}</div>;
}
