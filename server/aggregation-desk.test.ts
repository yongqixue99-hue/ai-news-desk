import test from 'node:test';
import assert from 'node:assert/strict';
import { aggregationSnapshot, buildAggregationView, retainAggregationEntry } from './aggregation-desk.js';
import { createDefaultState } from './defaults.js';
import { parsePortableFeed } from './structured-collector.js';
import type { RawHorizonItem, WorkflowRun } from './types.js';
const time='2026-09-20T04:00:00Z';
const item=(source='aihot-news',url='https://example.com/model?utm_source=aihot'):RawHorizonItem=>({id:source,source_type:'rss',title:'A new model',url,content:'Publisher summary',published_at:'2026-09-19T04:00:00Z',fetched_at:time,metadata:{source_id:source,discovery_url:`https://${source}.example/entry`}});
const run=(items:RawHorizonItem[],status:'healthy'|'error'='healthy',at=time):WorkflowRun=>({id:at,createdAt:at,updatedAt:at,collectedAt:at,status:'ready',stage:'done',windowHours:48,sourceIds:['aihot-news','alphasignal','smol-ainews'],scheduled:false,rawCount:items.length,candidates:[],logs:[],aggregationItems:aggregationSnapshot(items),sourceResults:['aihot-news','alphasignal','smol-ainews'].map(sourceId=>({sourceId,sourceName:sourceId,status,healthImpact:status==='error'?'failure':'success',rawCount:items.filter(i=>i.metadata?.source_id===sourceId).length,candidateCount:0,detail:''}))});
test('aggregation view merges identical originals, preserves attribution and never manufactures confirmation or invokes AI',()=>{
 const state=createDefaultState();state.runs=[run([item(),item('alphasignal','https://example.com/model?utm_source=alpha')])];const before=JSON.stringify(state);
 const view=buildAggregationView(state,Date.parse(time));assert.equal(view.entries.length,1);assert.equal(view.entries[0].platforms.length,2);assert.equal(view.entries[0].summary,'Publisher summary');assert.equal(view.entries[0].url,'https://example.com/model');assert.equal(JSON.stringify(state),before);
});
test('failed refresh retains older snapshot and distinguishes unavailable, old content and successful empty',()=>{
 const state=createDefaultState();const old=item('smol-ainews','https://news.smol.ai/issues/old');old.published_at='2026-09-09T04:00:00Z';state.runs=[run([], 'error'),run([old], 'healthy','2026-09-19T04:00:00Z')];
 assert.equal(buildAggregationView(state,Date.parse(time)).entries.length,1);assert.equal(buildAggregationView(state,Date.parse(time)).platforms.find(p=>p.id==='smol-ainews')?.status,'error');
 state.runs.shift();assert.equal(buildAggregationView(state,Date.parse(time)).platforms.find(p=>p.id==='smol-ainews')?.status,'stale');
 state.runs.unshift(run([]));assert.equal(buildAggregationView(state,Date.parse(time)).entries.length,0);assert.equal(buildAggregationView(state,Date.parse(time)).platforms.find(p=>p.id==='smol-ainews')?.status,'empty');
});
test('retaining a filtered-out aggregate is idempotent and remains an unverified discovery candidate',()=>{
 const state=createDefaultState();state.runs=[run([item()])];const id=buildAggregationView(state).entries[0].id;const ref=retainAggregationEntry(state,id);const again=retainAggregationEntry(state,id);assert.deepEqual(again,ref);assert.equal(state.runs.length,2);const candidate=state.runs[0].candidates[0];assert.equal(candidate.sourceRole,'discovery');assert.equal(candidate.heatScore,0);assert.equal(candidate.selected,true);assert.match(candidate.evidence,/尚待核验/);
});
test('snapshot is bounded per platform, excludes unsafe links and prefers feed summary over newsletter full text',()=>{
 const many=Array.from({length:150},(_,i)=>item('aihot-news',`https://example.com/${i}`));assert.equal(aggregationSnapshot([...many,item('alphasignal')]).length,101);assert.equal(aggregationSnapshot([item('aihot-news','http://127.0.0.1/private')]).length,0);
 const xml='<rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><item><title>Daily digest</title><link>https://news.smol.ai/issues/one</link><description>Short summary</description><content:encoded>Long full article</content:encoded></item></channel></rss>';
 const [parsed]=parsePortableFeed(xml,{feedUrl:'https://news.smol.ai/rss.xml',feedName:'AINews',sourceId:'smol-ainews',sourceRole:'discovery',category:'ai-news',fetchedAt:time});assert.equal(parsed.content,'Short summary');
});
