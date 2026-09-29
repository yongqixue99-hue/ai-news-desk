import { isIP } from 'node:net';
import { isDisallowedRemoteAddress } from './remote-url.js';

export const aggregationLink = (raw: string) => {
  try {
    const u = new URL(raw);
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password) return undefined;
    const host = u.hostname.replace(/^\[|\]$/g,'');
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || (isIP(host) && isDisallowedRemoteAddress(host))) return undefined;
    u.hash = '';
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    u.searchParams.sort(); return u.href;
  } catch { return undefined; }
};

export interface AggregationEvent {
  digest?: string; latest?: string; updatedAt?: string;
  sourceCount?: number; reportCount?: number;
  reports: Array<{title: string; url: string; source: string}>;
}
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0,max) || undefined : undefined;
const count = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 && v <= 1_000_000 ? v : undefined;

/** Also validates persisted snapshots; upstream data never becomes a trusted fact count. */
export function readAggregationEvent(value: unknown): AggregationEvent | undefined {
  const v = record(value);
  if (!Object.keys(v).length) return undefined;
  const seen = new Set<string>();
  const reports = (Array.isArray(v.reports) ? v.reports : []).slice(0,50).flatMap(raw => {
    const r = record(raw), url = aggregationLink(String(r.url || ''));
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{url, title: text(r.title,500) || '查看报道', source:text(r.source,180) || '原始来源'}];
  });
  const updatedAt = typeof v.updatedAt === 'string' && Number.isFinite(Date.parse(v.updatedAt)) ? new Date(v.updatedAt).toISOString() : undefined;
  return {digest:text(v.digest,1600), latest:text(v.latest,400), updatedAt,
    sourceCount:count(v.sourceCount), reportCount:count(v.reportCount), reports};
}
