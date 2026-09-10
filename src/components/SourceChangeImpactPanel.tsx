import { useState } from "react";
import type { affectedDraftsForSourceChanges } from "../../server/source-change-impact.js";
export function SourceChangeImpactPanel() {
  const [items, setItems] = useState<ReturnType<typeof affectedDraftsForSourceChanges>>();
  const [error, setError] = useState("");
  return <details className="discovery-trace" onToggle={async event => {
    if (!event.currentTarget.open) return;
    setItems(undefined); setError("");
    try {
      const response = await fetch("/api/source-changes");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setItems(data);
    } catch (failure) { setError(failure instanceof Error ? failure.message : "检查失败"); }
  }}><summary>来源变化影响的稿件</summary>
    <p>比较本地新读取的原文与冻结快照；打开草稿的“资料”面板可记录核对结论。</p>
    {error ? <p role="alert">{error}</p> : !items ? <p>正在核对本地快照…</p> : !items.length ? <p>已存快照中未发现变化；未重新读取的来源状态未知。</p> : items.map(item => <article key={item.draftId}><strong>{item.title}</strong>{item.changes.map(change => <p key={change.url}><a href={change.url} target="_blank" rel="noreferrer">{change.url}</a><br />受影响事实：{change.affectedFactIds.join("、") || "原文工作副本"} · 新读取于 {change.observedAt}</p>)}</article>)}
  </details>;
}
