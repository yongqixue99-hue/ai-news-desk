import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, ChevronDown, ChevronUp, FileText, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import { api, type ProductJob } from "../api";

const activeStatuses = new Set<ProductJob["status"]>(["queued", "running", "retrying"]);

export const jobProgressPercent = (progress: number) => {
  if (!Number.isFinite(progress)) return 0;
  return Math.round(Math.max(0, Math.min(1, progress)) * 100);
};

export const jobActivitySummary = (job: ProductJob, now = Date.now()) => {
  const startedAt = Date.parse(job.createdAt);
  const heartbeatAt = Date.parse(job.heartbeatAt || job.updatedAt);
  const elapsedMinutes = Number.isFinite(startedAt)
    ? Math.max(0, Math.floor((now - startedAt) / 60_000))
    : 0;
  const heartbeatAge = Number.isFinite(heartbeatAt) ? Math.max(0, now - heartbeatAt) : Number.POSITIVE_INFINITY;
  const waiting = job.status === "queued" || job.status === "retrying";
  const stale = !waiting && heartbeatAge > 60_000;
  return {
    stage: job.status === "queued" ? (job.lane === "background" ? "等待空闲资源，优先处理你的主动任务" : "等待前面的主动任务完成") : job.stage?.trim() || statusLabel(job),
    elapsed: waiting ? `已等待 ${elapsedMinutes} 分钟` : elapsedMinutes < 1 ? "已运行不到 1 分钟" : `已运行 ${elapsedMinutes} 分钟`,
    freshness: waiting ? "任务已保存，刷新后可继续查看" : stale ? "超过 1 分钟没有响应，可能已中断" : "刚刚有响应",
    stale,
  };
};

const jobLabel = (job: ProductJob) => {
  if (job.type === "draft-from-editorial-intake") return "读取来源并生成文章";
  if (job.type === "build-content-package") return "准备文章资料";
  if (job.type === "supplement-story-evidence") return "补强独立新闻来源";
  if (job.type === "hydrate-story-assets") return "缓存新闻来源图片";
  if (job.type.includes("draft")) return "生成新闻草稿";
  if (job.type.includes("explanation") || job.type === "explain-story") return "读取新闻正文";
  return "后台处理任务";
};

const statusLabel = (job: ProductJob) => {
  if (job.status === "queued") return "等待处理";
  if (job.status === "running") return "正在处理";
  if (job.status === "retrying") return `正在重试（${job.attempts}/${job.maxAttempts}）`;
  if (job.status === "complete") return "已经完成";
  if (job.status === "cancelled") return "已经取消";
  return "处理失败";
};

const draftIdFrom = (job: ProductJob) => {
  if (!job.result || typeof job.result !== "object") return undefined;
  const value = (job.result as { draftId?: unknown }).draftId;
  return typeof value === "string" ? value : undefined;
};

const storyIdFrom = (job: ProductJob) => {
  if (!job.payload || typeof job.payload !== "object" || !("storyId" in job.payload)) return undefined;
  return typeof job.payload.storyId === "string" ? job.payload.storyId : undefined;
};
const storyTitleFrom = (job: ProductJob) => job.payload && typeof job.payload === "object" && "storyTitle" in job.payload && typeof job.payload.storyTitle === "string" ? job.payload.storyTitle : undefined;
const retryOf = (job: ProductJob) => job.payload && typeof job.payload === "object" && "retryOf" in job.payload ? job.payload.retryOf : undefined;
const failureCopy = (job: ProductJob) => /HTTP (?:401|403)/u.test(job.error ?? "") ? "来源暂时拒绝读取，选题已保留。"
  : /HTTP 404/u.test(job.error ?? "") ? "原文链接已失效，选题已保留。"
  : /超时|timeout|timed out/iu.test(job.error ?? "") ? "读取时间较长，选题已保留，可以重试。" : "这一步未完成，可回到选题继续处理。";

interface ProductJobCenterProps {
  onOpenStory: (storyId: string) => void;
  onOpenDraft: (draftId: string) => Promise<void> | void;
}

