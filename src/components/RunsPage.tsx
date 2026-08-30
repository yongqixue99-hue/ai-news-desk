import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, Ban, CheckCircle2, ChevronDown, Clock3, ExternalLink, Filter, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { AiRunTrace, WorkflowRun } from "../types";

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(iso));

const displayRunStage = (stage: string) => stage.replace("生成中文速读", "生成中文摘要");

export function RunsPage({
  runs,
  onOpenRun,
  onRetry,
  onOpenSchedule,
  aiRunTraces,
}: {
  runs: WorkflowRun[];
  onOpenRun: (runId: string) => void;
  onRetry: (runId: string) => void;
  onOpenSchedule: () => void;
  aiRunTraces: AiRunTrace[];
}) {
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "success" | "failed">("all");
  const [originFilter, setOriginFilter] = useState<"all" | "collection" | "intake" | "scheduled">("all");
  const [expandedRunId, setExpandedRunId] = useState<string>();
  const filteredRuns = useMemo(() => runs.filter((run) => {
    const active = ["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status);
    const statusMatches = statusFilter === "all"
      || (statusFilter === "active" && active)
      || (statusFilter === "success" && ["ready", "complete"].includes(run.status))
      || (statusFilter === "failed" && ["failed", "cancelled"].includes(run.status));
    const originMatches = originFilter === "all"
      || (originFilter === "scheduled" && run.scheduled)
      || (originFilter === "intake" && Boolean(run.origin))
      || (originFilter === "collection" && !run.scheduled && !run.origin);
    return statusMatches && originMatches;
  }), [originFilter, runs, statusFilter]);
  return (
    <div className="page settings-page runs-page">
      <header className="page-header"><div><h1>运行记录</h1><p>每次采集、成稿和错误都有可追溯记录。</p></div><button className="secondary-button" onClick={onOpenSchedule}><ArrowLeft size={16} />返回定时任务</button></header>
      <div className="run-history-filters" aria-label="筛选运行记录">
        <span><Filter size={14} />筛选</span>
        <select aria-label="按状态筛选" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}><option value="all">全部状态</option><option value="active">运行中</option><option value="success">已完成</option><option value="failed">失败／取消</option></select>
        <select aria-label="按触发方式筛选" value={originFilter} onChange={(event) => setOriginFilter(event.target.value as typeof originFilter)}><option value="all">全部方式</option><option value="collection">手动采集</option><option value="intake">截图／链接</option><option value="scheduled">定时心跳</option></select>
        <small>显示 {filteredRuns.length} / {runs.length}</small>
      </div>
      <div className="run-history-table">
        <div className="run-history-head"><span>状态</span><span>运行时间</span><span>触发方式</span><span>搜索范围</span><span>原始条目</span><span>候选／成稿</span><span>最后阶段</span><span /></div>
        {!filteredRuns.length ? <div className="run-history-empty">没有符合筛选条件的运行记录。</div> : filteredRuns.map((run) => {
          const draftCount = run.candidates.filter((candidate) => candidate.status === "drafted").length;
          const active = ["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status);
          const empty = !active && !["failed", "cancelled"].includes(run.status) && run.candidates.length === 0;
          const retryable = run.status === "failed" || run.status === "cancelled" || empty;
          return (
            <div className="run-history-entry" key={run.id}>
            <div className={empty ? "run-history-row empty" : "run-history-row"}>
              <span className={`run-status-icon ${empty ? "empty" : run.status}`}>{active ? <LoaderCircle className="spin" size={17} /> : run.status === "failed" ? <AlertCircle size={17} /> : run.status === "cancelled" ? <Ban size={17} /> : empty ? <TriangleAlert size={17} /> : <CheckCircle2 size={17} />}</span>
              <div><strong>{formatDateTime(run.createdAt)}</strong><small>{run.id}</small></div>
              <span>{run.scheduled ? "定时心跳" : "手动"}</span>
              <span title={run.keywords ? `关键词：${run.keywords}` : undefined}>{run.dateFrom && run.dateTo ? `${run.dateFrom.slice(5)} 至 ${run.dateTo.slice(5)}` : `${run.windowHours} 小时`}</span>
              <span>{run.rawCount}</span>
              <span>{run.candidates.length} / {draftCount}</span>
              <span>{run.error ?? (empty ? "完成，但未找到候选；请检查来源日志" : displayRunStage(run.stage))}</span>
              <div className="run-history-actions">
                {retryable ? <button className="icon-link retry" onClick={() => onRetry(run.id)} title="按原配置重试"><RotateCcw size={16} /></button> : null}
                <button className="icon-link" onClick={() => onOpenRun(run.id)} title="打开本次候选"><ExternalLink size={16} /></button>
                <button className="icon-link" aria-expanded={expandedRunId === run.id} onClick={() => setExpandedRunId((current) => current === run.id ? undefined : run.id)} title="查看运行详情"><ChevronDown size={16} /></button>
              </div>
            </div>
            {expandedRunId === run.id ? (() => {
              const traces = aiRunTraces.filter((trace) => run.generation?.traceIds?.includes(trace.id)
                || run.briefingTraceIds?.includes(trace.id)
                || trace.subjectId && run.candidates.some((candidate) => candidate.id === trace.subjectId));
              const failedSources = (run.sourceResults ?? []).filter((source) => source.status !== "healthy");
              return <div className="run-detail-panel">
                <div><strong>来源结果</strong><span>{run.sourceResults?.length ?? 0} 个来源 · {failedSources.length} 个异常</span>{failedSources.map((source) => <small key={source.sourceId}>{source.sourceName}：{source.detail}</small>)}</div>
                <div><strong>过滤漏斗</strong><span>{run.rawCount} 原始 → {run.filteredRawCount ?? run.rawCount} 符合检索 → {run.candidates.length} 候选</span></div>
                <div><strong>AI 任务</strong>{traces.length ? traces.map((trace) => <span key={trace.id}>{trace.requestedProvider.name || trace.requestedProvider.id} · {trace.requestedProvider.model} · {trace.status === "succeeded" ? "成功" : trace.status === "failed" ? "失败" : "运行中"} · {trace.durationMs !== undefined ? `${(trace.durationMs / 1000).toFixed(1)} 秒` : "计时中"}<small>Replay {trace.replayId}{trace.errors[0] ? ` · ${trace.errors[0].category}：${trace.errors[0].message}` : ""}</small></span>) : <span>本次没有 AI 调用，或是升级前的历史记录。</span>}</div>
                <div><strong>最近日志</strong>{run.logs.slice(-5).reverse().map((log, index) => <small key={`${log.at}-${index}`}>{formatDateTime(log.at)} · {displayRunStage(log.stage)} · {log.message}</small>)}</div>
              </div>;
            })() : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
