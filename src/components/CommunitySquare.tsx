import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  BookOpenText,
  Clock3,
  Flame,
  Image as ImageIcon,
  Languages,
  LoaderCircle,
  MessageCircle,
  MessagesSquare,
  Quote,
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
import type {
  AiProviderConfig,
  Candidate,
  CandidateFeedbackKind,
  CollectionTopicId,
  Settings,
  SourceConfig,
  WorkflowRun,
} from "../types";
import { CommunityDraftModal, type CommunityDraftMode } from "./CommunityDraftModal";

type CommunitySortMode = "recommended" | "hot" | "latest";

interface CommunitySquareProps {
  runs: WorkflowRun[];
  sources: SourceConfig[];
  settings: Settings;
  activeProvider: AiProviderConfig;
  onFeedback: (
    runId: string,
    candidateId: string,
    kind: Extract<CandidateFeedbackKind, "interested" | "not_interested">,
  ) => Promise<void>;
  onRestoreFeedback: (runId: string, candidateId: string) => Promise<void>;
  onCreateDraft: (
    runId: string,
    candidateId: string,
    mode: CommunityDraftMode,
  ) => Promise<void>;
  onAutoBrief: (requests: Array<{ runId: string; candidateIds: string[] }>) => Promise<void>;
}

const containsChinese = (value: string) => /[\u3400-\u9fff]/u.test(value);

const displayTitle = (candidate: Candidate) => candidate.briefing?.titleZh
  ?? (containsChinese(candidate.title) ? candidate.title : "正在生成中文标题…");

const displaySummary = (candidate: Candidate) => candidate.briefing?.summaryZh
  ?? (containsChinese(candidate.excerpt)
    ? candidate.excerpt
    : "系统正在读取这条社区讨论并补全中文速读，你不需要再点开英文原文才能判断内容。");

const displayCommunitySummary = (candidate: Candidate) => candidate.communityInsight?.summaryZh;

const decodeCommunityText = (value: string) => value
  .replace(/&#x([0-9a-f]+);/giu, (_match, point: string) => String.fromCodePoint(Number.parseInt(point, 16)))
  .replace(/&#(\d+);/gu, (_match, point: string) => String.fromCodePoint(Number.parseInt(point, 10)))
  .replace(/&(amp|quot|apos|nbsp|lt|gt);/giu, (_match, entity: string) => ({
    amp: "&",
    quot: '"',
    apos: "'",
    nbsp: " ",
    lt: "<",
    gt: ">",
  })[entity.toLocaleLowerCase()] ?? " ");

const communityQuoteFor = (candidate: Candidate) => {
  const excerpt = decodeCommunityText(candidate.excerpt);
  const commentSection = excerpt.includes("--- Top Comments ---")
    ? excerpt.split("--- Top Comments ---").slice(1).join(" ")
    : excerpt;
  const match = commentSection.match(/\[([^\]]{1,80})\]:\s*([\s\S]+?)(?=\s+\[[^\]]{1,80}\]:|$)/u);
  if (match?.[2]?.trim().length && match[2].trim().length >= 40) {
    return { author: match[1]!.trim(), text: match[2].trim().slice(0, 320) };
  }
  const labeled = commentSection.match(/社区原句：(.{40,320})/u);
  return labeled?.[1] ? { author: candidate.author || "社区用户", text: labeled[1].trim() } : undefined;
};

const formatRelativeTime = (iso: string) => {
  const deltaHours = Math.max(0, (Date.now() - Date.parse(iso)) / 3_600_000);
  if (!Number.isFinite(deltaHours)) return "时间未知";
  if (deltaHours < 1) return `${Math.max(1, Math.round(deltaHours * 60))} 分钟前`;
  if (deltaHours < 24) return `${Math.round(deltaHours)} 小时前`;
  return `${Math.round(deltaHours / 24)} 天前`;
};

const imageFor = (candidate: Candidate) => candidate.images.find((image) => image.selected)
  ?? candidate.images[0];

const discussionUrlFor = (candidate: Candidate) => candidate.engagement?.discussionUrl || candidate.url;

const sortEntries = (items: CommunityFeedEntry[], mode: CommunitySortMode) => [...items].sort((left, right) => {
  if (mode === "hot") {
    const leftHeat = (left.candidate.engagement?.comments ?? 0) * 2 + (left.candidate.engagement?.points ?? 0);
    const rightHeat = (right.candidate.engagement?.comments ?? 0) * 2 + (right.candidate.engagement?.points ?? 0);
    return rightHeat - leftHeat || right.trendScore - left.trendScore;
  }
  if (mode === "latest") {
    return Date.parse(right.candidate.publishedAt) - Date.parse(left.candidate.publishedAt);
  }
  return right.trendScore - left.trendScore;
});

