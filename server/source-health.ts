import type { Candidate, CollectionSummary, RawHorizonItem, SourceConfig, SourceRouteResult, SourceRunResult, WorkflowRun } from "./types.js";

export const latestSourceCollection = (runs: WorkflowRun[]): CollectionSummary | undefined => {
  const completed = runs.flatMap((run) => {
    if ((run.origin && run.origin !== "collection") || !run.sourceResults?.length) return [];
    const collectedAt = run.collectedAt
      ?? run.logs.find((log) => log.stage === "采集原始条目" && /^已保留 \d+ 条原始记录/u.test(log.message))?.at
      ?? (["ready", "complete"].includes(run.status) ? run.completedAt ?? run.updatedAt : undefined);
    if (!collectedAt || !Number.isFinite(Date.parse(collectedAt))) return [];
    return [{ run, collectedAt }];
  }).sort((a, b) => Date.parse(b.collectedAt) - Date.parse(a.collectedAt));
  const latest = completed[0];
  if (!latest) return undefined;
  const { run, collectedAt } = latest;
  return {
    runId: run.id, collectedAt,
    sourceCount: run.sourceResults!.length,
    failedSourceCount: run.sourceResults!.filter((source) => source.status === "error").length,
    partialSourceCount: run.sourceResults!.filter((source) => source.status !== "error"
      && source.routes?.some((route) => route.status === "error")).length,
    rawCount: run.rawCount,
    candidateCount: run.candidates.length,
  };
};

const feedNameFor = (item: RawHorizonItem) =>
  typeof item.metadata?.feed_name === "string" ? item.metadata.feed_name : undefined;

const belongsToSource = (item: RawHorizonItem, source: SourceConfig) => {
  if (typeof item.metadata?.source_id === "string") return item.metadata.source_id === source.id;
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
  routeResults: SourceRouteResult[] = [],
): SourceRunResult[] => {
  const candidateRawIds = new Set(candidates.map((candidate) => candidate.rawId));
  return sources.map((source) => {
    const sourceItems = rawItems.filter((item) => belongsToSource(item, source));
    const candidateCount = sourceItems.filter((item) => candidateRawIds.has(item.id)).length;
    const rawCount = sourceItems.length;
    const failure = failures[source.id];
    const routes = routeResults.filter((route) => route.sourceId === source.id);
    const failedRoutes = routes.filter((route) => route.status === "error");
    const partial = failedRoutes.length > 0 && routes.some((route) => route.status === "success");
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
    const status = failure ? "error" : partial ? "warning" : yieldedCandidate ? "healthy" : "warning";
    const detail = failure
      ? `来源连接或解析失败：${failure}`
      : partial
        ? `部分读取路线失败（${routes.length - failedRoutes.length}/${routes.length} 条成功）；已读取 ${rawCount} 条，保留 ${candidateCount} 条候选，覆盖仍有缺口：${failedRoutes.map((route) => {
          let label = "来源路线";
          try { const url = new URL(route.url); label = `${url.hostname}${url.pathname}`; } catch { /* Keep a safe label. */ }
          return `${label}：${route.detail || "读取失败"}`;
        }).join("；").slice(0, 700)}`
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
      ...(routes.length ? { routes } : {}),
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

export interface SourceHealthLayers {
  connection: "ok" | "failed" | "unknown";
  parsing: "ok" | "empty" | "unknown";
  selection: "yielding" | "empty";
  originals: "read" | "partial" | "unknown";
}
export const sourceHealthLayers = (result: SourceRunResult, candidates: Candidate[]): SourceHealthLayers => ({
  connection: result.healthImpact === "neutral" ? "unknown" : result.healthImpact === "failure" ? "failed" : "ok",
  parsing: result.healthImpact !== "success" ? "unknown" : result.rawCount ? "ok" : "empty",
  selection: result.candidateCount ? "yielding" : "empty",
  originals: !candidates.length ? "unknown" : candidates.every(candidate => candidate.briefing?.basis === "full-source") ? "read"
    : candidates.some(candidate => candidate.briefing?.basis === "full-source") ? "partial" : "unknown",
});
