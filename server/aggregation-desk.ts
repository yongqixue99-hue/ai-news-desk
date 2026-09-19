import { isIP } from 'node:net';
import { isDisallowedRemoteAddress } from './remote-url.js';
import { createHash } from 'node:crypto';
import { aggregationCatalog, aggregationSourceIds } from './aggregation-catalog.js';
import { aihotSelectedUrl } from './aggregation-native.js';
import { nativeOrder, rankAggregations } from './aggregation-ranking.js';
import type { RawHorizonItem, WorkflowState, WorkflowRun, Candidate } from './types.js';

export interface AggregationEntry {
  id: string; title: string; summary: string; url: string; publishedAt?: string; eventUpdatedAt?: string; observedAt: string;
  kind: 'news' | 'digest'; selected: boolean;
  platforms: Array<{id: string; name: string; url: string}>;
  native?: {channel: 'hot'|'selected'|'feed'; order: number; rank?: number; featured?: boolean; score?: number; reason?: string; checkedAt: string; eventUrl?: string};
  ranking?: {score: number; heat: number; eligible: boolean; reasons: string[]};
  related?: Array<{id:string;title:string;url:string;platform:string}>;
}
export interface AggregationView {
  entries: AggregationEntry[];
  platformEntries: Record<string, AggregationEntry[]>;
  recommended: AggregationEntry[];
  platforms: Array<{id: string; name: string; homepage: string; status: 'pending'|'disabled'|'unread'|'ready'|'stale'|'error'|'empty'; checkedAt?: string; latestAt?: string; detail?: string}>;
  active: boolean;
}
const canonical = (raw: string) => {
  try {
    const u = new URL(raw);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return undefined;
    const host = u.hostname.replace(/^\[|\]$/g,'');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host) && isDisallowedRemoteAddress(host))) return undefined;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort(); return u.href;
  } catch { return undefined; }
};
const sourceId = (item: RawHorizonItem) => String(item.metadata?.source_id || '');
const channel = (item: RawHorizonItem): 'hot'|'selected'|'feed' => item.metadata?.aggregation_channel === 'hot' ? 'hot' : item.metadata?.aggregation_channel === 'selected' ? 'selected' : 'feed';
const finite = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
/** Each platform channel retains at most 100 summaries before editorial scoring. */
export const aggregationSnapshot = (items: RawHorizonItem[]) => {
  const counts = new Map<string,number>(); const seen = new Set<string>();
  return items.filter(i => {
    const id = sourceId(i), url = canonical(i.url), lane = `${id}:${channel(i)}`, key = `${lane}:${url}`;
    if (!aggregationSourceIds.has(id) || !url || seen.has(key) || (counts.get(lane) || 0) >= 100) return false;
    seen.add(key); counts.set(lane,(counts.get(lane) || 0)+1); return true;
  }).map(i => ({...i,content:i.content?.slice(0,1600)}));
};