const topicLabel = (candidate: Candidate) => collectionTopics
  .filter((topic) => (candidate.topicIds ?? []).includes(topic.id))
  .slice(0, 2)
  .map((topic) => topic.label)
  .join(" · ") || "综合";

function CommunityCardActions({
  entry,
  busy,
  onFeedback,
  onDraft,
}: {
  entry: CommunityFeedEntry;
  busy: boolean;
  onFeedback: (kind: "interested" | "not_interested" | "restore") => void;
  onDraft: () => void;
}) {
  const { candidate } = entry;
  const discussionUrl = discussionUrlFor(candidate);
  const hasLinkedSource = discussionUrl !== candidate.url;
  return (
    <div className="community-card-actions">
      <a href={discussionUrl} target="_blank" rel="noreferrer">
        <MessageCircle size={14} />看讨论<ArrowUpRight size={12} />
      </a>
      {hasLinkedSource ? (
        <a href={candidate.url} target="_blank" rel="noreferrer" className="community-source-link">
          看来源<ArrowUpRight size={12} />
        </a>
      ) : null}
      <button type="button" className="community-draft-cta" onClick={onDraft}>
        <BookOpenText size={14} />放入草稿箱
      </button>
      <span className="community-feedback-buttons" aria-label="调整社区推荐">
        <button
          type="button"
          className={candidate.userFeedback === "interested" ? "active" : ""}
          disabled={busy}
          aria-label={candidate.userFeedback === "interested" ? "取消感兴趣" : "感兴趣"}
          title={candidate.userFeedback === "interested" ? "取消感兴趣" : "感兴趣，会调整后续推荐"}
          onClick={() => onFeedback(candidate.userFeedback === "interested" ? "restore" : "interested")}
        >{busy ? <LoaderCircle className="spin" size={13} /> : <ThumbsUp size={13} />}</button>
        <button
          type="button"
          disabled={busy}
          aria-label="不感兴趣"
          title="不感兴趣，这条会退出广场"
          onClick={() => onFeedback("not_interested")}
        ><ThumbsDown size={13} /></button>
      </span>
    </div>
  );
}

