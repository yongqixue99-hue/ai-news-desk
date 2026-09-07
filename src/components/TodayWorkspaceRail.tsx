import { ArrowRight, ChevronRight, FilePenLine, FileText, Radio } from "lucide-react";
import type { DraftOverview } from "../api";
import { draftStatusLabel } from "../draft-lifecycle-view";
import type { AppPage, StoryView, TodayView } from "../types";

interface TodayWorkspaceRailProps {
  today: TodayView;
  drafts?: DraftOverview;
  draftError?: string;
  openingDraftId?: string;
  onRetry: () => void;
  onNavigate: (page: AppPage) => void;
  onOpenDraft: (draftId: string) => void;
  onOpenStory: (story: StoryView) => void;
}

export function TodayWorkspaceRail({ today, drafts, draftError, openingDraftId, onRetry, onNavigate, onOpenDraft, onOpenStory }: TodayWorkspaceRailProps) {
  return (
    <aside className="today-workspace-rail" aria-label="我的编辑工作">
      <section className="desk-resume">
        <header><span className="desk-eyebrow">我的稿件</span><FilePenLine size={19} aria-hidden="true" /></header>
        <h2>接着写完这一篇</h2>
        <p>从上次停下的地方继续。</p>
        {draftError ? (
          <div className="desk-resume-empty" role="status"><span>最近草稿暂时未能读取。</span><button type="button" className="text-button" onClick={onRetry}>重新读取 <ArrowRight size={14} /></button></div>
        ) : drafts?.recent.length ? (
          <ol className="desk-resume-list">
            {drafts.recent.map((draft) => (
              <li key={draft.id}>
                <button type="button" disabled={Boolean(openingDraftId)} onClick={() => onOpenDraft(draft.id)}>
                  <span className={`desk-draft-state ${draft.status}`}>{openingDraftId === draft.id ? "正在打开…" : draftStatusLabel[draft.status]}</span>
                  <strong>{draft.title || "未命名草稿"}</strong>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <div className="desk-resume-empty"><FileText size={26} aria-hidden="true" /><span>{drafts ? "还没有进行中的草稿。选一个题目，就可以开始。" : "正在读取最近草稿…"}</span></div>
        )}
        <button type="button" className="desk-resume-all" onClick={() => onNavigate("drafts")}><span>打开草稿库{drafts?.total ? ` · ${drafts.total} 篇进行中` : ""}</span><ArrowRight size={15} /></button>
      </section>

      <section className="desk-workflow" aria-label="编辑工作路径">
        <span className="desk-eyebrow">一篇文章的下一步</span>
        <button type="button" onClick={() => onNavigate("workbench")}><span>01</span><div><strong>找到值得写的题目</strong><small>读原文，核对事实与素材</small></div><ChevronRight size={14} /></button>
        <button type="button" onClick={() => onNavigate("drafts")}><span>02</span><div><strong>把草稿改成你的文章</strong><small>编辑正文，配图与排版</small></div><ChevronRight size={14} /></button>
        <button type="button" onClick={() => onNavigate("schedule")}><span>03</span><div><strong>准备送入公众号</strong><small>配置草稿箱连接，发布由你完成</small></div><ChevronRight size={14} /></button>
      </section>

      <section className="today-watch-list">
        <div className="today-section-heading"><div><span>留意后续</span><h2>继续观察 <small>{today.watching.length}</small></h2></div></div>
        <p className="desk-rail-note">这些线索还需要补充证据。</p>
        {today.watching.length ? today.watching.map((story) => (
          <button type="button" key={story.id} onClick={() => onOpenStory(story)}><span>{story.title}</span><small>{story.assignment.blockers[0] || story.assignment.reason}</small><ChevronRight size={15} /></button>
        )) : <p className="story-empty-copy">目前没有等待补证的事件。</p>}
      </section>
      <button type="button" className="desk-source-link" onClick={() => onNavigate("sources")}><Radio size={16} /><span>管理我的新闻源</span><ArrowRight size={15} /></button>
    </aside>
  );
}