/** Resolve per-route successful snapshots so a working RSS feed cannot erase a failed hot-list snapshot. */
function platformSnapshots(runs: WorkflowRun[], id: string) {
  const routes = new Set(runs.flatMap(r => r.aggregationItems === undefined ? [] : r.sourceResults?.find(s=>s.sourceId===id)?.routes?.map(route=>route.url) || []));
  if (!routes.size) {
    const run = runs.find(r=>r.aggregationItems!==undefined && r.sourceResults?.some(s=>s.sourceId===id && s.status!=='error'));
    return run ? [{run,items:run.aggregationItems!.filter(i=>sourceId(i)===id)}] : [];
  }
  // The API and selected RSS are alternative representations, not two ranked lists to interleave.
  const hasSelectedApi = id === 'aihot-news' && runs.some(r => r.aggregationItems !== undefined && r.sourceResults?.find(s=>s.sourceId===id)?.routes?.some(route=>route.url===aihotSelectedUrl && route.status==='success'));
  return [...routes].filter(url => !hasSelectedApi || url !== 'https://aihot.news/feed.xml').flatMap(url => {
    const run = runs.find(r=>r.aggregationItems!==undefined && r.sourceResults?.find(s=>s.sourceId===id)?.routes?.some(route=>route.url===url && route.status==='success'));
    return run ? [{run,items:run.aggregationItems!.filter(i=>sourceId(i)===id && i.metadata?.feed_url===url)}] : [];
  });
}
export function buildAggregationView(state: WorkflowState, now=Date.now()): AggregationView {
  const runs = [...state.runs].sort((a,b)=>Date.parse(b.collectedAt||b.createdAt)-Date.parse(a.collectedAt||a.createdAt));
  const grouped = new Map<string,AggregationEntry>();
  const platformEntries: Record<string,AggregationEntry[]> = {};
  const selected = new Set(state.runs.flatMap(r=>r.candidates.filter(c=>c.selected).map(c=>canonical(c.url))));
  const platforms = aggregationCatalog.map(platform => {
    const config = state.sources.find(s=>s.id===platform.id);
    const base = {id:platform.id,name:platform.name,homepage:platform.homepage};
    platformEntries[platform.id] = [];
    if (!platform.available) return {...base,status:'pending' as const,detail:'网页可访问；稳定订阅尚未验证，暂不自动采集。'};
    const latest = runs.find(r=>r.sourceResults?.some(s=>s.sourceId===platform.id));
    const result = latest?.sourceResults?.find(s=>s.sourceId===platform.id);
    const snapshots = platformSnapshots(runs,platform.id);
    const dates: string[] = []; const seen = new Set<string>();
    const eventMembership=new Map<string,string>();
    for(const {items} of snapshots) for(const item of items){const event=canonical(String(item.metadata?.aggregation_event_url||''));const urls=item.metadata?.aggregation_related_urls;
      if(event&&Array.isArray(urls)) for(const raw of urls){const url=canonical(String(raw));if(url)eventMembership.set(url,event);}
    }
    for (const {run,items} of snapshots) for (const [index,item] of items.entries()) {
      const url=canonical(item.url); if (!url) continue;
      const meta=item.metadata || {}, lane=channel(item), key=`${lane}:${url}`;
      if (seen.has(key)) continue; seen.add(key);
      const checkedAt=run.collectedAt||run.createdAt;
      const eventUpdatedAt=typeof meta.aggregation_event_updated_at==='string'?meta.aggregation_event_updated_at:undefined;
      const observedDate=item.published_at||eventUpdatedAt;
      if (observedDate && Number.isFinite(Date.parse(observedDate)) && Date.parse(observedDate)<=now) dates.push(observedDate);
      const rank=finite(meta.aggregation_rank);
      const entry: AggregationEntry = {
        id:createHash('sha256').update(url).digest('hex').slice(0,24), title:item.title,summary:item.content||'',url,
        publishedAt:item.published_at,eventUpdatedAt,observedAt:item.fetched_at||checkedAt,kind:platform.kind,selected:selected.has(url),
        platforms:[{id:platform.id,name:platform.name,url:canonical(String(meta.discovery_url||item.url))||url}],
        native:{channel:lane,order:finite(meta.aggregation_order)??index+1,rank:rank&&rank<=10&&lane==='hot'?rank:undefined,
          featured:meta.aggregation_selected===true||lane==='selected', score:finite(meta.aggregation_score),
          reason:typeof meta.aggregation_reason==='string'?meta.aggregation_reason:undefined, checkedAt,
          eventUrl:canonical(String(meta.aggregation_event_url||''))||eventMembership.get(url)},
      };
      platformEntries[platform.id]!.push(entry);
      const previous=grouped.get(url);
      if (!previous) grouped.set(url,{...entry,platforms:[...entry.platforms]});
      else {
        // Preserve the earliest observed publication date for the same original; a repost cannot rejuvenate it.
        const published=[previous.publishedAt,entry.publishedAt].filter((d):d is string=>Boolean(d)&&Number.isFinite(Date.parse(d!))).sort((a,b)=>Date.parse(a)-Date.parse(b))[0];
        if (!previous.summary && entry.summary) {previous.summary=entry.summary;previous.title=entry.title;}
        previous.publishedAt=published;
        previous.eventUpdatedAt ||= entry.eventUpdatedAt;
        if (nativeOrder(entry,previous)<0) previous.native=entry.native;
        if (!previous.native?.eventUrl && entry.native?.eventUrl) previous.native={...previous.native!,eventUrl:entry.native.eventUrl};
        if (!previous.platforms.some(p=>p.id===platform.id)) previous.platforms.push(entry.platforms[0]!);
      }
    }
    platformEntries[platform.id]!.sort(nativeOrder);
    const latestAt=dates.sort((a,b)=>Date.parse(a)-Date.parse(b)).at(-1);
    const failed=result?.status==='error'||result?.routes?.some(r=>r.status==='error');
    const status=!config?.enabled?'disabled':failed?'error':!snapshots.length?'unread':!platformEntries[platform.id]!.length?'empty':!latestAt||now-Date.parse(latestAt)>3*86400000?'stale':'ready';
    return {...base,status,checkedAt:latest?.collectedAt,latestAt,detail:failed?'部分读取失败；保留该路线的上次内容，旧榜单不代表当前排名。':undefined} as AggregationView['platforms'][number];
  });
  const entries=[...grouped.values()].sort((a,b)=>Date.parse(b.publishedAt||b.eventUpdatedAt||'1970-01-01')-Date.parse(a.publishedAt||a.eventUpdatedAt||'1970-01-01'));
  return {platforms,entries,platformEntries,recommended:rankAggregations(entries,now),
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
