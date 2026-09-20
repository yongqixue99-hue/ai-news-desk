import type { SourceConfig } from './types.js';

/** Discovery purpose is separate from editorial trust and never changes factual scores. */
export const discoveryLayers = [
  { id: 'news', label: '消息源与聚合', purpose: '发现变化，回到原始发布核实', cadence: '每日', gap: '优先官网与可读 RSS；付费墙或搜索摘要不能补成全文。' },
  { id: 'code', label: '开源项目', purpose: '找到能用于实际工作的工具', cadence: '每日', gap: 'README 只能支持项目介绍；效果和节省时间需要实测。' },
  { id: 'discussion', label: '技术讨论', purpose: '发现争议、缺陷与使用门槛', cadence: '每日', gap: '帖子热度不代表事实或共识，保留讨论链接。' },
  { id: 'products', label: '新产品', purpose: '判断能替读者完成什么事', cadence: '每日', gap: 'Product Hunt 公开订阅没有可靠投票数据，不模拟热榜。' },
  { id: 'cases', label: '用户案例', purpose: '寻找使用过程与失败经验', cadence: '按需', gap: 'Reddit 自动采集尚未接入；可导入原帖，自动接入需另行验证访问条件。' },
  { id: 'china', label: '中文趋势', purpose: '判断国内语境与发布时机', cadence: '每日', gap: '36氪使用站点检索；知乎需配置。微博、百度热榜、掘金尚未接入。' },
  { id: 'demand', label: '内容需求', purpose: '观察反复出现的问题与需求', cadence: '每周观察', gap: '公众号、小红书、付费平台暂用手动资料；尚无自动需求统计，阅读和销量不当作真实需求。' },
] as const;
export type DiscoveryLayer = typeof discoveryLayers[number]['id'];

const hosts = (source: SourceConfig) => [source.homepageUrl, source.url, ...(source.routes ?? []).map(route => route.homepageUrl || route.url)]
  .flatMap(value => { try { return [new URL(value || '').hostname.toLowerCase()]; } catch { return []; } });
const onDomain = (values: string[], domain: string) => values.some(host => host === domain || host.endsWith(`.${domain}`));
export function discoveryLayerFor(source: SourceConfig): DiscoveryLayer | undefined {
  const domains = hosts(source);
  if (onDomain(domains, 'reddit.com')) return 'cases';
  if (onDomain(domains, 'producthunt.com')) return 'products';
  if (source.kind === 'github' || onDomain(domains, 'github.com')) return 'code';
  if (source.kind === 'hackernews' || onDomain(domains, 'ycombinator.com') || onDomain(domains, 'v2ex.com')) return 'discussion';
  if (source.kind === 'zhihu' || ['36kr.com', 'zhihu.com', 'weibo.com', 'baidu.com', 'juejin.cn', 'qbitai.com', 'jiqizhixin.com'].some(domain => onDomain(domains, domain))) return 'china';
  if (['mp.weixin.qq.com', 'xiaohongshu.com', 'zsxq.com'].some(domain => onDomain(domains, domain))) return 'demand';
  if (source.kind === 'last30days') return undefined; // Multi-platform adapter: never claim Reddit is connected just because it exists.
  if (['official', 'verification', 'research', 'discovery'].includes(source.role || '')) return 'news';
  return undefined;
}

export function sourceCoverage(sources: SourceConfig[]) {
  return discoveryLayers.map(layer => {
    const members = sources.filter(source => discoveryLayerFor(source) === layer.id);
    const automatic = members.filter(source => source.enabled && source.selected);
    return { ...layer, sourceIds: members.map(source => source.id), configured: members.length,
      automatic: automatic.length, healthy: automatic.filter(source => source.health === 'healthy').length,
      unchecked: automatic.filter(source => !source.health || source.health === 'unknown').length,
      attention: automatic.filter(source => source.health === 'warning' || source.health === 'error').length };
  });
}
