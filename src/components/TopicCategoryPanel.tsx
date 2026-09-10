import { useReaderHistory } from "../hooks/useReaderHistory";
import { useDialogA11y } from "../hooks/useDialogA11y";
import { absoluteTime, readingScope } from "./StoryReader";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, Check, ChevronDown, ExternalLink, Plus, RefreshCw, Search, X } from "lucide-react";
import { api } from "../api";
import type { AppPage, StoryView } from "../types";
import type { CommunityPlatform, TopicFeedItem, TopicFeedView } from "../../server/topic-feeds.js";

import { defaultHomeLayout, matchesHomeKeyword, type HomeColumn } from "../../server/home-layout.js";

export function TopicCategoryTabs({ value, columns = defaultHomeLayout.columns, onChange, onCustomize }: { value: string; columns?: HomeColumn[]; onChange: (value: string) => void; onCustomize: () => void }) {
  const menuRef = useRef<HTMLDetailsElement>(null);
  const common = columns.slice(0, 5);
  const overflow = columns.slice(5);
  const visible = overflow.some(c => c.id === value) ? [...common.slice(0, 4), columns.find(c => c.id === value)!] : common;
  return <div className="topic-category-bar"><div className="topic-category-tabs" role="tablist" aria-label="选题分类">
    {columns.map(category => <button key={category.id} type="button" className={visible.includes(category) ? "" : "topic-overflow-tab"} role="tab" id={`topic-tab-${category.id}`}
      aria-selected={value === category.id} aria-controls={`topic-panel-${category.id}`} tabIndex={value === category.id ? 0 : -1}
      onClick={() => onChange(category.id)} onKeyDown={event => {
        const candidates = window.matchMedia("(max-width: 720px)").matches ? columns : visible;
        const index = candidates.indexOf(category);
        const next = event.key === "ArrowRight" ? (index + 1) % candidates.length : event.key === "ArrowLeft" ? (index + candidates.length - 1) % candidates.length : event.key === "Home" ? 0 : event.key === "End" ? candidates.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); document.getElementById(`topic-tab-${candidates[next]!.id}`)?.focus();
      }}>{category.label}</button>)}
  </div>{overflow.length ? <details className="topic-more" ref={menuRef} onKeyDown={e => { if (e.key === "Escape") { menuRef.current?.removeAttribute("open"); menuRef.current?.querySelector("summary")?.focus(); } }}><summary>更多<ChevronDown size={14} /></summary><div>{columns.map(column => <button key={column.id} type="button" aria-current={column.id === value ? "true" : undefined} onClick={() => { onChange(column.id); menuRef.current?.removeAttribute("open"); window.requestAnimationFrame(() => document.getElementById(`topic-tab-${column.id}`)?.focus()); }}>{column.label}</button>)}</div></details> : null}<button type="button" className="topic-customize-button" aria-label="自定义栏目" title="添加、移除或排列栏目" onClick={onCustomize}><Plus size={20} /></button></div>;
}

interface Props {
  platform: CommunityPlatform;
  columnId?: string;
  keyword?: string;
  onOpenStory: (story: StoryView) => void;
  onChanged: () => void;
  onNavigate: (page: AppPage) => void;
  onNotice: (kind: "success" | "error", message: string) => void;
}
const names: Record<CommunityPlatform, string> = { zhihu: "知乎热榜", hackernews: "Hacker News 讨论", v2ex: "V2EX 热门主题", github: "GitHub 项目发现" };
const techTerms = /\b(?:ai|llm|gpt|claude|gemini|openai|deepseek|agent|gpu|cpu|nvidia|apple|google|github|api|rag|codex)\b|人工智能|大模型|智能体|科技|编程|程序员|开发者|芯片|算力|软件|算法|机器人|自动驾驶|互联网|手机|电脑|数码|半导体|服务器|数据中心|苹果|华为|英伟达|量子|航天/iu;
const timeLabel = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? absoluteTime(value) : "尚无读取记录";

