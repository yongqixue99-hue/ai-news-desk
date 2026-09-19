import { useCallback, useEffect, useState } from 'react';
import { Bookmark, Check, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { api } from '../api';
import type { AggregationView } from '../../server/aggregation-desk.js';
import type { AppPage } from '../types';
import './aggregations.css';
const date=(value?:string)=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}):'日期未提供';
const statuses={pending:'待接入',disabled:'已停用',unread:'尚未读取',ready:'读取正常',stale:'内容更新滞后',error:'读取有缺口',empty:'本次无条目'};
export function AggregationsPage({onNavigate,onNotice}:{onNavigate:(page:AppPage)=>void;onNotice:(kind:'success'|'error',message:string)=>void}){
 const [view,setView]=useState<AggregationView>();const [error,setError]=useState('');const [loading,setLoading]=useState(false);
 const [platform,setPlatform]=useState('all');const [query,setQuery]=useState('');const [kind,setKind]=useState('all');const [limit,setLimit]=useState(40);const [saving,setSaving]=useState('');
 const load=useCallback(async()=>{try{setView(await api.aggregations());setError('');}catch(e){setError(e instanceof Error?e.message:'暂时无法读取聚合列表');}},[]);
 useEffect(()=>{void load();},[load]);
 useEffect(()=>{if(!view?.active)return;const timer=window.setInterval(()=>void load(),3000);return()=>window.clearInterval(timer);},[load,view?.active]);
 const refresh=async()=>{setLoading(true);try{await api.refreshAggregations();await load();}catch(e){setError(e instanceof Error?e.message:'更新未成功');}finally{setLoading(false);}};
 const retain=async(id:string)=>{setSaving(id);try{await api.retainAggregation(id);await load();onNotice('success','已加入待选题，可在今日继续核验与成稿。');}catch(e){onNotice('error',e instanceof Error?e.message:'选题保存失败');}finally{setSaving('');}};
 const entries=(view?.entries||[]).filter(e=>(platform==='all'||e.platforms.some(p=>p.id===platform))&&(kind==='all'||e.kind===kind)&&`${e.title} ${e.summary}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
 return <section className="aggregation-page">
  <header className="aggregation-heading"><div><span className="desk-eyebrow">平台精选 · 直接阅读</span><h1>聚合资讯</h1><p>先看各家选了什么，再把值得写的内容留下。</p></div><button className="primary-button" disabled={loading||view?.active} onClick={()=>void refresh()}><RefreshCw size={16}/>{loading||view?.active?'正在读取…':'更新聚合资讯'}</button></header>
  <div className="aggregation-platforms" role="group" aria-label="聚合平台"><button aria-pressed={platform==='all'} onClick={()=>{setPlatform('all');setLimit(40);}}>全部平台</button>{view?.platforms.map(p=><button key={p.id} aria-pressed={platform===p.id} onClick={()=>{setPlatform(p.id);setLimit(40);}}>{p.name}<small className={`aggregation-status status-${p.status}`}>{statuses[p.status]}</small></button>)}</div>
  <details className="aggregation-health"><summary>来源状态与读取时间</summary>{view?.platforms.map(p=><p key={p.id}><a href={p.homepage} target="_blank" rel="noreferrer">{p.name}</a> · {statuses[p.status]}{p.checkedAt?` · 最近读取 ${date(p.checkedAt)}`:''}{p.latestAt?` · 最新内容 ${date(p.latestAt)}`:''}{p.detail?` · ${p.detail}`:''}</p>)}<button className="text-button" onClick={()=>onNavigate('sources')}>管理来源与采集开关</button></details>
  <div className="aggregation-filters"><label><Search size={16}/><input aria-label="筛选聚合资讯" type="search" placeholder="搜索当前摘要、模型或项目" value={query} onChange={e=>{setQuery(e.target.value);setLimit(40);}}/></label><select aria-label="聚合内容类型" value={kind} onChange={e=>{setKind(e.target.value);setLimit(40);}}><option value="all">全部内容</option><option value="news">新闻条目</option><option value="digest">日报与合集</option></select><span>{entries.length} 条</span></div>
  <p className="aggregation-note">保留平台原摘要，未重新生成。多个平台收录不等于独立证实；成稿前核验原文。</p>
  {error?<div role="alert" className="topic-connection-state">{error}<button className="text-button" onClick={()=>void load()}>重试读取列表</button></div>:null}
  {!view&&!error?<p role="status">正在读取已保存的聚合资讯…</p>:null}
  {view&&!entries.length?<div className="topic-feed-empty"><h2>{platform!=='all'&&view.platforms.find(p=>p.id===platform)?.status==='pending'?'此平台尚待接入':query?'没有匹配内容':'这里还没有聚合条目'}</h2><p>{platform!=='all'&&view.platforms.find(p=>p.id===platform)?.status==='pending'?'可从来源状态打开网站阅读，当前不会自动采集。':'可更新已启用的平台，或调整筛选。读取失败不会当作没有新闻。'}</p></div>:null}
  <div className="aggregation-list" aria-busy={loading||view?.active}>{entries.slice(0,limit).map(entry=><article key={entry.id} className="aggregation-row"><div className="aggregation-meta"><span>{entry.platforms.map(p=>p.name).join(' · ')}</span><span>{entry.kind==='digest'?'日报 / 合集':'新闻线索'}</span><time>来源日期 {date(entry.publishedAt)}</time>{entry.publishedAt&&Date.now()-Date.parse(entry.publishedAt)>3*86400000?<span>较早内容</span>:null}</div><h2><a href={entry.url} target="_blank" rel="noreferrer">{entry.title}</a></h2><p className="aggregation-summary">{entry.summary||'平台未提供摘要，请打开来源阅读。'}</p><div className="aggregation-actions">{entry.platforms.map(p=><a key={p.id} href={p.url} target="_blank" rel="noreferrer">在 {p.name} 阅读 <ExternalLink size={13}/></a>)}{entry.platforms.some(p=>p.url!==entry.url)?<a href={entry.url} target="_blank" rel="noreferrer">查看原文 <ExternalLink size={13}/></a>:null}<button className="text-button" disabled={Boolean(saving)||entry.selected} onClick={()=>void retain(entry.id)}>{entry.selected?<Check size={14}/>:<Bookmark size={14}/>} {entry.selected?'已留待选题':saving===entry.id?'正在保存…':'留作选题'}</button></div></article>)}</div>
  {entries.length>limit?<button className="secondary-button" onClick={()=>setLimit(n=>n+40)}>再看 40 条</button>:null}
 </section>;
}
