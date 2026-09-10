import { useState } from "react";
import type { traceDiscoveryUrl } from "../../server/discovery-trace.js";
export function DiscoveryTracePanel() {
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<ReturnType<typeof traceDiscoveryUrl>>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string>();
  return <details className="discovery-trace"><summary>查找漏掉的新闻链接</summary><form onSubmit={async event => {
    event.preventDefault(); setBusy(true); setError(undefined); setResult(undefined);
    try { const response = await fetch(`/api/discovery/trace?url=${encodeURIComponent(url.trim())}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setResult(data); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "诊断失败，请重试"); } finally { setBusy(false); }
  }}><label>原文链接<input aria-label="诊断原文链接" type="url" required value={url} onChange={event => setUrl(event.target.value)} placeholder="https://…" /></label><button className="secondary-button" disabled={busy}>{busy ? "正在查找…" : "查本地记录"}</button></form>
  {error ? <p role="alert">{error}</p> : null}{result ? <div role="status"><p><strong>{result.displayReason}</strong></p>{result.observations.map((entry, i) => <p key={`${entry.runId}-${i}`}>{entry.runAt} · {entry.label}<br /><small>{entry.title} · 原始日期 {entry.publishedAt ?? "未知"}{entry.dateBasis ? `（${entry.dateBasis}）` : ""}{entry.candidateId ? ` · 对应候选 ${entry.candidateId}` : ""}</small></p>)}<p>首次采到：{result.firstObservedAt ?? "未记录"}<br />首次候选：{result.firstCandidateAt ?? "未记录"}<br />首次记录进入推荐：{result.firstRecordedRecommendationAt ?? "未记录（旧运行不补推）"}</p><small>{result.monitoring}</small></div> : null}</details>;
}
