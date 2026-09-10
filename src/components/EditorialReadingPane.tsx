import {
  AlertTriangle,
  ArrowUpRight,
  BookOpenText,
  Check,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  MessageSquareText,
  Newspaper,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import type { EditorialIntakeResult } from "../api";
import type { EditorialIntent } from "../types";

const intentIcons = {
  news: Newspaper,
  source: FileText,
  community: MessageSquareText,
} as const;

const sourceKindLabels = {
  "news-source": "新闻／官方来源",
  "linked-community": "社区发现 · 外链事件",
  "self-contained-community": "社区原帖",
} as const;

const sourceLabel = (url: string, fallback: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || fallback;
  } catch {
    return fallback;
  }
};

interface EditorialReadingPaneProps {
  detail?: EditorialIntakeResult;
  loading?: boolean;
  error?: string;
  draftBusy?: boolean;
  onRetry?: () => void;
  onGenerate: (intent: EditorialIntent) => void;
}

export function EditorialReadingPane({
  detail,
  loading = false,
  error,
  draftBusy = false,
  onRetry,
  onGenerate,
}: EditorialReadingPaneProps) {
  if (!detail && loading) {
    return (
      <section className="editorial-reader editorial-reader-state" aria-live="polite">
        <LoaderCircle className="spin" size={24} />
        <div><strong>正在读取原始来源</strong><span>先确认原文讲了什么，再决定怎样成稿。</span></div>
      </section>
    );
  }
  if (!detail && error) {
    return (
      <section className="editorial-reader editorial-reader-state error" role="alert">
        <AlertTriangle size={24} />
        <div><strong>内容阅读卡暂时不可用</strong><span>{error}</span></div>
        {onRetry ? <button type="button" className="secondary-button" onClick={onRetry}><RefreshCw size={14} />重试</button> : null}
      </section>
    );
  }
  if (!detail) {
    return (
      <section className="editorial-reader editorial-reader-state empty">
        <BookOpenText size={28} />
        <div><strong>从左侧选择一条内容</strong><span>这里会直接显示中文讲解、原始来源、图片和推荐写法。</span></div>
      </section>
    );
  }

  const { story, intake } = detail;
  const factSources = story.signals.filter((signal) => signal.factBearing ?? !signal.isCommunity);
  const communitySources = story.signals.filter((signal) => signal.isCommunity);
  const recommended = intake.options.find((option) => option.intent === intake.recommendedIntent);
  const images = story.images.filter((image) => image.publicPath || image.url).slice(0, 6);

  return (
    <article className="editorial-reader" aria-labelledby="editorial-reader-title">
      <header className="editorial-reader-header">
        <div className="editorial-reader-kicker">
          <span>{sourceKindLabels[intake.sourceKind]}</span>
          <span>{story.explanation.basis === "full-source" ? "已读原文" : story.explanation.basis === "excerpt" ? "依据摘要" : "仅有标题"}</span>
          <span>{story.factSourceCount} 个事实来源</span>
        </div>
        <h2 id="editorial-reader-title">{story.title}</h2>
        {story.originalTitle !== story.title ? <p className="editorial-reader-original">原标题：{story.originalTitle}</p> : null}
      </header>

      <section className="editorial-reader-recommendation">
        <div><Sparkles size={17} /><span>推荐处理</span><strong>{recommended?.label ?? "继续观察"}</strong></div>
        <p>{intake.recommendationReason}</p>
      </section>

      {loading ? (
        <div className="editorial-reader-refresh" role="status"><LoaderCircle className="spin" size={15} />正在补齐来源正文，当前信息可以先看。</div>
      ) : null}
      {error ? (
        <div className={error.startsWith("任务仍在") ? "editorial-reader-pending" : "editorial-reader-inline-error"} role={error.startsWith("任务仍在") ? "status" : "alert"}><span>{error}</span>{onRetry && !error.startsWith("任务仍在") ? <button type="button" onClick={onRetry}>重试</button> : null}</div>
      ) : null}

      <section className="editorial-reader-brief">
        <span>这篇内容讲了什么</span>
        <p>{story.explanation.readerBrief || story.summary}</p>
        {story.explanation.keyPoints.length ? (
          <ul>{story.explanation.keyPoints.slice(0, 6).map((point) => <li key={point}>{point}</li>)}</ul>
        ) : null}
      </section>

      {images.length ? (
        <section className="editorial-reader-visuals">
          <div className="editorial-reader-section-title"><ImageIcon size={15} /><strong>原文视觉</strong><span>{story.imageCount} 张已发现</span></div>
          <div>{images.map((image) => (
            <figure key={image.id}>
              <img src={image.publicPath || image.url} alt={image.caption || story.title} loading="lazy" />
              <figcaption>{image.caption || image.attribution || "来源图片"}</figcaption>
            </figure>
          ))}</div>
        </section>
      ) : (
        <div className="editorial-reader-no-image"><ImageIcon size={17} /><span>暂未发现合格原图；采用后会继续读取正文图片和局部截图。</span></div>
      )}

      <div className="editorial-reader-evidence-grid">
        <section>
          <div className="editorial-reader-section-title"><Check size={15} /><strong>事实来源</strong><span>{factSources.length}</span></div>
          {factSources.length ? factSources.slice(0, 6).map((source) => (
            <a key={`${source.runId}:${source.candidateId}:fact`} href={source.url} target="_blank" rel="noreferrer">
              <span>{source.linkedSource ? sourceLabel(source.url, source.sourceName) : source.sourceName}</span>
              <strong>{source.titleZh || source.title}</strong>
              <ArrowUpRight size={13} />
            </a>
          )) : <p>还没有可以支撑新闻正文的来源。</p>}
        </section>
        <section>
          <div className="editorial-reader-section-title"><MessageSquareText size={15} /><strong>社区线索</strong><span>{communitySources.length}</span></div>
          {communitySources.length ? communitySources.slice(0, 4).map((source) => (
            <a key={`${source.runId}:${source.candidateId}:community`} href={source.discussionUrl || source.url} target="_blank" rel="noreferrer">
              <span>{source.sourceName}</span>
              <strong>{source.engagement?.points ?? 0} 积分 · {source.engagement?.comments ?? 0} 评论</strong>
              <ArrowUpRight size={13} />
            </a>
          )) : <p>这条内容不是从社区讨论中发现的。</p>}
        </section>
      </div>

      {story.explanation.unknowns.length ? (
        <section className="editorial-reader-unknowns">
          <div><AlertTriangle size={15} /><strong>仍需注意</strong></div>
          <ul>{story.explanation.unknowns.slice(0, 4).map((item) => <li key={item}>{item}</li>)}</ul>
        </section>
      ) : null}

      <footer className="editorial-reader-actions">
        <div className="editorial-intent-options" role="radiogroup" aria-label="内容处理方式">
          {intake.options.map((option) => {
            const Icon = intentIcons[option.intent];
            const isRecommended = option.intent === intake.recommendedIntent;
            return (
              <button
                type="button"
                key={option.intent}
                className={isRecommended ? "recommended" : ""}
                disabled={!option.available || draftBusy}
                title={option.reason}
                onClick={() => onGenerate(option.intent)}
              >
                <Icon size={16} />
                <span><strong>{option.label}</strong><small>{option.available ? option.description : option.reason}</small></span>
                {isRecommended ? <em>推荐</em> : null}
              </button>
            );
          })}
        </div>
        {draftBusy ? <div className="editorial-reader-drafting" role="status"><LoaderCircle className="spin" size={15} />正在自动读取来源、配图并成稿…</div> : null}
      </footer>
    </article>
  );
}
