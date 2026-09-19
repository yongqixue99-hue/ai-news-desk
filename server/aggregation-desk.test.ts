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

test('platform views keep their own wording and order while roundup uses editorial priority',()=>{
 const state=createDefaultState();const a=item();a.title='纯粹吐槽';a.metadata={...a.metadata,aggregation_order:1};
 const b=item('aihot-news','https://example.com/release');b.title='Jev 发布全新决策模型';b.metadata={...b.metadata,aggregation_order:2};
 const other={...b,title:'AlphaSignal original wording',content:'Different summary',metadata:{source_id:'alphasignal',aggregation_order:1}};
 state.runs=[run([a,b,other])];const view=buildAggregationView(state,Date.parse(time));
 assert.equal(view.platformEntries['aihot-news'][0].title,'纯粹吐槽');
 assert.equal(view.platformEntries.alphasignal[0].title,'AlphaSignal original wording');
 assert.equal(view.recommended[0].url,'https://example.com/release');assert.equal(view.recommended.length,1);
});
test('roundup excludes promotional, stale, unknown and future content; hot ranks do not refresh publication dates',()=>{
 const state=createDefaultState();const make=(title:string,date?:string)=>({...item('aihot-news',`https://example.com/${encodeURIComponent(title)}`),title,published_at:date,metadata:{source_id:'aihot-news',aggregation_channel:'hot',aggregation_rank:1}});
 state.runs=[run([make('报名：重磅模型发布活动',time),make('OpenAI releases model','2026-08-01'),make('Anthropic releases model'),make('Qwen releases model','2026-10-01')])];
 assert.equal(buildAggregationView(state,Date.parse(time)).recommended.length,0);
});
test('same event is grouped without collapsing distinct versions or multiplying heat',()=>{
 const state=createDefaultState();const make=(url:string,title:string)=>({...item('aihot-news',url),title});
 state.runs=[run([make('https://a.example/1','Jev 1.0 model released'),make('https://b.example/2','Jev 1.0 model released'),make('https://c.example/3','Jev 2.0 model released')])];
 const view=buildAggregationView(state,Date.parse(time));assert.equal(view.recommended.length,2);assert.equal(view.recommended[0].related?.length,1);
 assert.equal(view.recommended[0].ranking?.heat,0);
});
test('partial route failure preserves the hot snapshot but stale ranks stop contributing to aggregate recommendation',()=>{
 const state=createDefaultState();const hot={...item(),title:'Jev 发布新决策模型',metadata:{source_id:'aihot-news',feed_url:'https://aihot.news/api/v1/hot-topics',aggregation_channel:'hot',aggregation_rank:1}};
 const older=run([hot],'healthy','2026-09-19T04:00:00Z');older.sourceResults![0].routes=[{sourceId:'aihot-news',url:String(hot.metadata.feed_url),status:'success',rawCount:1}];
 const newer=run([]);newer.sourceResults![0].routes=[{sourceId:'aihot-news',url:String(hot.metadata.feed_url),status:'error',rawCount:0},{sourceId:'aihot-news',url:'https://aihot.news/feed/all.xml',status:'success',rawCount:0}];
 state.runs=[newer,older];const view=buildAggregationView(state,Date.parse(time));assert.equal(view.platformEntries['aihot-news'][0].native?.rank,1);assert.equal(view.recommended[0].ranking?.heat,0);assert.equal(view.platforms[0].status,'error');
 newer.sourceResults![0].routes![0].status='success';assert.equal(buildAggregationView(state,Date.parse(time)).platformEntries['aihot-news'].length,0);
});
test('platform hot list preserves ranks even when our quality filter rejects its first entry',()=>{
 const state=createDefaultState();const hot=(title:string,rank:number)=>({...item('aihot-news',`https://example.com/${rank}`),title,metadata:{source_id:'aihot-news',aggregation_channel:'hot',aggregation_rank:rank,aggregation_order:rank}});
 state.runs=[run([hot('报名：模型发布活动',1),hot('Jev 发布全新决策模型',2)])];const view=buildAggregationView(state,Date.parse(time));
 assert.match(view.platformEntries['aihot-news'][0].title,/报名/);assert.equal(view.recommended.length,1);assert.equal(view.recommended[0].native?.rank,2);assert.ok(view.recommended[0].ranking!.heat>0);
});
test('compact model versions remain distinct even when the other headline words match',()=>{
 const state=createDefaultState();state.runs=[run(['3.8','3.9'].map(v=>({...item('alphasignal',`https://example.com/qwen${v}`),title:`Qwen${v} model released with new API pricing` })))];
 assert.equal(buildAggregationView(state,Date.parse(time)).recommended.length,2);
});
test('live headline replay demotes speculative launch and keeps concrete security incident important',()=>{
 const state=createDefaultState();state.runs=[run([
 {...item('aihot-news','https://example.com/rumor'),title:'Reuters：GPT-6 Astra 挤压 Anthropic 企业市场，Anthropic 或发布新模型'},
 {...item('aihot-news','https://example.com/incident'),title:'Gemini 在安全测试中突破隔离入侵三家公司，Google 未主动披露',metadata:{source_id:'aihot-news',aggregation_channel:'hot',aggregation_rank:1}}
 ])];const view=buildAggregationView(state,Date.parse(time));assert.equal(view.recommended.length,1);assert.match(view.recommended[0].title,/入侵/);assert.ok(view.recommended[0].ranking!.score>=60);
});
test('bilingual versioned product reports merge but price changes and different product variants remain distinct',()=>{
 const state=createDefaultState();state.runs=[run([
 {...item('aihot-news','https://qwen.ai/blog?id=live'),title:'Qwen 发布 Qwen3.8-LiveTranslate 实时同传模型，LAAL 降至 2.3 秒'},
 {...item('alphasignal','https://alphasignal.ai/news/live'),title:"Alibaba's Qwen3.8 LiveTranslate Cuts Speech Translation Lag to 2.3 Seconds"},
 {...item('alphasignal','https://alphasignal.ai/news/omni'),title:'Qwen3.8-Omni-Flash model released'},
 {...item('aihot-news','https://example.com/price'),title:'Qwen3.8-LiveTranslate 模型 API 降价'}
 ])];const view=buildAggregationView(state,Date.parse(time));assert.equal(view.recommended.length,3);assert.ok(view.recommended.some(e=>e.related?.some(r=>r.title.includes('LiveTranslate Cuts'))));
});
test('explicit platform event membership groups different reports once without treating related events as confirmation',()=>{
 const state=createDefaultState();const hot={...item('aihot-news','https://example.com/first'),title:'Gemini 在测试中入侵三家公司',metadata:{source_id:'aihot-news',aggregation_channel:'hot',aggregation_rank:1,aggregation_event_url:'https://aihot.news/story/security',aggregation_related_urls:['https://example.com/second']}};
 state.runs=[run([hot,{...item('aihot-news','https://example.com/second'),title:'WSJ 披露安全测试隔离边界失效',metadata:{source_id:'aihot-news',aggregation_channel:'selected'}}])];
 const view=buildAggregationView(state,Date.parse(time));assert.equal(view.recommended.length,1);assert.equal(view.recommended[0].related?.length,1);
 assert.equal(view.platformEntries['aihot-news'].length,2);
});
test('AIHOT selected API order is not interleaved with a secondary RSS timeline',()=>{
 const state=createDefaultState();const api='https://aihot.news/api/v1/items?mode=selected&window=7d&limit=100',rss='https://aihot.news/feed.xml';
 const make=(url:string,feed:string,title:string)=>({...item('aihot-news',url),title,metadata:{source_id:'aihot-news',feed_url:feed,aggregation_channel:'selected',aggregation_order:1}});
 const snapshot=run([make('https://example.com/primary',api,'Primary selection'),make('https://example.com/secondary',rss,'Different RSS order')]);
 snapshot.sourceResults![0].routes=[api,rss].map(url=>({sourceId:'aihot-news',url,status:'success' as const,rawCount:1}));state.runs=[snapshot];
 assert.deepEqual(buildAggregationView(state,Date.parse(time)).platformEntries['aihot-news'].map(e=>e.title),['Primary selection']);
 snapshot.aggregationItems=snapshot.aggregationItems!.filter(i=>i.metadata?.feed_url!==api);
 assert.equal(buildAggregationView(state,Date.parse(time)).platformEntries['aihot-news'].length,0,'a successful empty API selection must stay empty');
 snapshot.sourceResults![0].routes![0].status='error';
 assert.deepEqual(buildAggregationView(state,Date.parse(time)).platformEntries['aihot-news'].map(e=>e.title),['Different RSS order'],'RSS is a fallback when no successful API snapshot exists');
});
