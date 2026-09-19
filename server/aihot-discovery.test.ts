import test from 'node:test';
import assert from 'node:assert/strict';
import { parsePortableFeed } from './structured-collector.js';
import { createDefaultState } from './defaults.js';
import { dueDiscoverySources } from './official-source-monitor.js';
const input = { feedUrl: 'https://aihot.news/feed.xml', feedName: 'AIHOT', sourceId: 'aihot-news', sourceRole: 'discovery' as const, category: 'ai-news', fetchedAt: '2026-09-20T04:00:00Z' };
const xml = (url: string) => `<rss><channel><item><title>New model release</title><link>https://aihot.news/items/one</link><description><![CDATA[<p>Summary only</p><p><a href="${url}">阅读原文</a></p><p>via AIHOT</p>]]></description><pubDate>Sat, 19 Sep 2026 05:50:11 GMT</pubDate></item></channel></rss>`;
test('AIHOT preserves original link, discovery provenance and indexed publication date', () => {
 const [item] = parsePortableFeed(xml('https://example.com/release'), input);
 assert.equal(item.url, 'https://example.com/release');
 assert.equal(item.metadata?.discovery_url, 'https://aihot.news/items/one');
 assert.equal(item.metadata?.source_role, 'discovery');
 assert.equal(item.metadata?.date_basis, 'news-index');
 assert.equal(item.content, 'Summary only');
 assert.equal(item.published_at, '2026-09-19T05:50:11.000Z');
});
test('AIHOT rejects unsafe original links without losing the discovery record', () => {
 for (const url of ['http://127.0.0.1/secret','http://localhost/a','file:///secret','https://user:pass@example.com/a']) {
  const [item] = parsePortableFeed(xml(url),input);assert.equal(item.url,'https://aihot.news/items/one');
 }
});
test('hotspot polling uses enabled selected discovery sources, cadence and failure backoff', () => {
 const state=createDefaultState(); const source=state.sources.find(s=>s.id==='aihot-news')!;
 assert.ok(source?.enabled && source.selected);assert.equal(source.role,'discovery');
 const now=Date.parse(input.fetchedAt);
 assert.equal(dueDiscoverySources([source],state.settings,now).length,1);
 for(const extra of [{enabled:false},{selected:false},{lastCheckedAt:input.fetchedAt},{lastCheckedAt:'2026-09-20T02:00:00Z',consecutiveFailures:2}]) assert.equal(dueDiscoverySources([{...source,...extra}],state.settings,now).length,0);
 assert.equal(dueDiscoverySources([source],{...state.settings,officialMonitorEnabled:false},now).length,0);
 assert.equal(state.sources.find(s=>s.id==='aihot-cn')?.enabled,false);
});
