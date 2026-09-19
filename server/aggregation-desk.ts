import { isIP } from 'node:net';
import { isDisallowedRemoteAddress } from './remote-url.js';
import { createHash } from 'node:crypto';
import { aggregationCatalog, aggregationSourceIds } from './aggregation-catalog.js';
import type { RawHorizonItem, WorkflowState, Candidate } from './types.js';
export interface AggregationEntry {
 id: string; title: string; summary: string; url: string; publishedAt?: string; observedAt: string;
 kind: 'news' | 'digest'; selected: boolean;
 platforms: Array<{id: string; name: string; url: string}>;
}
export interface AggregationView {
 entries: AggregationEntry[];
 platforms: Array<{id: string; name: string; homepage: string; status: 'pending'|'disabled'|'unread'|'ready'|'stale'|'error'|'empty'; checkedAt?: string; latestAt?: string; detail?: string}>;
 active: boolean;
}
const canonical = (raw: string) => {
 try {const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)return undefined;
 const host=u.hostname.replace(/^\[|\]$/g,'');if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||(isIP(host)&&isDisallowedRemoteAddress(host)))return undefined;
 u.hash='';for(const key of [...u.searchParams.keys()])if(/^(utm_|fbclid$|gclid$)/i.test(key))u.searchParams.delete(key);u.searchParams.sort();return u.href;
 } catch {return undefined;}
};
const sourceId = (item: RawHorizonItem) => String(item.metadata?.source_id || '');
/** Retain bounded summaries before scoring; a roundup is not a single event. */
export const aggregationSnapshot = (items: RawHorizonItem[]) => {
 const counts=new Map<string,number>();const seen=new Set<string>();
 return items.filter(i=>{const id=sourceId(i);const url=canonical(i.url);const key=`${id}:${url}`;
 if(!aggregationSourceIds.has(id)||!url||seen.has(key)||(counts.get(id)||0)>=100)return false;
 seen.add(key);counts.set(id,(counts.get(id)||0)+1);return true;
 }).map(i=>({...i,content:i.content?.slice(0,1600)}));
};
export function buildAggregationView(state: WorkflowState, now=Date.now()): AggregationView {
 const runs=[...state.runs].sort((a,b)=>Date.parse(b.collectedAt||b.createdAt)-Date.parse(a.collectedAt||a.createdAt));
 const grouped=new Map<string,AggregationEntry>();
 const selected=new Set(state.runs.flatMap(r=>r.candidates.filter(c=>c.selected).map(c=>canonical(c.url))));
 const platforms=aggregationCatalog.map(platform=>{
  const config=state.sources.find(s=>s.id===platform.id);
  const base={id:platform.id,name:platform.name,homepage:platform.homepage};
  if(!platform.available)return {...base,status:'pending' as const,detail:'网页可访问；稳定订阅尚未验证，暂不自动采集。'};
  const latest=runs.find(r=>r.sourceResults?.some(s=>s.sourceId===platform.id));
  const result=latest?.sourceResults?.find(s=>s.sourceId===platform.id);
  const snapshot=runs.find(r=>r.aggregationItems!==undefined && r.sourceResults?.some(s=>s.sourceId===platform.id && s.status!=='error' && (s.rawCount>0 || !s.routes?.some(route=>route.status==='error'))));
  const items=snapshot?.aggregationItems?.filter(i=>sourceId(i)===platform.id) || [];
  const dates=items.map(i=>i.published_at).filter((v):v is string=>Boolean(v)&&Number.isFinite(Date.parse(v!))&&Date.parse(v!)<=now);
  const latestAt=dates.sort().at(-1);
  for(const item of items){
   const url=canonical(item.url);if(!url)continue;
   const key=url;const previous=grouped.get(key);
   const attribution={id:platform.id,name:platform.name,url:canonical(String(item.metadata?.discovery_url||item.url))||url};
   if(previous){if(!previous.platforms.some(p=>p.id===platform.id))previous.platforms.push(attribution);continue;}
   grouped.set(key,{id:createHash('sha256').update(key).digest('hex').slice(0,24),title:item.title,summary:item.content||'',url,
    publishedAt:item.published_at,observedAt:item.fetched_at||snapshot!.collectedAt||snapshot!.createdAt,kind:platform.kind,selected:selected.has(url),platforms:[attribution]});
  }
  const failed=result?.status==='error'||result?.routes?.some(r=>r.status==='error');
  const status=!config?.enabled?'disabled':failed?'error':!snapshot?'unread':!items.length?'empty':!latestAt||now-Date.parse(latestAt)>3*86400000?'stale':'ready';
  return {...base,status,checkedAt:latest?.collectedAt,latestAt,detail:failed?'部分读取失败；保留上次内容，不代表没有更新。':undefined} as AggregationView['platforms'][number];
 });
 return {platforms,entries:[...grouped.values()].sort((a,b)=>Date.parse(b.publishedAt||'1970-01-01')-Date.parse(a.publishedAt||'1970-01-01')),
  active:runs.some(r=>['queued','collecting','scoring','extracting'].includes(r.status)&&r.sourceIds.some(id=>aggregationSourceIds.has(id)))};
}
export function retainAggregationEntry(state: WorkflowState, id: string) {
 const entry=buildAggregationView(state).entries.find(e=>e.id===id);if(!entry)throw new Error('该条目已不在当前快照，请刷新列表。');
 for(const run of state.runs){const candidate=run.candidates.find(c=>canonical(c.url)===canonical(entry.url));if(candidate){candidate.selected=true;return {runId:run.id,candidateId:candidate.id};}}
 const now=new Date().toISOString();const runId=`aggregation-${id}`;
 const candidate:Candidate={id:`aggregation-${id}`,rawId:id,sourceType:'rss',sourceName:entry.platforms[0]!.name,sourceRole:'discovery',
  title:entry.title,url:entry.url,canonicalUrl:entry.url,excerpt:entry.summary,publishedAt:entry.publishedAt||entry.observedAt,publicationDateKnown:Boolean(entry.publishedAt),fetchedAt:entry.observedAt,
  score:0,scoreBreakdown:{consequence:0,novelty:0,evidence:0,relevance:0,timeliness:0,confirmation:0,penalty:0},heatScore:0,heatBreakdown:{engagement:0,sourceReach:0,crossSource:0,freshness:0},recommendationScore:0,
  clusterSize:1,relatedSources:entry.platforms.map(p=>p.name),evidence:'聚合平台摘要，原文事实尚待核验；多个平台收录不代表独立证实。',imageCount:0,images:[],selected:true,status:'candidate'};
 state.runs.unshift({id:runId,createdAt:now,updatedAt:now,collectedAt:entry.observedAt,completedAt:now,status:'ready',stage:'已保留聚合选题，待核验',windowHours:24,sourceIds:entry.platforms.map(p=>p.id),scheduled:false,rawCount:1,candidates:[candidate],logs:[],origin:'link-intake'});
 return {runId,candidateId:candidate.id};
}