export function CommunitySquare({
  runs,
  sources,
  settings,
  activeProvider,
  onFeedback,
  onRestoreFeedback,
  onCreateDraft,
  onAutoBrief,
}: CommunitySquareProps) {
  const [topic, setTopic] = useState<"all" | CollectionTopicId>("all");
  const [sortMode, setSortMode] = useState<CommunitySortMode>("recommended");
  const [visibleCount, setVisibleCount] = useState(18);
  const [feedbackBusy, setFeedbackBusy] = useState<string>();
  const [selectedEntry, setSelectedEntry] = useState<CommunityFeedEntry>();
  const [briefingState, setBriefingState] = useState<"idle" | "loading" | "complete" | "error">("idle");
  const attemptedBriefings = useRef(new Set<string>());

  const feed = useMemo(() => composeCommunityFeed(runs, {
    expiryHours: 7 * 24,
    limit: 120,
    personalizationEnabled: settings.personalizationEnabled,
  }), [runs, settings.personalizationEnabled]);

  const availableTopics = useMemo(() => collectionTopics.flatMap((item) => {
    const count = feed.items.filter((entry) => candidateMatchesTopic(entry.candidate, item.id)).length;
    return count ? [{ ...item, count }] : [];
  }), [feed.items]);
  const risingCount = feed.items.filter((entry) => entry.trend?.direction === "rising").length;
  const imageReadyCount = feed.items.filter((entry) => entry.candidate.images.length > 0).length;
  const communitySources = useMemo(() => sources.filter((source) => source.role === "community"), [sources]);

  const filteredItems = useMemo(() => sortEntries(
    feed.items.filter((entry) => candidateMatchesTopic(entry.candidate, topic)),
    sortMode,
  ), [feed.items, sortMode, topic]);

  const featured = filteredItems[0];
  const recommended = filteredItems.slice(1, 5);
  const remaining = filteredItems.slice(5, visibleCount);
  const pendingBriefingRequests = useMemo(() => {
    const byRun = new Map<string, string[]>();
    for (const entry of filteredItems.slice(0, 20)) {
      if (entry.candidate.briefing && entry.candidate.communityInsight) continue;
      const ids = byRun.get(entry.runId) ?? [];
      ids.push(entry.candidate.id);
      byRun.set(entry.runId, ids);
    }
    return [...byRun].map(([runId, candidateIds]) => ({ runId, candidateIds }));
  }, [filteredItems]);

  useEffect(() => {
    if (topic !== "all" && !availableTopics.some((item) => item.id === topic)) setTopic("all");
  }, [availableTopics, topic]);
  const pendingSignature = pendingBriefingRequests
    .map((request) => `${request.runId}:${request.candidateIds.sort().join(",")}`)
    .sort()
    .join("|");

  useEffect(() => {
    if (!pendingSignature || attemptedBriefings.current.has(pendingSignature)) return;
    attemptedBriefings.current.add(pendingSignature);
    setBriefingState("loading");
    void onAutoBrief(pendingBriefingRequests)
      .then(() => setBriefingState("complete"))
      .catch(() => setBriefingState("error"));
  }, [onAutoBrief, pendingBriefingRequests, pendingSignature]);

  const updateFeedback = async (
    entry: CommunityFeedEntry,
    kind: "interested" | "not_interested" | "restore",
  ) => {
    setFeedbackBusy(entry.candidate.id);
    try {
      if (kind === "restore") await onRestoreFeedback(entry.runId, entry.candidate.id);
      else await onFeedback(entry.runId, entry.candidate.id, kind);
    } finally {
      setFeedbackBusy(undefined);
    }
  };

  const renderImage = (entry: CommunityFeedEntry, featuredImage = false) => {
    const image = imageFor(entry.candidate);
    if (!image) return (
      <div className={featuredImage ? "community-image-fallback featured" : "community-image-fallback"}>
        <MessagesSquare size={featuredImage ? 32 : 24} />
        <span>社区讨论</span>
      </div>
    );
    return (
      <figure className={featuredImage ? "community-card-image featured" : "community-card-image"}>
        <img src={image.publicPath || image.url} alt={image.caption || entry.candidate.title} loading={featuredImage ? "eager" : "lazy"} />
        <figcaption><ImageIcon size={11} />来源图片 · 发布前核权</figcaption>
      </figure>
    );
  };

  return (
    <div className="page community-square-page">
      <header className="community-square-header">
        <div>
          <span className="community-page-kicker"><MessagesSquare size={15} />COMMUNITY SIGNALS</span>
          <h1>社区广场</h1>
          <p>直接看社区正在讨论什么。后台负责更新、去重和中文速读，你只负责判断要不要做。</p>
        </div>
        <div className="community-update-state" role="status">
          {briefingState === "loading" ? <LoaderCircle className="spin" size={17} /> : <Sparkles size={17} />}
          <span>
            <strong>{briefingState === "loading" ? "正在补全社区观点" : "后台自动整理"}</strong>
            <small>{feed.lastUpdatedAt ? `最近更新 ${formatRelativeTime(feed.lastUpdatedAt)}` : "等待首批社区信号"}</small>
          </span>
        </div>
      </header>

      <section className="community-overview" aria-label="社区广场概览">
        <div><strong>{feed.items.length}</strong><span>条有效热点</span></div>
        <div><strong>{risingCount}</strong><span>条正在升温</span></div>
        <div><strong>{imageReadyCount}</strong><span>条已有原图</span></div>
        <p><TrendingUp size={16} />已利用 {feed.duplicateCount} 个历史快照计算变化，{feed.expiredCount} 条过期内容已退出。</p>
      </section>

      <section className="community-source-health" aria-label="社区来源状态">
        <span className="community-source-health-label"><Activity size={14} />来源覆盖</span>
        <div>
          {communitySources.map((source) => {
            const status = !source.enabled ? "disabled" : source.health || "unknown";
            const detail = !source.enabled
              ? "未启用"
              : source.health === "healthy"
                ? `${source.lastCandidateCount ?? 0} 条候选`
                : source.health === "error"
                  ? "需要处理"
                  : "等待更新";
            return <span key={source.id} className={`community-source-state ${status}`} title={source.lastHealthDetail || source.note}><i />{source.name}<small>{detail}</small></span>;
          })}
        </div>
      </section>

      <div className="community-filter-bar">
        <div className="community-topic-tabs" aria-label="社区话题">
          <button type="button" className={topic === "all" ? "active" : ""} onClick={() => setTopic("all")}>全部</button>
          {availableTopics.map((item) => (
            <button
              type="button"
              key={item.id}
              className={topic === item.id ? "active" : ""}
              onClick={() => setTopic(item.id)}
            >{item.label}<small>{item.count}</small></button>
          ))}
        </div>
        <div className="community-sort-tabs" aria-label="社区排序">
          <button type="button" className={sortMode === "recommended" ? "active" : ""} onClick={() => setSortMode("recommended")}><Sparkles size={13} />为你推荐</button>
          <button type="button" className={sortMode === "hot" ? "active" : ""} onClick={() => setSortMode("hot")}><Flame size={13} />讨论最热</button>
          <button type="button" className={sortMode === "latest" ? "active" : ""} onClick={() => setSortMode("latest")}><Clock3 size={13} />最新出现</button>
        </div>
      </div>

      {briefingState === "error" ? (
        <div className="community-inline-warning" role="status">
          社区观点本轮未补全；事件速读仍可浏览，后台下次进入时会再尝试。
        </div>
      ) : null}

      {!featured ? (
        <section className="community-empty-state">
          <MessagesSquare size={34} />
          <h2>当前分类还没有有效社区热点</h2>
          <p>过期内容已经自动退出；下一次后台更新后，新讨论会直接出现在这里。</p>
        </section>
      ) : (
        <>
          <section className="community-featured-section" aria-labelledby="community-featured-title">
            <div className="community-section-heading">
              <span><TrendingUp size={14} />今日置顶</span>
              <p>当前最值得你先看的社区讨论</p>
            </div>
            <article className="community-featured-card">
              {renderImage(featured, true)}
              <div className="community-featured-copy">
                <div className="community-card-meta">
                  <span className="community-platform-badge">{featured.platform}</span>
                  <span>{topicLabel(featured.candidate)}</span>
                  <span>{formatRelativeTime(featured.candidate.publishedAt)}</span>
                  <span className={featured.candidate.briefing ? "translated" : "translating"}>
                    <Languages size={11} />{featured.candidate.briefing ? "中文速读已就绪" : "中文速读生成中"}
                  </span>
                </div>
                <h2 id="community-featured-title">{displayTitle(featured.candidate)}</h2>
                <p className="community-event-summary"><strong>发生了什么：</strong>{displaySummary(featured.candidate)}</p>
                {!containsChinese(featured.candidate.title) ? <small className="community-original-title">原标题：{featured.candidate.title}</small> : null}
                {displayCommunitySummary(featured.candidate) ? (
                  <div className="community-insight-panel">
                    <span><MessagesSquare size={14} />社区怎么说</span>
                    <p>{displayCommunitySummary(featured.candidate)}</p>
                    {featured.candidate.communityInsight?.focusZh.length ? (
                      <ul>{featured.candidate.communityInsight.focusZh.map((focus) => <li key={focus}>{focus}</li>)}</ul>
                    ) : null}
                    {featured.candidate.communityInsight?.disagreementZh ? <small><strong>主要分歧：</strong>{featured.candidate.communityInsight.disagreementZh}</small> : null}
                  </div>
                ) : null}
                {communityQuoteFor(featured.candidate) ? (
                  <blockquote className="community-verbatim-quote">
                    <Quote size={14} />
                    <p>{communityQuoteFor(featured.candidate)!.text}</p>
                    <cite>— {communityQuoteFor(featured.candidate)!.author} · 原句保留</cite>
                  </blockquote>
                ) : null}
                <div className="community-reason"><Sparkles size={14} /><span><strong>为什么推荐：</strong>{featured.reason}</span></div>
                {featured.supportingSources.length ? <div className="community-supporting-sources"><BookOpenCheck size={14} /><span>已匹配 {featured.supportingSources.length} 个新闻／官方核验来源：{featured.supportingSources.map((source) => source.sourceName).join("、")}</span></div> : null}
                <div className="community-metrics">
                  <span><Flame size={14} /><strong>{featured.candidate.engagement?.points ?? "—"}</strong>积分</span>
                  <span><MessageCircle size={14} /><strong>{featured.candidate.engagement?.comments ?? "—"}</strong>讨论</span>
                  <span><ImageIcon size={14} /><strong>{featured.candidate.imageCount ?? featured.candidate.images.length}</strong>来源图片</span>
                </div>
                <CommunityCardActions
                  entry={featured}
                  busy={feedbackBusy === featured.candidate.id}
                  onFeedback={(kind) => void updateFeedback(featured, kind)}
                  onDraft={() => setSelectedEntry(featured)}
                />
              </div>
            </article>
          </section>

          {recommended.length ? (
            <section className="community-recommended-section" aria-labelledby="community-recommended-title">
              <div className="community-section-heading horizontal">
                <div><span><Sparkles size={14} />接着看</span><h2 id="community-recommended-title">其他高信号讨论</h2></div>
                <p>社区热度不是事实证明，进入草稿后仍会保留核验提示。</p>
              </div>
              <div className="community-recommended-grid">
                {recommended.map((entry) => (
                  <article className="community-recommended-card" key={`${entry.runId}:${entry.candidate.id}`}>
                    {renderImage(entry)}
                    <div className="community-recommended-copy">
                      <div className="community-card-meta">
                        <span className="community-platform-badge">{entry.platform}</span>
                        <span>{formatRelativeTime(entry.candidate.publishedAt)}</span>
                      </div>
                      <h3>{displayTitle(entry.candidate)}</h3>
                      <p>{displaySummary(entry.candidate)}</p>
                      {displayCommunitySummary(entry.candidate) ? <p className="community-card-insight"><strong>社区：</strong>{displayCommunitySummary(entry.candidate)}</p> : null}
                      {!containsChinese(entry.candidate.title) ? <small className="community-original-title">{entry.candidate.title}</small> : null}
                      <div className="community-mini-metrics">
                        <span><MessageCircle size={12} />{entry.candidate.engagement?.comments ?? "暂无"}</span>
                        <span><ImageIcon size={12} />{entry.candidate.imageCount ?? entry.candidate.images.length} 图</span>
                        <span>{entry.reason}</span>
                      </div>
                      <CommunityCardActions
                        entry={entry}
                        busy={feedbackBusy === entry.candidate.id}
                        onFeedback={(kind) => void updateFeedback(entry, kind)}
                        onDraft={() => setSelectedEntry(entry)}
                      />
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          {remaining.length ? (
            <section className="community-stream-section" aria-labelledby="community-stream-title">
              <div className="community-section-heading horizontal">
                <div><span><MessagesSquare size={14} />社区流</span><h2 id="community-stream-title">更多正在发生的讨论</h2></div>
                <p>按当前分类与排序继续浏览</p>
              </div>
              <div className="community-stream-list">
                {remaining.map((entry) => (
                  <article key={`${entry.runId}:${entry.candidate.id}`}>
                    <div className="community-stream-index" aria-hidden="true">{String(filteredItems.indexOf(entry) + 1).padStart(2, "0")}</div>
                    <div className="community-stream-copy">
                      <div className="community-card-meta">
                        <span className="community-platform-badge">{entry.platform}</span>
                        <span>{topicLabel(entry.candidate)}</span>
                        <span>{formatRelativeTime(entry.candidate.publishedAt)}</span>
                      </div>
                      <h3>{displayTitle(entry.candidate)}</h3>
                      <p>{displayCommunitySummary(entry.candidate) || displaySummary(entry.candidate)}</p>
                      {!containsChinese(entry.candidate.title) ? <small className="community-original-title">原标题：{entry.candidate.title}</small> : null}
                    </div>
                    <div className="community-stream-signals">
                      <span><Flame size={13} />{entry.candidate.engagement?.points ?? "—"}</span>
                      <span><MessageCircle size={13} />{entry.candidate.engagement?.comments ?? "—"}</span>
                      <span><ImageIcon size={13} />{entry.candidate.imageCount ?? entry.candidate.images.length}</span>
                    </div>
                    <CommunityCardActions
                      entry={entry}
                      busy={feedbackBusy === entry.candidate.id}
                      onFeedback={(kind) => void updateFeedback(entry, kind)}
                      onDraft={() => setSelectedEntry(entry)}
                    />
                  </article>
                ))}
              </div>
              {visibleCount < filteredItems.length ? (
                <button type="button" className="community-load-more" onClick={() => setVisibleCount((count) => count + 12)}>
                  继续查看 {Math.min(12, filteredItems.length - visibleCount)} 条
                </button>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {selectedEntry ? (
        <CommunityDraftModal
          candidate={selectedEntry.candidate}
          provider={activeProvider}
          onClose={() => setSelectedEntry(undefined)}
          onCreate={(candidateId, mode) => onCreateDraft(selectedEntry.runId, candidateId, mode)}
        />
      ) : null}
    </div>
  );
}
