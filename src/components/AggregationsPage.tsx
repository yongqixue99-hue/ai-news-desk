import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Check, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { AggregationView } from '../../server/aggregation-desk.js';
import type { AppPage } from '../types';
import './aggregations.css';

const date = (value?: string) => value && Number.isFinite(Date.parse(value))
  ? new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '日期未提供';
const statuses = {pending:'待接入',disabled:'已停用',unread:'尚未读取',ready:'读取正常',stale:'内容更新滞后',error:'读取有缺口',empty:'本次无条目'};
const channelNames = {hot:'平台热点榜',selected:'平台精选',feed:'订阅顺序'};

export function AggregationsPage({onNavigate,onNotice}:{onNavigate:(page:AppPage)=>void;onNotice:(kind:'success'|'error',message:string)=>void}) {
  const [view,setView]=useState<AggregationView>(); const [error,setError]=useState(''); const [loading,setLoading]=useState(false);
  const [platform,setPlatform]=useState('all'); const [query,setQuery]=useState(''); const [mode,setMode]=useState('recommended');
  const [nativeChannel,setNativeChannel]=useState('auto'); const [limit,setLimit]=useState(40); const [saving,setSaving]=useState('');
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
  const entries=pool.filter(e=>`${e.title} ${e.summary} ${(e.related||[]).map(r=>r.title).join(' ')}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const nativeStale=platform!=='all'&&currentChannel==='hot'&&native.some(e=>e.native?.channel==='hot'&&Date.now()-Date.parse(e.native.checkedAt)>6*3600000);
  return <section className="aggregation-page">
    <header className="aggregation-heading"><div><span className="desk-eyebrow">平台精选 · 直接阅读</span><h1>聚合资讯</h1><p>先看重要进展，再看各家的选择。</p></div><button className="primary-button" disabled={loading||view?.active} onClick={()=>void refresh()}><RefreshCw size={16}/>{loading||view?.active?'正在读取…':'更新聚合资讯'}</button></header>
    <div className="aggregation-platforms" role="group" aria-label="聚合平台"><button aria-pressed={platform==='all'} onClick={()=>choosePlatform('all')}>全部平台</button>{view?.platforms.map(p=><button key={p.id} aria-pressed={platform===p.id} onClick={()=>choosePlatform(p.id)}>{p.name}<small className={`aggregation-status status-${p.status}`}>{statuses[p.status]}</small></button>)}</div>
    <div className="aggregation-ordering">
      <strong>{platform==='all'?'工作台组织':`${platformView?.name||''} 原生组织`}</strong>
      <p>{platform==='all'?'热点精选综合具体变化、平台热点信号与 48 小时时效；相近事件合并，普通动态与日报分开查看。'
        :platform==='aihot-news'?'热点榜按 AIHOT 排名；精选与动态按平台返回顺序。不混入其他平台的内容或工作台评分。'
        :'按该平台提供的订阅顺序展示，保留本平台标题与摘要；尚未取得站内投票或热榜排名，不模拟热榜。'}</p>
      <div role="group" aria-label="聚合排序方式">{platform==='all'?
        [['recommended','热点精选'],['latest','最新动态'],['digest','日报合集']].map(([value,label])=><button key={value} aria-pressed={mode===value} onClick={()=>{setMode(value!);setLimit(40);}}>{label}</button>)
        :channels.map(c=><button key={c} aria-pressed={currentChannel===c} onClick={()=>{setNativeChannel(c);setLimit(40);}}>{channelNames[c]}</button>)}</div>
      {nativeStale?<p role="status">榜单快照已超过 6 小时，请更新后判断当前热度。旧排名不参与汇总热度加分。</p>:null}
    </div>
    <details className="aggregation-health"><summary>来源状态与读取时间</summary>{view?.platforms.map(p=><p key={p.id}><a href={p.homepage} target="_blank" rel="noreferrer">{p.name}</a> · {statuses[p.status]}{p.checkedAt?` · 最近读取 ${date(p.checkedAt)}`:''}{p.latestAt?` · 最新内容／事件进展 ${date(p.latestAt)}`:''}{p.detail?` · ${p.detail}`:''}</p>)}<button className="text-button" onClick={()=>onNavigate('sources')}>管理来源与采集开关</button></details>
    <div className="aggregation-filters"><label><Search size={16}/><input aria-label="筛选聚合资讯" type="search" placeholder="搜索当前列表；更多线索可切换最新动态" value={query} onChange={e=>{setQuery(e.target.value);setLimit(40);}}/></label><span>{entries.length} 条</span></div>
    <p className="aggregation-note">保留平台原摘要，未重新生成。多个平台收录不等于独立证实；成稿前核验原文。</p>
    {error?<div role="alert" className="topic-connection-state">{error}<button className="text-button" onClick={()=>void load()}>重试读取列表</button></div>:null}
    {!view&&!error?<p role="status">正在读取已保存的聚合资讯…</p>:null}
    {view&&!entries.length?<div className="topic-feed-empty"><h2>{platformView?.status==='pending'?'此平台尚待接入':query?'没有匹配内容':platform==='all'&&mode==='recommended'?'暂时没有符合精选条件的新闻':'这里还没有聚合条目'}</h2><p>{platformView?.status==='pending'?'可从来源状态打开网站阅读，当前不会自动采集。':platform==='all'&&mode==='recommended'?'可切换最新动态或日报合集查看全部内容，不用普通动态凑满精选。':'可更新已启用的平台，或调整筛选。读取失败不会当作没有新闻。'}</p></div>:null}
    <div className="aggregation-list" aria-busy={loading||view?.active}>{entries.slice(0,limit).map(entry=><article key={entry.id} className="aggregation-row">
      <div className="aggregation-meta"><span>{entry.platforms.map(p=>p.name).join(' · ')}</span><span>{entry.kind==='digest'?'日报 / 合集':'新闻线索'}</span><time>{entry.publishedAt?'来源日期':entry.eventUpdatedAt?'平台事件进展':'来源日期'} {date(entry.publishedAt||entry.eventUpdatedAt)}</time>{entry.native?.rank?<span>AIHOT 热榜 #{entry.native.rank}</span>:null}</div>
      <h2><a href={entry.url} target="_blank" rel="noreferrer">{entry.title}</a></h2>
      <p className="aggregation-summary">{entry.summary||'平台未提供摘要，请打开来源阅读。'}</p>
      {platform==='all'&&mode==='recommended'?<p className="aggregation-reason">推荐依据：{entry.ranking?.reasons.join(' · ')}</p>:entry.native?.reason?<p className="aggregation-reason">{entry.platforms[0]?.name} 推荐理由：{entry.native.reason}{entry.native.score!==undefined?`（平台评分 ${entry.native.score}/100，非热度分）`:''}</p>:null}
      {platform!=='all'&&entry.native?<p className="aggregation-snapshot">本条快照读取于 {date(entry.native.checkedAt)}</p>:null}
      {entry.related?.length?<details className="aggregation-related"><summary>同一事件的其他报道 · {entry.related.length}</summary>{entry.related.map(r=><p key={r.id}><a href={r.url} target="_blank" rel="noreferrer">{r.title}</a> · {r.platform}</p>)}</details>:null}
      <div className="aggregation-actions">{entry.platforms.map(p=><a key={p.id} href={p.url} target="_blank" rel="noreferrer">在 {p.name} 阅读 <ExternalLink size={13}/></a>)}{entry.platforms.some(p=>p.url!==entry.url)?<a href={entry.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={13}/></a>:null}<button className="text-button" disabled={Boolean(saving)||entry.selected} onClick={()=>void retain(entry.id)}>{entry.selected?<Check size={14}/>:<Bookmark size={14}/>} {entry.selected?'已留待选题':saving===entry.id?'正在保存…':'留作选题'}</button></div>
    </article>)}</div>
    {entries.length>limit?<button className="secondary-button" onClick={()=>setLimit(n=>n+40)}>再看 40 条</button>:null}
  </section>;
}
