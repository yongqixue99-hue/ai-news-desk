import { useEffect, useState } from "react";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { ArrowRight, ChevronRight, Radio, X } from "lucide-react";
import type { DraftOverview } from "../api";
import { draftStatusLabel } from "../draft-lifecycle-view";
import type { AppPage, StoryView, TodayView } from "../types";

interface TodayWorkspaceRailProps {
  today: TodayView;
  showDrafts?: boolean;
  drafts?: DraftOverview;
  draftError?: string;
  openingDraftId?: string;
  onRetry: () => void;
  onNavigate: (page: AppPage) => void;
  onOpenDraft: (draftId: string) => void;
  onOpenStory: (story: StoryView) => void;
}

export function TodayWorkspaceRail({ today, showDrafts = true, drafts, draftError, openingDraftId, onRetry, onNavigate, onOpenDraft, onOpenStory }: TodayWorkspaceRailProps) {
  const [compact, setCompact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 1120px)").matches);
  const [open, setOpen] = useState(false);
  const dialog = useDialogA11y<HTMLElement>({ open: compact && open, onClose: () => setOpen(false) });
  useEffect(() => { const media = window.matchMedia("(max-width: 1120px)"); const update = () => setCompact(media.matches); media.addEventListener("change", update); return () => media.removeEventListener("change", update); }, []);
  useEffect(() => { if (!compact || !open) return; const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, [compact, open]);
  const openStory = (story: StoryView) => { setOpen(false); onOpenStory(story); };
  const content = <>
      {showDrafts ? <section className="desk-resume desk-resume-compact" aria-label="继续写作">
        <header><h2>继续写作</h2><button type="button" className="text-button" onClick={() => onNavigate("drafts")}>全部稿件 <ArrowRight size={14} /></button></header>
        {draftError ? <div className="desk-resume-empty" role="status"><span>最近稿件暂未读取。</span><button type="button" className="text-button" onClick={onRetry}>重试</button></div>
          : drafts?.recent.length ? <ol className="desk-resume-list">{drafts.recent.slice(0, 1).map((draft) => <li key={draft.id}>
            <button type="button" disabled={Boolean(openingDraftId)} onClick={() => onOpenDraft(draft.id)}>
              <span className={`desk-draft-state ${draft.status}`}>{openingDraftId === draft.id ? "正在打开…" : draftStatusLabel[draft.status]}</span>
              <strong>{draft.title || "未命名草稿"}</strong><ChevronRight size={16} aria-hidden="true" />
            </button>
          </li>)}</ol> : <p className="story-empty-copy">{drafts ? "有了草稿，就从这里继续。" : "正在读取最近稿件…"}</p>}
      </section> : null}

      <section className="desk-pending-topics" aria-label="我的待选题">
        <div className="today-section-heading"><div><h2>我的待选题 <small>{today.pending?.length ?? 0}</small></h2></div></div>
        {today.pending?.length ? today.pending.map((story) => <button type="button" key={story.id} onClick={() => openStory(story)}><span>{story.title}</span><ChevronRight size={15} /></button>)
          : <p className="story-empty-copy">留住想写的新闻或问题，下次从这里继续。</p>}
      </section>

      <section className="today-watch-list">
        <div className="today-section-heading"><div><h2>继续观察 <small>{today.watching.length}</small></h2></div></div>
        <p className="desk-rail-note">这些线索还需要补充证据。</p>
        {today.watching.length ? today.watching.map((story) => (
          <button type="button" key={story.id} onClick={() => openStory(story)}><span>{story.title}</span><small>{story.assignment.blockers[0] || story.assignment.reason}</small><ChevronRight size={15} /></button>
        )) : <p className="story-empty-copy">目前没有等待补证的事件。</p>}
      </section>
      <button type="button" className="desk-source-link" onClick={() => onNavigate("sources")}><Radio size={16} /><span>管理我的新闻源</span><ArrowRight size={15} /></button>
    </>;
  return <aside className="today-workspace-rail" aria-label="我的编辑工作">
    {compact ? <><button className="secondary-button rail-open" aria-expanded={open} onClick={() => setOpen(true)}>我的待选题 {today.pending?.length ?? 0}{showDrafts ? " · 继续写作" : ""}<ChevronRight size={16} /></button>
      {open ? <div className="rail-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) setOpen(false); }}><section className="rail-dialog" ref={dialog} role="dialog" aria-modal="true" aria-label="我的编辑工作" tabIndex={-1}><header><h2>我的编辑工作</h2><button className="icon-button" aria-label="关闭选题队列" onClick={() => setOpen(false)}><X size={20} /></button></header>{content}</section></div> : null}</> : content}
  </aside>;
}
