import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTopicRadar } from './topic-radar.js';
import { buildStories } from './story-desk.js';
import { createDefaultState } from './defaults.js';
import type { AggregationEntry } from './aggregation-desk.js';
import type { Candidate, WorkflowRun } from './types.js';

const now = '2026-09-20T10:00:00Z';
const entry = (id: string, patch: Partial<AggregationEntry> = {}): AggregationEntry => ({id, title: 'Acme releases Model 3.5',
  summary: 'API and open weights are now available for evaluation.', url: `https://example.com/${id}`, kind: 'news',
  publishedAt: '2026-09-20T08:00:00Z', observedAt: now, selected: false,
  platforms: [{id:'aihot-news', name:'AIHOT', url:`https://example.com/${id}`}], ...patch});
const story = () => {
  const state = createDefaultState();
  const candidate = {id:'c', rawId:'c', title:'Acme releases Model 3.5', sourceType:'rss',sourceName:'Acme',sourceRole:'official',
    url:'https://example.com/original', canonicalUrl:'https://example.com/original', excerpt:'API and weights released.', publishedAt:'2026-09-20T08:00:00Z', fetchedAt:now,
    score:12,scoreBreakdown:{consequence:3,novelty:3,evidence:3,relevance:1,timeliness:2,confirmation:0,penalty:0},heatScore:0,
    heatBreakdown:{engagement:0,sourceReach:0,crossSource:0,freshness:0},recommendationScore:80,clusterSize:1,relatedSources:['Acme'],evidence:'一手线索',
    imageCount:0,images:[],selected:false,status:'candidate',topicIds:['ai']} satisfies Candidate;
  state.runs=[{id:'r',createdAt:now,updatedAt:now,status:'ready',stage:'完成',windowHours:24,sourceIds:[],scheduled:false,rawCount:1,candidates:[candidate],logs:[]} satisfies WorkflowRun];
  return buildStories(state,now)[0]!;
};

test('radar merges an aggregate copy with the original Story without upgrading evidence', () => {
  const original=story(); const before=structuredClone(original);
  const result=buildTopicRadar([original],[entry('copy',{url:original.signals[0]!.url})],now);
  assert.equal(result.length,1); assert.equal(result[0]!.story?.id,original.id);
  assert.equal(result[0]!.status, original.assignment.canDraft?'ready':'verify');
  assert.deepEqual(original,before); assert.equal(result[0]!.sources.length,2);
});
test('radar rejects old, undated, future, digest, promotional and rumor aggregation entries', () => {
  const invalid=[entry('old',{publishedAt:'2026-09-16T08:00:00Z'}),entry('missing',{publishedAt:undefined}),entry('future',{publishedAt:'2026-09-21T08:00:00Z'}),
    entry('digest',{kind:'digest'}),entry('ad',{title:'Register now: AI workshop'}),entry('rumor',{title:'Acme reportedly releases Model 3.5'})];
  assert.deepEqual(buildTopicRadar([],invalid,now),[]);
});
test('retired Stories cannot reappear as aggregate recommendations and unknown heat stays unknown', () => {
  const original={...story(),ignored:true};
  assert.equal(buildTopicRadar([original],[entry('copy',{url:original.signals[0]!.url})],now).length,0);
  const result=buildTopicRadar([], [entry('new')],now);
  assert.equal(result[0]?.status,'verify'); assert.equal(result[0]?.heat,'热度未知');
});
test('radar preserves distinct price and launch events and caps the daily shortlist', () => {
  const result=buildTopicRadar([],Array.from({length:12},(_,i)=>entry(String(i),{title:`Vendor${i} releases Model ${i}.5`})),now);
  assert.equal(result.length,8);
  assert.equal(buildTopicRadar([],[entry('launch'),entry('price',{title:'Acme cuts Model 3.5 pricing'})],now).length,2);
});
test('copied items do not multiply heat; current signals outrank stale snapshots', () => {
  const a=entry('a',{native:{channel:'hot',rank:1,order:0,checkedAt:now}});
  const b=entry('b',{title:'Beta releases Model 8.5',native:{channel:'hot',rank:1,order:0,checkedAt:'2026-09-19T00:00:00Z'}});
  const result=buildTopicRadar([],[b,a,{...a,id:'copy'}],now);
  assert.equal(result[0]?.title,a.title);assert.equal(result.length,2);assert.equal(result[1]?.heat,'热度未知');
});

test('AI product listings with a concrete task can be considered, but are not tested endorsements', () => {
  const listing=story();
  listing.originalTitle=listing.title='Epismo OS';
  listing.opportunity={lane:'routine',label:'常规动态',reason:'未识别具体变化'};
  listing.signals=[{...listing.signals[0]!,url:'https://www.producthunt.com/posts/epismo-os',sourceName:'Product Hunt',sourceRole:'discovery',excerpt:'Keep your work when you switch AI tools'}];
  listing.assignment={...listing.assignment,mode:'watch',canDraft:false};
  const rows=buildTopicRadar([listing],[],now);
  assert.equal(rows.length,1);assert.equal(rows[0]?.status,'verify');assert.match(rows[0]?.reason || '',/产品自述.*待试用/u);
  listing.signals[0]!.excerpt='A beautiful new wallpaper collection';
  assert.equal(buildTopicRadar([listing],[],now).length,0);
  listing.signals[0]!.excerpt='Keep your work when you switch AI tools';
  listing.originalTitle='Register now: AI workshop';
  assert.equal(buildTopicRadar([listing],[],now).length,0);
});

test('the shortlist collapses legacy duplicate Stories without merging their stored evidence', () => {
  const first=story(),second=structuredClone(first);
  first.id='first';second.id='second';
  first.title=first.originalTitle='阿里通义Qwen团队发布Qwen3.8-LiveTranslate，实时翻译平均延迟降至2.3秒、支持60种语言';
  second.title=second.originalTitle='阿里发布 Qwen3.8-LiveTranslate 实时同声传译模型，60 种语言平均延迟降至 2.3s';
  first.signals[0]={...first.signals[0]!,title:first.title,url:'https://example.com/news'};
  second.signals[0]={...second.signals[0]!,title:second.title,url:'https://example.com/official'};
  second.selected=true;
  const before=structuredClone([first,second]);
  const rows=buildTopicRadar([first,second],[],now);
  assert.equal(rows.length,1);assert.equal(rows[0]!.story!.id,'second');assert.equal(rows[0]!.sources.length,2);
  assert.deepEqual([first,second],before);
  second.originalTitle=second.title=second.signals[0]!.title='阿里 Qwen3.8-LiveTranslate API 降价';
  assert.equal(buildTopicRadar([first,second],[],now).length,2);
});