export function ProductJobCenter({ onOpenDraft, onOpenStory }: ProductJobCenterProps) {
  const [jobs, setJobs] = useState<ProductJob[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [retryingId, setRetryingId] = useState<string>();
  const [openingDraftId, setOpeningDraftId] = useState<string>();

  const openDraft = async (draftId: string) => {
    setOpeningDraftId(draftId);
    try {
      await onOpenDraft(draftId);
      setOpen(false);
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : String(openError));
    } finally {
      setOpeningDraftId(undefined);
    }
  };

  const refresh = useCallback(async () => {
    try {
      setJobs(await api.productJobs(100));
      setError(undefined);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  const retry = async (job: ProductJob) => {
    setRetryingId(job.id); setError(undefined);
    try { await api.retryPackageJob(job.id); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "重试未启动，请稍后再试。"); }
    finally { setRetryingId(undefined); }
  };

  const activeCount = useMemo(() => jobs.filter((job) => activeStatuses.has(job.status)).length, [jobs]);
  const visibleJobs = useMemo(() => jobs
    .filter((job) => {
      if (jobs.some((next) => retryOf(next) === job.id)) return false;
      if (activeStatuses.has(job.status)) return true;
      const updatedAt = Date.parse(job.updatedAt);
      const isRecent = Number.isFinite(updatedAt) && Date.now() - updatedAt < 24 * 60 * 60 * 1_000;
      return isRecent && (job.status === "failed" || Boolean(draftIdFrom(job)) || (job.status === "complete" && job.type === "build-content-package"));
    })
    .slice(0, 6), [jobs]);

  useEffect(() => {
    void refresh();
    const events = new EventSource("/api/events");
    events.addEventListener("jobs", (event) => {
      try {
        setJobs(JSON.parse((event as MessageEvent<string>).data) as ProductJob[]);
        setError(undefined);
      } catch {
        // Ignore one malformed frame; the next server snapshot is complete.
      }
    });
    events.onerror = () => setError("后台任务实时连接暂时中断，浏览器会自动重连");
    return () => events.close();
  }, [refresh]);

  const failedCount = visibleJobs.filter((job) => job.status === "failed").length;

  if (!visibleJobs.length && !error) return null;

  return (
    <aside className={open ? "product-job-center open" : "product-job-center"} aria-label="后台任务中心">
      <button
        type="button"
        className="product-job-toggle"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {activeCount ? <LoaderCircle className="spin" size={16} /> : error || failedCount ? <TriangleAlert size={16} /> : <Check size={16} />}
        <span>{activeCount ? `${activeCount} 个任务处理中` : error ? "任务状态读取失败" : failedCount ? `${failedCount} 项待处理` : "最近任务"}</span>
        {open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
      </button>
      {open ? (
        <div className="product-job-panel" aria-live="polite">
          <header><strong>任务进度</strong><button type="button" onClick={() => void refresh()} aria-label="刷新任务状态"><RotateCcw size={14} /></button></header>
          {error ? <div className="product-job-error"><TriangleAlert size={14} /><span>{error}</span></div> : null}
          <ol>
            {visibleJobs.map((job) => {
              const draftId = draftIdFrom(job);
              const storyId = storyIdFrom(job);
              const progressPercent = jobProgressPercent(job.progress);
              const active = activeStatuses.has(job.status);
              const activity = active ? jobActivitySummary(job) : undefined;
              return (
                <li key={job.id} className={`status-${job.status}${activity?.stale ? " status-stale" : ""}`}>
                  <span className="product-job-icon">{activeStatuses.has(job.status) ? <LoaderCircle className="spin" size={14} /> : job.status === "complete" ? <Check size={14} /> : <TriangleAlert size={14} />}</span>
                  <div>
                    <small>任务 {job.id.slice(-8)}</small>
                    <strong>{storyTitleFrom(job) || jobLabel(job)}</strong>
                    <span>{active ? job.status === "running" ? `${activity?.stage} · ${progressPercent}%` : activity?.stage : statusLabel(job)}</span>
                    {job.status === "running" ? <progress value={job.progress} max={1}>{progressPercent}%</progress> : null}
                    {activity ? <small>{activity.elapsed} · {activity.freshness}</small> : null}
                    {job.error ? <><small className="product-job-failure-copy">{failureCopy(job)}</small><details className="product-job-details"><summary>查看具体原因</summary><p>{job.error}</p></details></> : null}
                    <div className="product-job-row-actions">
                      {job.status === "failed" && ["build-content-package", "draft-from-package", "draft-from-editorial-intake", "draft-from-intake-review", "explain-story", "hydrate-story-assets", "supplement-story-evidence"].includes(job.type) ? <button type="button" disabled={Boolean(retryingId)} onClick={() => void retry(job)}><RotateCcw size={13} />{retryingId === job.id ? "正在重试…" : "重试任务"}</button> : null}
                      {!active && storyId ? <button type="button" onClick={() => { onOpenStory(storyId); setOpen(false); }}>{job.status === "complete" ? "继续写作" : "回到选题"}<ArrowRight size={13} /></button> : null}
                    </div>
                  </div>
                  {draftId ? <button type="button" disabled={Boolean(openingDraftId)} onClick={() => void openDraft(draftId)}><FileText size={13} />{openingDraftId === draftId ? "正在打开…" : "打开草稿"}</button> : null}
                </li>
              );
            })}
          </ol>
        </div>
      ) : null}
    </aside>
  );
}