export function TopicCategoryPanel({ platform, columnId = platform, keyword, onOpenStory, onChanged, onNavigate, onNotice }: Props) {
  const [feed, setFeed] = useState<TopicFeedView>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [query, setQuery] = useState("");
  const [techOnly, setTechOnly] = useState(platform === "zhihu");
  const [busy, setBusy] = useState<string>();
  const [headline, setHeadline] = useState<TopicFeedItem>();
  const [clock, setClock] = useState(Date.now());
  const alive = useRef(false);
  const requestId = useRef(0);
  const load = useCallback(async (refresh = false) => {
    const id = ++requestId.current;
    setLoading(true); setError(undefined);
    try {
      const next = refresh && platform === "zhihu" ? await api.refreshZhihuHotlist() : await api.topicFeed(platform);
      if (alive.current && id === requestId.current) { setFeed(next); setClock(Date.now()); }
    } catch {
      if (alive.current && id === requestId.current) setError("这个分类暂时未能读取，请稍后重试。");
    } finally { if (alive.current && id === requestId.current) setLoading(false); }
  }, [platform]);
  useEffect(() => { alive.current = true; void load(); return () => { alive.current = false; requestId.current++; }; }, [load]);
  useEffect(() => {
    if (!feed?.retryAt || Date.parse(feed.retryAt) <= Date.now()) return;
    const interval = window.setInterval(() => { setClock(Date.now()); if (Date.parse(feed.retryAt!) <= Date.now()) window.clearInterval(interval); }, 1_000);
    return () => window.clearInterval(interval);
  }, [feed?.retryAt]);
  const waitSeconds = feed?.retryAt ? Math.max(0, Math.ceil((Date.parse(feed.retryAt) - clock) / 1000)) : 0;
  const items = (feed?.items ?? []).filter((item) => matchesHomeKeyword([item.title, item.originalTitle, item.summary], keyword) && (!techOnly || techTerms.test(`${item.title} ${item.originalTitle ?? ""}`))
    && `${item.title} ${item.originalTitle ?? ""} ${item.summary ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const act = async (item: TopicFeedItem, action: "open" | "save") => {
    setBusy(item.id);
    try {
      if (action === "save") {
        if (platform === "zhihu") await api.retainZhihuTopic(item.id);
        else if (item.runId && item.candidateId) await api.selectCandidate(item.runId, item.candidateId, true);
        if (!alive.current) return;
        setFeed((current) => current ? { ...current, items: current.items.map((entry) => entry.id === item.id ? { ...entry, selected: true } : entry) } : current);
        setHeadline(current => current?.id === item.id ? { ...current, selected: true } : current);
        onChanged(); onNotice("success", "已加入待选题，可从右侧继续核对材料。");
      } else if (item.runId && item.candidateId) {
        const intake = await api.editorialIntake(item.runId, item.candidateId);
        if (alive.current) onOpenStory(intake.story);
      } else if (action === "open") setHeadline(item);
    } catch { if (alive.current) onNotice("error", "选题暂时未能打开或保存，请重试。"); }
    finally { if (alive.current) setBusy(undefined); }
  };

  return <section className="topic-category-panel" role="tabpanel" id={`topic-panel-${columnId}`} aria-labelledby={`topic-tab-${columnId}`} tabIndex={0}>
    <div className="topic-feed-heading"><div><span className="desk-eyebrow">{platform === "zhihu" ? "发现读者关心的问题" : platform === "github" ? "工具与项目线索" : "从讨论发现选题"}</span>
      <h2>{names[platform]}{keyword ? ` · ${keyword}` : ""}</h2></div>
      <button type="button" className="text-button" disabled={loading || (platform === "zhihu" && waitSeconds > 0)} onClick={() => void load(true)}>
        <RefreshCw size={14} className={loading ? "spin" : ""} />{loading ? "读取中" : platform === "zhihu" ? waitSeconds > 0 ? `${waitSeconds} 秒后可重试` : "读取热榜" : "更新列表"}</button>
    </div>
    <div className="topic-feed-meta"><span>{platform === "zhihu" ? "保留原榜排名" : "已采集的近 7 天线索及保留选题"}{feed?.updatedAt ? ` · ${timeLabel(feed.updatedAt)}` : ""}</span>
      {feed?.status === "stale" ? <strong>旧快照</strong> : null}</div>
    <div className="topic-feed-filters"><label className="topic-filter-input"><Search size={15} /><input type="search" aria-label={`筛选${names[platform]}`} placeholder="筛选当前列表" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {platform === "zhihu" ? <label className="topic-tech-filter"><input type="checkbox" checked={techOnly} onChange={(event) => setTechOnly(event.target.checked)} />仅 AI / 科技</label> : null}</div>
    {error || feed?.error ? <div className="topic-connection-state" role="status"><strong>{feed?.items.length ? "本次刷新未成功，保留上次内容" : platform === "zhihu" ? "知乎连接待恢复" : "当前分类暂时不可用"}</strong><p>{error || feed?.error}</p></div> : null}
    {feed?.status === "stale" ? <p className="reader-help">当前显示上次快照，日期未重新标成现在；可显式刷新。</p> : null}
    {loading && !feed ? <p className="topic-feed-empty" role="status">正在读取已保存的选题…</p> : null}
    {!loading && !items.length ? <div className="topic-feed-empty"><h3>{feed?.items.length ? "没有匹配的选题" : feed?.status === "empty" ? "本次读取没有选题" : platform === "zhihu" ? "先读取一份真实热榜" : "还没有这个来源的选题"}</h3>
      <p>{feed?.items.length ? keyword ? "可以调整临时筛选，或在右上方 ＋ 中修改栏目关键词。" : "可以清除筛选，查看本次保存的全部内容。" : feed?.status === "empty" ? "本次保存的数据没有符合范围的条目，可稍后刷新。" : platform === "zhihu" ? "连接成功后，问题会出现在这里。" : "可在新闻工作台选择该来源采集，再回到这里浏览。"}</p>
      {feed?.items.length && (query.trim() || techOnly) ? <button type="button" className="text-button" onClick={() => { setQuery(""); setTechOnly(false); }}>清除临时筛选 <ArrowRight size={14} /></button>
        : platform !== "zhihu" ? <button type="button" className="text-button" onClick={() => onNavigate("workbench")}>去读取来源 <ArrowRight size={14} /></button> : null}</div> : null}
    <div className="topic-feed-list" aria-busy={loading}>
      {items.map((item) => <article className="topic-feed-row" key={item.id}>
        {item.rank ? <span className="topic-original-rank" aria-label={`原榜第 ${item.rank} 位`}>{String(item.rank).padStart(2, "0")}</span> : null}
        <div><div className="topic-row-meta"><span>{item.rank ? `原榜 ${item.rank}` : names[platform]}</span><span>{item.metric || "热度未知"}</span><time title={absoluteTime(item.observedAt)}>快照：{timeLabel(item.observedAt)}</time><span>{readingScope(item.basis)}</span></div>
          <h3><button type="button" disabled={Boolean(busy)} onClick={() => void act(item, "open")}>{item.title}</button></h3>
          {item.originalTitle ? <p className="topic-original-title">{item.originalTitle}</p> : null}
          {item.summary ? <p className="topic-row-summary">{item.summary}</p> : null}
          {item.supportingSources?.length || item.metricBasis ? <details className="topic-evidence-detail"><summary>查看关联材料与热度依据</summary>{item.metricBasis ? <p>{item.metricBasis}</p> : null}{item.supportingSources?.map(source => <p key={`${source.runId}:${source.candidateId}`}><a href={source.url} target="_blank" rel="noreferrer">{source.sourceName} · {source.title}</a></p>)}</details> : null}
          <div className="topic-row-actions"><button className="text-button" disabled={Boolean(busy)} onClick={() => void act(item, "open")}>阅读并核对</button><a href={item.discussionUrl || item.url} target="_blank" rel="noreferrer">{platform === "github" ? "查看项目" : "查看原帖"}<ExternalLink size={13} /></a>
            <button type="button" className="text-button" disabled={Boolean(busy) || item.selected} onClick={() => void act(item, "save")}>{item.selected ? <Check size={14} /> : <Bookmark size={14} />}{item.selected ? "已留待选题" : busy === item.id ? "处理中…" : "留作选题"}</button></div>
        </div>
      </article>)}
    </div>
    <p className="topic-feed-footnote">{platform === "zhihu" ? "回答总数是平台统计；回答正文与观点尚需读取和核对。" : platform === "github" ? "这里展示已发现的项目，不代表 GitHub Trending 的实时榜单。" : "讨论帮助发现选题；新闻事实以原始来源为准。"}</p>
    {headline ? <HeadlineReader item={headline} platform={names[platform]} busy={Boolean(busy)} onClose={() => setHeadline(undefined)} onSave={() => void act(headline, "save")} /> : null}
  </section>;
}

function HeadlineReader({ item, platform, busy, onClose, onSave }: { item: TopicFeedItem; platform: string; busy: boolean; onClose: () => void; onSave: () => void }) {
  useReaderHistory(onClose);
  const ref = useDialogA11y<HTMLElement>({ open: true, onClose });
  useEffect(() => { const old = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = old; }; }, []);
  return <div className="story-drawer-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}><section ref={ref} className="story-drawer a1-reader headline-reader" role="dialog" aria-modal="true" aria-labelledby="headline-title" tabIndex={-1}>
    <header className="story-drawer-header"><div><div className="today-story-kicker"><span>{platform}</span><span>仅标题</span><span>{item.metric || "热度未知"}</span></div><h2 id="headline-title">{item.title}</h2></div><button className="icon-button" aria-label="关闭事件详情" onClick={onClose}><X size={20} /></button></header>
    <div className="story-drawer-body"><article className="reader-canvas"><h3>原始线索</h3><p className="reader-lead">{item.title}</p><div className="reader-limit"><strong>正文尚未读取</strong><p>目前只保存榜单标题。实际读取回答 0 条，回答总数不能代表观点样本；这条线索还不能直接生成可交付文章。</p></div><p>快照时间：{absoluteTime(item.observedAt)}</p><a href={item.url} target="_blank" rel="noreferrer">打开原帖核对 <ExternalLink size={15} /></a></article></div>
    <footer className="story-drawer-footer"><span className="story-footer-note">保留后可从同一待选题队列继续处理</span><button className="secondary-button" disabled={busy || item.selected} onClick={onSave}>{item.selected ? <><Check size={15} />已保留</> : "留作选题"}</button><button className="primary-button" disabled>材料不足，暂不能写作</button></footer>
  </section></div>;
}
