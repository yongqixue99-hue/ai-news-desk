import assert from 'node:assert/strict';
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
