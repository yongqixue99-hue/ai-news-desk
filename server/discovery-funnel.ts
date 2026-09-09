import { deduplicateDiscoveryItems } from "./source-desk.js";
import { rawItemMatchesSearch, rawItemTimeRejectionReason, rawItemToCandidate, rankCandidatesWithDiagnostics } from "./scoring.js";
import { sourceRoleFor } from "./source-routing.js";
import type { CandidateFeedback, CollectionFunnel, CollectionRequest, CollectionTopicId, RawHorizonItem, SourceConfig } from "./types.js";

/** One production pipeline and disjoint rejection counts: every raw row is accounted for. */
export const collectDiscoveryCandidates = (
  items: RawHorizonItem[],
  options: { windowHours: number; topicIds: CollectionTopicId[]; now?: number;
    filters?: Pick<CollectionRequest, "dateFrom" | "dateTo" | "keywords">;
    sources?: SourceConfig[]; feedback?: CandidateFeedback[]; personalizationEnabled?: boolean },
) => {
  const now = options.now ?? Date.now();
  const filters = options.filters ?? {};
  const timeOptions = { windowHours: options.windowHours, now };
  const timeCounts = new Map<string, number>();
  const dated = items.filter((item) => {
    const reason = rawItemTimeRejectionReason(item, filters, timeOptions);
    if (reason) timeCounts.set(reason, (timeCounts.get(reason) ?? 0) + 1);
    return !reason;
  });
  const matched = dated.filter((item) => rawItemMatchesSearch(item, filters, timeOptions));
  const unique = deduplicateDiscoveryItems(matched);
  const ranked = rankCandidatesWithDiagnostics(unique.map((item) => {
    const candidate = rawItemToCandidate(item, options.windowHours, options.topicIds, now);
    const sources = options.sources ?? [];
    const source = sources.find((entry) => entry.id === item.metadata?.source_id)
      ?? sources.find((entry) => entry.name === candidate.sourceName
        || (entry.kind === candidate.sourceType && sources.filter((other) => other.kind === entry.kind).length === 1));
    if (source && !candidate.sourceRole) candidate.sourceRole = sourceRoleFor(source);
    return candidate;
  }), options.feedback, options.personalizationEnabled);
  const labels: Record<string, string> = {
    "missing-published-at": "缺少原始发布时间", "invalid-published-at": "发布时间无法识别",
    "future-published-at": "发布时间在未来", "outside-date-range": "超出所选日期", "outside-window": "超出采集时间窗口",
  };
  const rejections = [
    ...Object.entries(labels).map(([code, label]) => ({ code, label, count: timeCounts.get(code) ?? 0 })),
    { code: "keyword-mismatch", label: "未命中搜索关键词", count: dated.length - matched.length },
    { code: "duplicate-url", label: "相同原文链接重复", count: matched.length - unique.length },
    { code: "score-or-topic", label: "未达评分门槛或不属所选主题", count: ranked.scoreRejected },
    { code: "merged-event", label: "同一事件已合并", count: ranked.mergedCount },
    { code: "candidate-limit", label: "超过本轮候选数量上限", count: ranked.limitRejected },
  ].filter((entry) => entry.count > 0);
  const funnel: CollectionFunnel = { rawCount: items.length, dateAcceptedCount: dated.length,
    matchedCount: matched.length, uniqueUrlCount: unique.length, eligibleCount: ranked.eligibleCount,
    clusterCount: ranked.clusterCount, candidateCount: ranked.candidates.length, rejections };
  if (items.some((item) => item.metadata?.date_verification)) funnel.publicationDateChecks = {
    verified: items.filter((item) => item.metadata?.date_verification === "verified").length,
    unavailable: items.filter((item) => item.metadata?.date_verification === "unavailable").length,
    deferred: items.filter((item) => item.metadata?.date_verification === "pending-limit").length,
  };
  return { candidates: ranked.candidates, funnel };
};
