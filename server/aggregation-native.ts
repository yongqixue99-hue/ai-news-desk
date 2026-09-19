import { createHash } from 'node:crypto';
import type { RawHorizonItem } from './types.js';

export const aihotHotUrl = 'https://aihot.news/api/v1/hot-topics';
export const aihotSelectedUrl = 'https://aihot.news/api/v1/items?mode=selected&window=7d&limit=100';
export const aggregationApiUrls = [aihotHotUrl, aihotSelectedUrl];
const record = (v: unknown): Record<string, any> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, any> : {};
const str = (v: unknown, max = 1600) => typeof v === 'string' ? v.slice(0, max) : '';
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : undefined;

/** Public v1 contract only. The upstream rank is attribution, never a factual score. */
export function parseAihotRanking(content: string, url: string, fetchedAt: string): RawHorizonItem[] {
  const data = record(JSON.parse(content));
  if (data.schemaVersion !== 1 || !Array.isArray(data.items)) throw new Error('AIHOT 排名接口结构发生变化');
  const hot = url === aihotHotUrl;
  return data.items.slice(0, hot ? 10 : 100).flatMap((value: unknown, index: number) => {
    const entry = record(value), links = record(entry.links);
    const title = str(entry.title, 500), original = str(links.original, 2000);
    if (!title || !original || (hot && (!Number.isInteger(entry.rank) || entry.rank < 1 || entry.rank > 10))) throw new Error('AIHOT 条目缺少有效链接或排名');
    return [{
      id: `aihot-${hot ? 'hot' : 'selected'}-${createHash('sha256').update(original).digest('hex').slice(0, 20)}`,
      source_type: 'rss', title, url: original, content: str(entry.summary) || undefined,
      // latestAt is event activity, not the publication date of its representative article.
      published_at: hot ? undefined : date(entry.publishedAt), fetched_at: fetchedAt,
      metadata: {source_id: 'aihot-news', source_role: 'discovery', feed_name: 'AIHOT · AI 热点聚合',
        feed_url: url, source_format: 'aihot-public-v1', discovery_url: str(links.aihot, 2000),
        original_title: str(entry.originalTitle, 500), publisher_name: str(record(entry.source).name, 180),
        aggregation_channel: hot ? 'hot' : 'selected', aggregation_order: index + 1,
        ...(hot ? {aggregation_rank: entry.rank, aggregation_event_url: str(links.story, 2000), aggregation_event_updated_at: date(entry.latestAt)} : {
          aggregation_selected: entry.selected === true,
          aggregation_score: typeof entry.score === 'number' && entry.score >= 0 && entry.score <= 100 ? entry.score : undefined,
          aggregation_reason: str(entry.reason, 500),
        }),
      },
    } satisfies RawHorizonItem];
  });
}

/** Only the explicit report membership is used; nearby/related stories must stay separate. */
export function parseAihotStoryRelations(content: string, hot: RawHorizonItem): RawHorizonItem[] {
  const data=record(JSON.parse(content)), story=record(data.story);
  if(data.schemaVersion!==1 || !Array.isArray(story.reports)) throw new Error('AIHOT 事件成员结构发生变化');
  const urls=story.reports.slice(0,100).map((v:unknown)=>str(record(record(v).links).original,2000)).filter(Boolean);
  return [{...hot,metadata:{...hot.metadata,aggregation_related_urls:urls}}];
}
