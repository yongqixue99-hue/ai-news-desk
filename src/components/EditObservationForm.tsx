import { useCallback, useEffect, useState } from "react";
import { reworkReasons } from "../../server/edit-observation.js";
import { draftDocumentKey } from "../../server/draft-document.js";
import type { draftReworkChanges, summarizeReworkObservations } from "../../server/draft-rework.js";
import type { ArticleDraft } from "../types";

type Report = { changes: ReturnType<typeof draftReworkChanges>; observations: ReturnType<typeof summarizeReworkObservations> };
export function EditObservationForm({ draft, dirty }: { draft: ArticleDraft; dirty: boolean }) {
  const [open, setOpen] = useState(false), [report, setReport] = useState<Report>();
  const [reasons, setReasons] = useState<string[]>([]), [minutes, setMinutes] = useState(""), [note, setNote] = useState("");
  const [message, setMessage] = useState(""), [readError, setReadError] = useState(""), [busy, setBusy] = useState(false), [id, setId] = useState(() => crypto.randomUUID());
  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/rework`, { signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "暂时无法读取返工记录");
    if (!signal?.aborted) { setReport(result); setReadError(""); }
  }, [draft.id]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void load(controller.signal).catch(error => { if (!controller.signal.aborted) setReadError(error instanceof Error ? error.message : "暂时无法读取返工记录"); });
    return () => controller.abort();
  }, [open, draft.updatedAt, load]);
  return <details className="edit-observation" onToggle={event => setOpen(event.currentTarget.open)}><summary>改稿记录与返工原因</summary>
    {report ? <div className="rework-summary">
      {report.changes ? <><strong>{report.changes.baseline === "initial" ? "初稿 → 当前保存稿" : "最早可用稿 → 当前保存稿"}</strong><p>标题{report.changes.titleChanged ? "已修改" : "保留"}；{report.changes.retainedBlocks === null ? "正文过长，未计算改动量" : `正文保留 ${report.changes.retainedBlocks} 块，改写或删除 ${report.changes.changedOrRemovedBlocks} 块，新增或改写 ${report.changes.addedOrChangedBlocks} 块`}。</p><p>配图新增 {report.changes.addedImages} 张、移除 {report.changes.removedImages} 张；图注修改 {report.changes.changedCaptions} 处。</p>{report.changes.recentAiAssistance ? <small>自上次确认以来的修改含 AI 协助。</small> : null}</> : <p>这篇草稿没有可对照的初稿基线。</p>}
      <p>最近 30 天保留 {report.observations.records} 次返工记录。{report.observations.measuredRecords ? `自填编辑耗时合计 ${report.observations.userReportedMinutes} 分钟。` : "编辑耗时尚未测量。"}{report.observations.unmeasuredRecords ? `${report.observations.unmeasuredRecords} 次未测量。` : ""}</p>
      {report.observations.reasons.length ? <p>{report.observations.reasons.map(reason => `${reason.label} ${reason.records} 次`).join(" · ")}</p> : null}
      {report.observations.coverage.truncated ? <small>记录超过读取上限，以上仅统计已读取部分。</small> : null}
      <small>{dirty ? "上方比较基于最近保存稿；保存后更新。" : "改动量只描述编辑，不判断品质或事实对错。"}</small>
    </div> : null}
    {readError ? <p role="status">{readError}</p> : null}
    <form onSubmit={async event => {
      event.preventDefault(); setBusy(true); setMessage("");
      try {
        const response = await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/edit-observation`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, documentKey: draftDocumentKey(draft), reasons, userEditMinutes: minutes.trim() ? Number(minutes) : null, note }) });
        const result = await response.json(); if (!response.ok) throw new Error(result.error);
        setMessage("已记录本次返工；未测量的时间保持未知。"); setId(crypto.randomUUID()); setReasons([]); setMinutes(""); setNote("");
        await load().catch(() => setReadError("记录已保存，统计暂时无法刷新"));
      } catch (error) { setMessage(error instanceof Error ? error.message : "记录失败，请重试"); }
      finally { setBusy(false); }
    }}>
      <fieldset disabled={busy}><legend>这次为什么改（可选记录）</legend>{Object.entries(reworkReasons).map(([key, label]) => <label key={key}><input type="checkbox" checked={reasons.includes(key)} onChange={event => setReasons(current => event.target.checked ? [...current, key] : current.filter(reason => reason !== key))} />{label}</label>)}</fieldset>
      <label>人工编辑分钟数（未测量留空）<input type="number" min="0" max="1440" step="0.1" value={minutes} onChange={event => setMinutes(event.target.value)} /></label>
      <label>补充说明<textarea maxLength={1000} value={note} onChange={event => setNote(event.target.value)} /></label>
      <button className="secondary-button" disabled={busy || dirty || !reasons.length}>{dirty ? "先保存当前正文" : busy ? "记录中…" : "记录本次返工"}</button>
      {message ? <p role="status">{message}</p> : null}
    </form>
  </details>;
}
