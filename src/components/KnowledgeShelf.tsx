import { useState } from "react";
import { ArrowRight, BookOpen, Search } from "lucide-react";
import type { StoryView } from "../types";

export function KnowledgeShelf({ stories, onOpen }: { stories: StoryView[]; onOpen: (story: StoryView) => void }) {
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("all");
  const [expanded, setExpanded] = useState(false);
  const matching = stories.filter(story => `${story.title} ${story.originalTitle} ${story.signals[0]?.sourceName}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
    && (difficulty === "all" || (difficulty === "practical" ? story.technicalArticle?.complexity !== "advanced" : story.technicalArticle?.complexity === "advanced")));
  return <section className="knowledge-shelf" aria-label="官方技术待选库">
    <header><div><span className="knowledge-eyebrow"><BookOpen size={15} />官方技术待选库 · {stories.length}</span><h2>值得学，也值得写</h2><p>沿用官方教程的结构与原图。先读原文，再决定做忠实整理还是通俗导读。</p></div></header>
    <div className="knowledge-controls"><label><Search size={16} /><input aria-label="搜索技术文章" placeholder="搜索教程、工具或厂商" value={query} onChange={event => { setQuery(event.target.value); setExpanded(false); }} /></label><select aria-label="技术文章难度" value={difficulty} onChange={event => setDifficulty(event.target.value)}><option value="all">全部难度</option><option value="practical">入门与实践</option><option value="advanced">专业深读</option></select></div>
    <div className="knowledge-list">{matching.slice(0, expanded ? matching.length : 6).map(story => <button type="button" key={story.id} className="knowledge-entry" onClick={() => onOpen(story)}>
      <div><small>{story.signals.find(signal => !signal.isCommunity)?.sourceName || "官方资料"}<span>{story.technicalArticle?.label}</span>{story.drafted ? <span>已有草稿</span> : story.selected ? <span>已待选</span> : null}</small><h3>{story.title}</h3><p>{story.technicalArticle?.reason}</p><footer>{story.publicationDateKnown === false ? "日期待读取核对" : `原文日期 ${new Date(story.publishedAt).toLocaleDateString("zh-CN")}`}<span>{story.localImageCount ?? 0} 张已缓存原图</span></footer></div><ArrowRight size={18} />
    </button>)}</div>
    {!matching.length ? <p className="knowledge-empty">{stories.length ? "没有符合筛选条件的技术文章。" : "读取 OpenAI Cookbook、Anthropic Engineering 和 Claude Cookbook 后，文章会进入这里。可在信息源中启用或停用。"}</p> : null}
    {matching.length > 6 ? <button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : `查看全部 ${matching.length} 篇`}</button> : null}
  </section>;
}
