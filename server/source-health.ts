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
  if (source.kind === "x") return item.source_type === "x";
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
    const yieldedCandidate = candidateCount > 0;
    const consecutiveZeroYield = Boolean(
      source.lastCheckedAt
      && source.lastCandidateCount === 0,
    );
    // A connector can be reachable and parse a feed while still producing no
    // in-window candidate. Keep that distinction in the compatible fields:
    // `healthImpact=success` means the connector itself succeeded, while the
    // warning status reports editorial zero-yield rather than an outage.
    const healthImpact = failure ? "failure" : "success";
    const status = failure ? "error" : yieldedCandidate ? "healthy" : "warning";
    const detail = failure
      ? `来源连接或解析失败：${failure}`
      : rawCount === 0
        ? consecutiveZeroYield
          ? "来源连接完成且未报告解析错误，但连续多轮没有窗口内候选；可能是来源近期未更新，或当前主题/频道路由没有命中，不判为连接故障"
          : "来源连接完成且未报告解析错误，本轮返回 0 条；可能是来源近期未更新，或当前主题/频道路由没有命中，不判为连接故障"
      : !yieldedCandidate
        ? consecutiveZeroYield
          ? `来源连接与解析正常，本轮读取 ${rawCount} 条，但连续多轮没有窗口内候选；请检查发布时间、日期/关键词、去重或当前主题频道是否匹配`
          : `来源连接与解析正常，读取 ${rawCount} 条，但没有窗口内候选；常见原因是发布时间、日期/关键词、去重或当前主题频道不匹配`
        : `来源连接与解析正常，读取 ${rawCount} 条，保留 ${candidateCount} 条窗口内候选`;
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
