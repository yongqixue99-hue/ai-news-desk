import { assessEditorialOpportunity, editorialExclusionFor, mayShareEditorialEvent } from './newsworthiness.js';
import { titleSimilarity } from './scoring.js';
import type { AggregationEntry } from './aggregation-desk.js';

const timestamp = (entry: AggregationEntry) => Date.parse(entry.publishedAt || entry.eventUpdatedAt || '');
const versions = (text: string) => [...text.toLowerCase().matchAll(/\d+(?:\.\d+)+/g)].map(m => m[0]).sort().join(',');
const modelKeys = (text: string) => [...text.replace(/(\d(?:\.\d+)+)\s+([A-Z][a-z]+[A-Z][A-Za-z]+)/g, '$1-$2').matchAll(/[a-z][a-z0-9]*[ -]?\d+(?:\.\d+)+(?:-[a-z][a-z0-9]*)*/gi)].map(m=>m[0].toLowerCase().replace(/ /g,''));
const actions = (text: string) => /降价|涨价|价格|pricing|price|cost/iu.test(text) ? 'price' : /漏洞|入侵|泄露|breach|hack|vulnerability/iu.test(text) ? 'security' : /发布|推出|开源|release|launch|introduc|unveil/iu.test(text) ? 'release' : /latency|translation lag|speech|吞吐|延迟|同传/iu.test(text) ? 'performance' : 'other';
export const nativeOrder = (a: AggregationEntry, b: AggregationEntry) => {
  const lane = (e: AggregationEntry) => e.native?.channel === 'hot' ? 0 : e.native?.channel === 'selected' ? 1 : 2;
  return lane(a) - lane(b) || (a.native?.rank ?? a.native?.order ?? 99999) - (b.native?.rank ?? b.native?.order ?? 99999) || a.id.localeCompare(b.id);
};

/** Conservative grouping: exact originals or near-identical event headlines, never just a model name. */
export function sameAggregationEvent(a: AggregationEntry, b: AggregationEntry) {
  if (a.url === b.url) return true;
  if (a.kind !== 'news' || b.kind !== 'news') return false;
  if (a.native?.eventUrl && a.native.eventUrl === b.native?.eventUrl) return true;
  const leftAction=actions(a.title), rightAction=actions(b.title);
  const modelMatch=modelKeys(a.title).some(key=>modelKeys(b.title).includes(key));
  const productUpdate=modelMatch && [leftAction,rightAction].every(action=>['release','performance'].includes(action))
    && !/review|tutorial|commentary|实测|评测|教程|评论|解读|提示词/iu.test(`${a.title} ${b.title}`);
  if (!productUpdate && (versions(a.title) !== versions(b.title) || leftAction !== rightAction)) return false;
  if (!Number.isFinite(timestamp(a)) || !Number.isFinite(timestamp(b)) || Math.abs(timestamp(a) - timestamp(b)) > 48 * 3600000) return false;
  return mayShareEditorialEvent(a.title, b.title) && (productUpdate || titleSimilarity(a.title, b.title) >= 0.88);
}

export function rankAggregations(entries: AggregationEntry[], now: number) {
  const evaluated = entries.map(entry => {
    const age = (now - timestamp(entry)) / 3600000;
    const invalidDate = !Number.isFinite(age) || age < 0;
    const opportunity = assessEditorialOpportunity(entry.title, entry.summary);
    const excluded = editorialExclusionFor(entry.title) || (/或(?:将)?发布|可能(?:推出|发布)|拟(?:推出|发布)|传闻|据传/iu.test(entry.title) ? 'rumor' : undefined);
    const snapshotAge = (now - Date.parse(entry.native?.checkedAt || entry.observedAt)) / 3600000;
    const nativeFresh = snapshotAge >= 0 && snapshotAge <= 6;
    const hot = nativeFresh ? entry.native?.rank : undefined;
    const heat = hot ? Math.max(1, 22 - hot * 2) : 0;
    const securityIncident = /突破.*隔离|入侵.*(?:公司|账户|系统)|披露.*漏洞|数据泄露|zero.day|data breach/iu.test(entry.title);
    const importance = opportunity.lane === 'important' || securityIncident ? 40 : opportunity.lane === 'interesting' ? 20 : 0;
    const freshness = invalidDate ? 0 : Math.max(0, 20 * (1 - age / 48));
    const curated = entry.native?.featured && snapshotAge >= 0 && snapshotAge <= 72 ? 8 : 0;
    const reasons = [securityIncident ? '涉及具体安全事件，优先核对影响范围与披露依据。' : opportunity.reason];
    if (hot) reasons.push(`AIHOT 热点榜第 ${hot}（平台信号，非事实核验）`);
    if (curated) reasons.push('AIHOT 精选');
    if (!hot) reasons.push('热度未知');
    if (invalidDate) reasons.push('发布时间缺失或异常');
    else if (age > 48) reasons.push('超过 48 小时，保留在最新动态');
    else reasons.push(`距${entry.publishedAt ? '来源发布' : '平台事件进展'}约 ${Math.floor(age)} 小时`);
    const eligible = entry.kind === 'news' && !excluded && !invalidDate && age <= 48
      && (importance > 0 || Boolean(hot) || Boolean(curated && entry.summary.length >= 80));
    return {...entry, ranking: {score: importance + heat + freshness + curated, heat, eligible, reasons}};
  });
  const groups: typeof evaluated[] = [];
  // Prefer substance to the wrapper, regardless of the catalog's platform order.
  for (const entry of evaluated.sort((a,b) => b.ranking.score - a.ranking.score || a.id.localeCompare(b.id))) {
    const group = groups.find(g => g.every(other => sameAggregationEvent(other, entry)));
    if (group) group.push(entry); else groups.push([entry]);
  }
  return groups.map(group => {
    const representative = group.find(e => e.ranking.eligible) || group[0]!;
    // Carry the strongest observed platform heat once; copies never add heat or factual confirmation.
    const hottest=group.reduce((best,e)=>e.ranking.heat>best.ranking.heat?e:best,representative);
    const ranking=hottest.ranking.heat>representative.ranking.heat?{...representative.ranking,
      score:representative.ranking.score-representative.ranking.heat+hottest.ranking.heat,heat:hottest.ranking.heat,
      reasons:[...representative.ranking.reasons.filter(r=>r!=='热度未知'),...hottest.ranking.reasons.filter(r=>r.startsWith('AIHOT 热点榜'))],
    }:representative.ranking;
    return {...representative, ranking, selected: group.some(e => e.selected),
      platforms: [...new Map(group.flatMap(e => e.platforms).map(p => [p.id, p])).values()],
      related: group.filter(e => e !== representative).map(e => ({id:e.id,title:e.title,url:e.url,platform:e.platforms[0]!.name})),
    };
  }).filter(e => e.ranking.eligible).sort((a,b) => b.ranking.score - a.ranking.score || timestamp(b) - timestamp(a) || a.id.localeCompare(b.id)).slice(0,30);
}
