/** Public, non-secret registry shared by discovery and the browsing view. */
export const aggregationCatalog = [
  { id: 'aihot-news', name: 'AIHOT', homepage: 'https://aihot.news/', kind: 'news', available: true },
  { id: 'alphasignal', name: 'AlphaSignal', homepage: 'https://alphasignal.ai/', kind: 'news', available: true },
  { id: 'bens-bites', name: 'Ben’s Bites', homepage: 'https://www.bensbites.com/', kind: 'digest', available: true },
  { id: 'smol-ainews', name: 'AINews / smol.ai', homepage: 'https://news.smol.ai/', kind: 'digest', available: true },
  { id: 'aibase', name: 'AIBase', homepage: 'https://www.aibase.com/zh/daily', kind: 'digest', available: false },
  { id: 'ai-bot', name: 'AI工具集', homepage: 'https://ai-bot.cn/daily-ai-news/', kind: 'digest', available: false },
] as const;
export const aggregationSourceIds = new Set<string>(aggregationCatalog.filter(p => p.available).map(p => p.id));
