import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultState, upgradeState } from './defaults.js';
import { discoveryLayerFor, sourceCoverage } from './source-coverage.js';
import { parsePortableFeed } from './structured-collector.js';

test('default Product Hunt is discovery-only, Atom preserves original date and no invented votes', () => {
  const state=createDefaultState(); const source=state.sources.find(source=>source.id==='producthunt-products')!;
  assert.ok(source);assert.equal(source.selected,true);assert.equal(source.discoveryOnly,true);assert.equal(source.role,'discovery');
  const items=parsePortableFeed('<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>tag:producthunt.com,2026:1</id><title>Local AI assistant</title><link rel="alternate" href="https://www.producthunt.com/posts/local-assistant"/><published>2026-09-20T08:00:00Z</published><updated>2026-09-20T10:00:00Z</updated><content type="html">Private offline document search.</content></entry></feed>',
    {feedUrl:source.url!,feedName:source.name,sourceId:source.id,sourceRole:source.role,category:source.category,fetchedAt:'2026-09-20T12:00:00Z'});
  assert.equal(items.length,1);assert.equal(Date.parse(items[0]!.published_at!),Date.parse('2026-09-20T08:00:00Z'));
  assert.equal(items[0]!.metadata?.points,undefined);assert.equal(items[0]!.metadata?.source_role,'discovery');
});
test('source coverage distinguishes configured, enabled, checked and unavailable layers', () => {
  const state=createDefaultState(); const before=structuredClone(state.sources);
  const coverage=sourceCoverage(state.sources);
  assert.equal(coverage.find(row=>row.id==='products')?.automatic,1);
  assert.equal(coverage.find(row=>row.id==='products')?.healthy,0);
  assert.equal(coverage.find(row=>row.id==='cases')?.automatic,0);
  assert.equal(coverage.find(row=>row.id==='demand')?.automatic,0);
  assert.deepEqual(state.sources,before);
});
test('upgrades keep user source switches and presets intact', () => {
  const state=createDefaultState();const source=state.sources.find(source=>source.id==='producthunt-products')!;
  source.enabled=false;source.selected=false;
  const custom={id:'mine',name:'我的组合',sourceIds:['hackernews'],createdAt:'2026-09-20',updatedAt:'2026-09-20'};
  state.sourcePresets.push(custom);
  const upgraded=upgradeState(state);
  assert.equal(upgraded.sources.find(source=>source.id==='producthunt-products')?.enabled,false);
  assert.equal(upgraded.sources.find(source=>source.id==='producthunt-products')?.selected,false);
  assert.deepEqual(upgraded.sourcePresets.find(preset=>preset.id==='mine'),custom);
});
test('hostname classification cannot be spoofed by a query string or unrelated suffix', () => {
  const base=createDefaultState().sources.find(source=>source.id==='producthunt-products')!;
  assert.equal(discoveryLayerFor({...base,homepageUrl:'https://example.com/?reddit.com',url:undefined}),'news');
  assert.equal(discoveryLayerFor({...base,homepageUrl:'https://notreddit.com/',url:undefined}),'news');
  assert.equal(discoveryLayerFor({...base,homepageUrl:'https://www.reddit.com/r/LocalLLaMA',url:undefined}),'cases');
});
