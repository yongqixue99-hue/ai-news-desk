import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Check, ChevronDown, ExternalLink, Languages, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { AggregationView } from '../../server/aggregation-desk.js';
import type { AppPage } from '../types';
import { useAggregationReading } from '../hooks/useAggregationReading';
import { useAggregationTitleTranslations } from '../hooks/useAggregationTitleTranslations';

const date = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '日期未提供';
const statuses = {pending:'待接入',disabled:'已停用',unread:'尚未读取',ready:'读取正常',stale:'内容更新滞后',error:'读取有缺口',empty:'本次无条目'};
const channelNames = {hot:'平台热点榜',selected:'平台精选',feed:'订阅顺序'};

export function AggregationsPage({onNavigate,onNotice}:{onNavigate:(page:AppPage)=>void;onNotice:(kind:'success'|'error',message:string)=>void}) {
  const [view,setView]=useState<AggregationView>(); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const [reading,setReading]=useAggregationReading(Boolean(view));
  const {platform,query,mode,nativeChannel,limit,expanded}=reading;
  const setPlatform=(platform:string)=>setReading(s=>({...s,platform}));
  const setQuery=(query:string)=>setReading(s=>({...s,query}));
  const setMode=(mode:string)=>setReading(s=>({...s,mode}));
  const setNativeChannel=(nativeChannel:string)=>setReading(s=>({...s,nativeChannel}));
  const setLimit=(limit:number)=>setReading(s=>({...s,limit}));
  const toggleDetails=(id:string,open:boolean)=>setReading(s=>s.expanded.includes(id)===open?s:{...s,expanded:open?[...s.expanded,id].slice(-100):s.expanded.filter(v=>v!==id)});
  const [saving,setSaving]=useState('');
  const load=useCallback(async()=>{try{setView(await api.aggregations());setError('');}catch(e){setError(e instanceof Error?e.message:'暂时无法读取聚合列表');}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{if(!view?.active)return;const timer=window.setInterval(()=>void load(),3000);return()=>window.clearInterval(timer);},[load,view?.active]);
  const refresh=async()=>{setLoading(true);try{await api.refreshAggregations();await load();}catch(e){setError(e instanceof Error?e.message:'更新未成功');}finally{setLoading(false);}};
  const retain=async(id:string)=>{setSaving(id);try{await api.retainAggregation(id);await load();onNotice('success','已加入待选题，可在今日继续核验与成稿。');}catch(e){onNotice('error',e instanceof Error?e.message:'选题保存失败');}finally{setSaving('');}};
  const choosePlatform=(id:string)=>{setPlatform(id);setNativeChannel('auto');setLimit(40);};
  const platformView=view?.platforms.find(p=>p.id===platform);
  const native=view?.platformEntries[platform]||[];
  const channels=(['hot','selected','feed'] as const).filter(c=>native.some(e=>e.native?.channel===c));
  const currentChannel=nativeChannel==='auto'?channels[0]:nativeChannel;
  const pool=platform!=='all'?native.filter(e=>e.native?.channel===currentChannel)
    :mode==='recommended'?view?.recommended||[]:(view?.entries||[]).filter(e=>mode==='digest'?e.kind==='digest':e.kind==='news');
  const entries=pool.filter(e=>`${e.title} ${e.summary} ${e.event?.digest||''} ${e.event?.latest||''} ${(e.related||[]).map(r=>r.title).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const nativeStale=platform!=='all'&&currentChannel==='hot'&&native.some(e=>e.native?.channel==='hot'&&Date.now()-Date.parse(e.native.checkedAt)>6*3600000);
  const sourceIssues=view?.platforms.filter(p=>p.status==='error'||p.status==='stale').length||0;
  const translations=useAggregationTitleTranslations(entries,limit);
  return <section className="aggregation-page">
    <header className="aggregation-heading"><div><h1>聚合资讯</h1><p>各家精选与事件进展</p></div><button className="secondary-button aggregation-refresh" disabled={loading||view?.active} onClick={()=>void refresh()}><RefreshCw size={15} aria-hidden="true"/>{loading||view?.active?'正在读取…':'更新聚合资讯'}</button></header>
    <div className="aggregation-platforms" role="group" aria-label="聚合平台"><button aria-pressed={platform==='all'} onClick={()=>choosePlatform('all')}>全部平台</button>{view?.platforms.map(p=><button key={p.id} aria-label={`${p.name} ${statuses[p.status]}`} aria-pressed={platform===p.id} onClick={()=>choosePlatform(p.id)} title={statuses[p.status]}><span>{p.name}</span>{p.status==='error'||p.status==='stale'?<small className={`aggregation-status status-${p.status}`} aria-hidden="true">{p.status==='error'?'有缺口':'已滞后'}</small>:p.status==='pending'?<small className="aggregation-status status-pending" aria-hidden="true">待接入</small>:null}</button>)}</div>
    <div className="aggregation-toolbar">
      <div className="aggregation-ordering" role="group" aria-label="聚合排序方式">{platform==='all'?
        [['recommended','热点精选'],['latest','最新动态'],['digest','日报合集']].map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>{setMode(value!);setLimit(40);}}>{label}</button>)
        :channels.map(c=><button key={c} aria-pressed={currentChannel===c} onClick={()=>{setNativeChannel(c);setLimit(40);}}>{channelNames[c]}</button>)}</div>
      <label className="aggregation-search"><Search size={15} aria-hidden="true"/><input aria-label="筛选聚合资讯" type="search" placeholder="搜索标题、摘要或进展" value={query} onChange={e=>{setQuery(e.target.value);setLimit(40);}}/></label>
    </div>
    <div className="aggregation-context"><p className="aggregation-note"><strong>{entries.length} 条</strong><span>{platform==='all'?'按事件整理':platform==='aihot-news'?'AIHOT 原始顺序':'平台订阅顺序'} · 成稿前核对原文</span></p><details className="aggregation-health"><summary>来源状态{sourceIssues>0?<span className="aggregation-health-issue">{sourceIssues} 项需留意</span>:null}<ChevronDown size={13} aria-hidden="true"/></summary><div className="aggregation-health-content">{view?.platforms.map(p=><p key={p.id}><a href={p.homepage} target="_blank" rel="noreferrer">{p.name}</a><span className={`aggregation-source-status status-${p.status}`}>{statuses[p.status]}</span>{p.checkedAt?<span>最近读取 {date(p.checkedAt)}</span>:null}{p.latestAt?<span>最新内容／事件进展 {date(p.latestAt)}</span>:null}{p.detail?<span>{p.detail}</span>:null}</p>)}<button className="text-button" onClick={()=>onNavigate('sources')}>管理来源与采集开关</button></div></details></div>
    <div className="aggregation-translation-tools">
      <span className={translations.error?'aggregation-translation-error':''} role="status">{translations.error||translations.message||'手动翻译当前列表，每次最多 20 条'}</span>
      <button className="text-button" disabled={translations.busy||!translations.targets.length} onClick={()=>void translations.translate()} title="使用当前分析模型；仅翻译标题，原始记录不变"><Languages size={14} aria-hidden="true"/>{translations.busy?'正在翻译…':'翻译本页标题'}</button>
    </div>
    {nativeStale?<p className="aggregation-stale-notice" role="status">榜单快照已超过 6 小时，请更新后判断当前热度。旧排名不参与汇总热度加分。</p>:null}
    {error?<div role="alert" className="topic-connection-state">{error}<button className="text-button" onClick={()=>void load()}>重试读取列表</button></div>:null}
    {!view&&!error?<p role="status">正在读取已保存的聚合资讯…</p>:null}
    {view&&!entries.length?<div className="topic-feed-empty"><h2>{platformView?.status==='pending'?'此平台尚待接入':query?'没有匹配内容':platform==='all'&&mode==='recommended'?'暂时没有符合精选条件的新闻':'这里还没有聚合条目'}</h2><p>{platformView?.status==='pending'?'可从来源状态打开网站阅读，当前不会自动采集。':platform==='all'&&mode==='recommended'?'可切换最新动态或日报合集查看全部内容，不用普通动态凑满精选。':'可更新已启用的平台，或调整筛选。读取失败不会当作没有新闻。'}</p></div>:null}
    <div className="aggregation-list" aria-busy={loading||view?.active}>{entries.slice(0,limit).map(entry=>{const translated=translations.forEntry(entry);return <article key={entry.id} data-aggregation-id={entry.id} className="aggregation-row">
      <div className="aggregation-meta"><span>{entry.platforms.map(p=>p.name).join(' · ')}</span><span>{entry.kind==='digest'?'日报 / 合集':'新闻线索'}</span><time>{entry.publishedAt?'来源日期':entry.eventUpdatedAt?'平台事件进展':'来源日期'} {date(entry.publishedAt||entry.eventUpdatedAt)}</time>{entry.native?.rank?<span>AIHOT 热榜 #{entry.native.rank}</span>:null}</div>
      <h2><a href={entry.url} target="_blank" rel="noreferrer">{translated?.titleZh||entry.title}</a></h2>
      {translated?<p className="aggregation-original-title"><span className="aggregation-machine-label" title={`${translated.model} · ${date(translated.translatedAt)}`}>机器翻译</span><span>原题：{entry.title}</span></p>:null}
      {entry.event?.digest?<span className="aggregation-attribution">AIHOT 事件摘要</span>:null}
      <p id={`digest-${entry.id}`} className={`aggregation-summary${(entry.event?.digest?.length||0)>240&&!expanded.includes(`digest:${entry.id}`)?' is-collapsed':''}`}>{entry.event?.digest||entry.summary||'平台未提供摘要，请打开来源阅读。'}</p>
      {(entry.event?.digest?.length||0)>240?<button className="aggregation-expand" aria-expanded={expanded.includes(`digest:${entry.id}`)} aria-controls={`digest-${entry.id}`} onClick={()=>toggleDetails(`digest:${entry.id}`,!expanded.includes(`digest:${entry.id}`))}>{expanded.includes(`digest:${entry.id}`)?'收起摘要':'展开完整摘要'}</button>:null}
      {entry.event?.latest&&entry.event.latest!==entry.event.digest?<p className="aggregation-latest"><span>最新进展</span>{entry.event.latest}</p>:null}
      <div className="aggregation-row-footer"><details className="aggregation-related" open={expanded.includes(entry.id)} onToggle={e=>toggleDetails(entry.id,e.currentTarget.open)}>
        <summary>报道与依据{entry.event?.sourceCount!==undefined?` · AIHOT 收录 ${entry.event.sourceCount} 家来源`:''}<ChevronDown size={13} aria-hidden="true"/></summary>
        {entry.event?.updatedAt?<p className="aggregation-snapshot">AIHOT 摘要更新于 {date(entry.event.updatedAt)}</p>:null}
        {entry.event?.reports.map(r=><p key={r.url}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.source}</p>)}
        {entry.related?.filter(r=>!entry.event?.reports.some(report=>report.url===r.url)).map(r=><p key={r.id}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.platform}</p>)}
        {entry.event?<p className="aggregation-snapshot">平台收录数量不代表独立事实核验。{entry.event.reportCount!==undefined?`共收录 ${entry.event.reportCount} 篇报道。`:''}</p>:null}
        {platform==='all'&&mode==='recommended'?<p className="aggregation-reason">推荐依据：{entry.ranking?.reasons.join(' · ')}</p>:entry.native?.reason?<p className="aggregation-reason">{entry.platforms[0]?.name} 推荐理由：{entry.native.reason}{entry.native.score!==undefined?`（平台评分 ${entry.native.score}/100，非热度分）`:''}</p>:null}
        {entry.native?<p className="aggregation-snapshot">本条快照读取于 {date(entry.native.checkedAt)}</p>:null}
        <div className="aggregation-source-links">{entry.platforms.map(p=><a key={p.id} href={p.url} target="_blank" rel="noreferrer">在 {p.name} 阅读 <ExternalLink size={13}/></a>)}</div>
      </details>
      <div className="aggregation-actions"><a href={entry.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={13} aria-hidden="true"/></a><button className="text-button" disabled={Boolean(saving)||entry.selected} onClick={()=>void retain(entry.id)}>{entry.selected?<Check size={14} aria-hidden="true"/>:<Bookmark size={14} aria-hidden="true"/>} {entry.selected?'已留待选题':saving===entry.id?'正在保存…':'留作选题'}</button></div></div>
    </article>;})}</div>
    {entries.length>limit?<button className="secondary-button" onClick={()=>setLimit(limit+40)}>再看 40 条</button>:null}
  </section>;
}
