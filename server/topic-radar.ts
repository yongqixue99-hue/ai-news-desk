import type { AggregationEntry } from './aggregation-desk.js';
import { rankAggregations, sameAggregationEvent } from './aggregation-ranking.js';
import { assessEditorialOpportunity, editorialExclusionFor } from './newsworthiness.js';
import type { StoryView } from './product-types.js';

export interface TopicRadarRow {
  id: string;
  title: string;
  summary: string;
  publishedAt: string;
  dateLabel: string;
  reason: string;
  heat: string;
  status: 'ready' | 'verify';
  selected: boolean;
  sources: Array<{name: string; url: string}>;
  story?: StoryView;
  aggregationId?: string;
}
const storyEntries = (story: StoryView): AggregationEntry[] => story.signals.map(signal => ({
  id: signal.candidateId, title: signal.title, summary: signal.excerpt || '', url: signal.url, publishedAt: signal.publishedAt,
  observedAt: signal.fetchedAt, kind: 'news', selected: story.selected, platforms: [],
}));
const matches = (story: StoryView, entry: AggregationEntry) => storyEntries(story).some(original => sameAggregationEvent(original, entry));
const sourcesFor = (entry: AggregationEntry) => [
  ...entry.platforms.map(platform => ({name: platform.name, url: platform.url})),
  ...(!entry.platforms.some(platform => platform.url === entry.url) ? [{name:'原文链接',url:entry.url}] : []),
  ...(entry.related ?? []).map(related => ({name:related.platform,url:related.url})),
];
const uniqueSources = (sources: TopicRadarRow['sources']) => [...new Map(sources
  .filter(source => source.name !== '原文链接' || !sources.some(other => other.name !== '原文链接' && other.url === source.url))
  .map(source => [`${source.name}:${source.url}`,source])).values()];
const productUseCase = (story: StoryView) => {
  const listing = story.signals.find(signal => {
    try { return ['producthunt.com','www.producthunt.com'].includes(new URL(signal.url).hostname) && signal.sourceRole === 'discovery'; }
    catch { return false; }
  });
  const description = listing?.excerpt?.trim();
  if (!description || !/\b(?:AI|LLM|agent|model)\b|人工智能|大模型/iu.test(description)
    || !/\b(?:write|search|build|automat\w*|edit|transcrib\w*|summariz\w*|switch|keep|creat\w*|analyz\w*)\b|写作|搜索|自动化|编辑|转录|总结|切换|保留|制作|分析/iu.test(description)) return undefined;
  return {lane:'interesting' as const,label:'产品线索',reason:`产品自述：${description.slice(0,160)}（待试用）`};
};

/** Display-only shortlist. Discovery signals never change Story evidence, editorial routing or frozen facts. */
export function buildTopicRadar(stories: StoryView[], entries: AggregationEntry[], now: string, retired: StoryView[] = []): TopicRadarRow[] {
  const clock = Date.parse(now);
  const suppressed = [...stories, ...retired].filter(story => story.ignored || story.published || story.drafted);
  const aggregates = rankAggregations(entries,clock).filter(entry => !suppressed.some(story => matches(story,entry)));
  const scored: Array<{row: TopicRadarRow; score: number}> = [];
  const consumed = new Set<string>();
  for (const story of stories) {
    if (story.ignored || story.published || story.drafted || story.technicalArticle || story.publicationDateKnown === false
      || editorialExclusionFor(story.originalTitle) || !Number.isFinite(Date.parse(story.publishedAt)) || Date.parse(story.publishedAt) > clock) continue;
    const assessed = story.opportunity ?? assessEditorialOpportunity(story.originalTitle);
    const opportunity = assessed.lane === 'routine' ? productUseCase(story) ?? assessed : assessed;
    if (opportunity.lane === 'routine') continue;
    const copies = aggregates.filter(entry => !consumed.has(entry.id) && matches(story,entry));
    copies.forEach(entry => consumed.add(entry.id));
    const heat = Math.max(0,...copies.map(entry => entry.ranking?.heat || 0));
    const reason = opportunity.practice?.angle || opportunity.reason;
    scored.push({score: (opportunity.lane === 'important' ? 40 : 20) + Math.max(0,20*(1-story.ageHours/48)) + heat + (story.assignment.canDraft ? 4 : 0)
      + Math.max(-4,Math.min(4,story.preferenceAdjustment || 0)),
      row: {id: `story:${story.id}`,title:story.title,summary:story.summary,publishedAt:story.publishedAt,dateLabel:'发布', reason,
        heat: heat ? '有近期平台热点信号' : story.trend.direction === 'unknown' ? '热度未知' : story.trend.summary,
        status:story.assignment.canDraft?'ready':'verify',selected:story.selected,story,
        sources:uniqueSources([...story.signals.map(signal => ({name:signal.sourceName,url:signal.url})),...copies.flatMap(sourcesFor)])}});
  }
  for (const entry of aggregates.filter(entry => !consumed.has(entry.id))) {
    scored.push({score:entry.ranking!.score,row:{id:`aggregation:${entry.id}`,title:entry.title,summary:entry.summary,
      publishedAt:entry.publishedAt || entry.eventUpdatedAt!,dateLabel:entry.publishedAt?'发布':'平台进展',
      reason:entry.ranking!.reasons[0]!,heat:entry.ranking!.heat?'有近期平台热点信号':'热度未知',
      status:'verify',selected:entry.selected,aggregationId:entry.id,sources:uniqueSources(sourcesFor(entry))}});
  }
  const groups: TopicRadarRow[][] = [];
  const originals = (row: TopicRadarRow) => row.story ? storyEntries(row.story) : aggregates.filter(entry => entry.id === row.aggregationId);
  for (const {row} of scored.sort((a,b) => b.score-a.score || Date.parse(b.row.publishedAt)-Date.parse(a.row.publishedAt) || a.row.id.localeCompare(b.row.id))) {
    // Legacy Stories can already describe the same event. Collapse only the
    // display row, never combine or promote their independently frozen evidence.
    const group = groups.find(group => group.every(other => originals(row).some(a => originals(other).some(b => sameAggregationEvent(a,b)))));
    if (group) group.push(row); else groups.push([row]);
  }
  return groups.slice(0,8).map(group => {
    const representative = group.find(row => row.selected && row.story) ?? group.find(row => row.status === 'ready') ?? group[0]!;
    return {...representative,sources:uniqueSources(group.flatMap(row => row.sources))};
  });
}
