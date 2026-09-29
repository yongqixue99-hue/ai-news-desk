import assert from 'node:assert/strict';
import { readAggregationEvent } from './aggregation-event.js';
import test from 'node:test';
import { aihotHotUrl, aihotSelectedUrl, parseAihotRanking } from './aggregation-native.js';
const links={original:'https://vendor.example/release',aihot:'https://aihot.news/items/one',story:'https://aihot.news/story/event-one'};
test('AIHOT public rank keeps event activity separate from publication and does not invent heat values',()=>{
 const [item]=parseAihotRanking(JSON.stringify({schemaVersion:1,items:[{id:'one',title:'Jev 发布新模型',rank:2,links,latestAt:'2026-09-20T01:00:00Z',sourceCount:99}]}),aihotHotUrl,'2026-09-20T02:00:00Z');
 assert.equal(item.published_at,undefined);assert.equal(item.metadata?.aggregation_rank,2);
 assert.equal(item.metadata?.aggregation_event_updated_at,'2026-09-20T01:00:00.000Z');assert.equal(item.metadata?.score,undefined);assert.equal(item.metadata?.source_role,'discovery');
});
test('AIHOT selected API preserves upstream order, editorial score and reason separately',()=>{
 const [item]=parseAihotRanking(JSON.stringify({schemaVersion:1,items:[{id:'one',title:'Release',summary:'Original summary',selected:true,score:86,reason:'Useful change',links,publishedAt:'2026-09-19T01:00:00Z',discoveredAt:'2026-09-20T01:00:00Z'}]}),aihotSelectedUrl,'2026-09-20T02:00:00Z');
 assert.equal(item.published_at,'2026-09-19T01:00:00.000Z');assert.equal(item.metadata?.aggregation_order,1);assert.equal(item.metadata?.aggregation_score,86);assert.equal(item.metadata?.aggregation_reason,'Useful change');
 assert.throws(()=>parseAihotRanking('{"items":[]}',aihotHotUrl,'now'),/结构/);
 assert.throws(()=>parseAihotRanking(JSON.stringify({schemaVersion:1,items:[{title:'Bad',links,rank:99}]}),aihotHotUrl,'now'),/排名/);
});

test('AIHOT ranking route failure is isolated from RSS and selected collection',async()=>{
 const {collectPortableStructuredSources}=await import('./structured-collector.js');
 const {defaultSources}=await import('./defaults.js');
 const source=defaultSources.find(s=>s.id==='aihot-news')!;
 const result=await collectPortableStructuredSources([source],{topicIds:['ai']},{
  fetcher:async(url)=>String(url)===aihotHotUrl?new Response(null,{status:503}):String(url)===aihotSelectedUrl
   ?new Response(JSON.stringify({schemaVersion:1,items:[{title:'Jev release',summary:'Original',selected:true,links,publishedAt:'2026-09-20T00:00:00Z'}]}))
   :new Response('<rss><channel><item><title>RSS entry</title><link>https://example.com/rss</link></item></channel></rss>'),
 });
 assert.ok(result.items.some(i=>i.metadata?.aggregation_selected===true));assert.ok(result.items.some(i=>i.title==='RSS entry'));
 assert.equal(result.failures['aihot-news'],undefined);
 assert.ok(result.routeResults.some(r=>r.url===aihotHotUrl&&r.status==='error'));
});
test('AIHOT event membership uses reports only, never its related stories',async()=>{
 const {parseAihotStoryRelations}=await import('./aggregation-native.js');
 const hot=parseAihotRanking(JSON.stringify({schemaVersion:1,items:[{title:'Event',rank:1,links,latestAt:'2026-09-20'}]}),aihotHotUrl,'2026-09-20')[0];
 const [result]=parseAihotStoryRelations(JSON.stringify({schemaVersion:1,story:{reports:[{links:{original:'https://publisher.example/report'}}],related:[{links:{original:'https://publisher.example/other-event'}}]}}),hot);
 assert.deepEqual(result.metadata?.aggregation_related_urls,['https://publisher.example/report']);
});
test('AIHOT event reading preserves attributed digest, latest change and safe reports without rewriting the original', async () => {
 const {parseAihotStoryRelations}=await import('./aggregation-native.js');
 const hot=parseAihotRanking(JSON.stringify({schemaVersion:1,items:[{title:'Event',summary:'Original summary',rank:1,links}]}),aihotHotUrl,'2026-09-29')[0]!;
 const [result]=parseAihotStoryRelations(JSON.stringify({schemaVersion:1,story:{digest:'事件摘要',latest:'新增 API 定价',digestUpdatedAt:'2026-09-29T01:00:00Z',sourceCount:3,reportCount:4,reports:[
  {title:'来源报道',source:{name:'原始发布者'},links:{original:'https://publisher.example/report'}},
  {title:'Unsafe',links:{original:'javascript:alert(1)'}},
 ],related:[{title:'不同事件',links:{original:'https://publisher.example/other'}}]}}),hot);
 assert.equal(result.content,'Original summary');
 const event=readAggregationEvent(result.metadata?.aggregation_event);
 assert.equal(event?.digest,'事件摘要');
 assert.equal(event?.latest,'新增 API 定价');
 assert.equal(event?.reports.length,1);
 assert.deepEqual(result.metadata?.aggregation_related_urls,['https://publisher.example/report']);
 assert.equal(result.metadata?.source_role,'discovery');
});
test('structured collection carries event reading through the cached route into the displayed view', async () => {
 const {collectPortableStructuredSources}=await import('./structured-collector.js');
 const {createDefaultState}=await import('./defaults.js');
 const {buildAggregationView}=await import('./aggregation-desk.js');
 const state=createDefaultState(),source=state.sources.find(s=>s.id==='aihot-news')!,at='2026-09-29T01:00:00Z';
 const result=await collectPortableStructuredSources([source],{topicIds:['ai']},{
  fetcher:async url=>new Response(JSON.stringify(String(url)===aihotHotUrl
   ?{schemaVersion:1,items:[{title:'Jev 发布推理工具',rank:1,latestAt:at,links:{original:'https://example.com/release',story:'https://aihot.news/story/event-1'}}]}
   :String(url).includes('/api/v1/stories/')?{schemaVersion:1,story:{digest:'工具支持本地推理。',latest:'新增批处理接口。',sourceCount:2,reports:[{title:'官方说明',links:{original:'https://example.com/release'},source:{name:'Jev'}}]}}
   :{schemaVersion:1,items:[]})),
 });
 state.runs=[{id:'live-chain',createdAt:at,updatedAt:at,collectedAt:at,status:'ready',stage:'done',windowHours:48,sourceIds:[source.id],scheduled:false,rawCount:result.items.length,candidates:[],logs:[],aggregationItems:result.items,sourceResults:[{sourceId:source.id,sourceName:'AIHOT',status:'healthy',healthImpact:'success',rawCount:1,candidateCount:0,detail:'',routes:result.routeResults}]}];
 const view=buildAggregationView(state,Date.parse(at));
 assert.equal(view.platformEntries['aihot-news'][0]?.event?.digest,'工具支持本地推理。');
 assert.equal(view.recommended[0]?.event?.latest,'新增批处理接口。');
});
