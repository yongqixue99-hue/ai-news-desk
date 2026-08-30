import type { Candidate, RawHorizonItem, SourceConfig, SourceRunResult } from "./types.js";

const feedNameFor = (item: RawHorizonItem) =>
  typeof item.metadata?.feed_name === "string" ? item.metadata.feed_name : undefined;

const belongsToSource = (item: RawHorizonItem, source: SourceConfig) => {
  const feedName = feedNameFor(item);
  if (feedName) return feedName === source.name;
  if (source.kind === "hackernews") return item.source_type === "hackernews";
  if (source.kind === "google_news") return item.source_type === "google_news";
  if (source.kind === "last30days") return item.source_type === "last30days";
  if (source.kind === "github") return item.source_type === "github";
  return false;
};

export const sourceResultsForRun = (
  sources: SourceConfig[],
  rawItems: RawHorizonItem[],
  candidates: Candidate[],
  failures: Record<string, string> = {},
): SourceRunResult[] => {
  const candidateRawIds = new Set(candidates.map((candidate) => candidate.rawId));
  return sources.map((source) => {
    const sourceItems = rawItems.filter((item) => belongsToSource(item, source));
    const candidateCount = sourceItems.filter((item) => candidateRawIds.has(item.id)).length;
    const rawCount = sourceItems.length;
    const failure = failures[source.id];
    const healthImpact = failure ? "failure" : rawCount > 0 ? "success" : "neutral";
    const status = failure ? "error" : rawCount > 0 ? "healthy" : "warning";
    const detail = failure
      ? `来源连接失败：${failure}`
      : rawCount === 0
      ? "本轮时间窗口内没有新条目，不计为失败"
      : candidateCount === 0
        ? `读取 ${rawCount} 条，来源连接正常，但没有条目通过筛选`
        : `读取 ${rawCount} 条，保留 ${candidateCount} 条候选`;
    return {
      sourceId: source.id,
      sourceName: source.name,
      status,
      healthImpact,
      rawCount,
      candidateCount,
      detail,
    };
  });
};

export const applySourceRunResult = (
  source: SourceConfig,
  result: SourceRunResult,
  checkedAt: string,
) => {
  if (source.id !== result.sourceId) throw new Error("来源运行结果与目标来源不匹配");
  source.lastCheckedAt = checkedAt;
  source.lastRawCount = result.rawCount;
  source.lastCandidateCount = result.candidateCount;
  source.lastHealthDetail = result.detail;
  if (result.healthImpact === "neutral") return source;
  source.health = result.status;
  if (result.healthImpact === "success") {
    source.lastSuccessfulAt = checkedAt;
    source.consecutiveFailures = 0;
  } else {
    source.consecutiveFailures = (source.consecutiveFailures ?? 0) + 1;
  }
  return source;
};
