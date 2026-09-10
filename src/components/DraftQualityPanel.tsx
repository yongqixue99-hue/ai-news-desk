import { useEffect, useState } from "react";
import type { ArticleDraft } from "../types";
import type { reviewDraftQuality } from "../../server/draft-quality-review.js";
import { draftDocumentKey } from "../../server/draft-document.js";
type Review = ReturnType<typeof reviewDraftQuality>;
export function DraftQualityPanel({ draft, dirty, onReviewed }: { draft: ArticleDraft; dirty: boolean; onReviewed: (draft: ArticleDraft) => void }) {
  const [review, setReview] = useState<Review>(); const [key, setKey] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Record<number,string[]>>({}); const [reasons, setReasons] = useState<Record<string,string>>({});
  const currentKey = draftDocumentKey(draft); const stale = dirty || key !== currentKey;
  const load = async () => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/quality-check`); const data = await response.json(); if (!response.ok) throw new Error(data.error); setReview(data); setKey(currentKey); }
    catch (error) { setError(error instanceof Error ? error.message : "检查未完成"); } finally { setBusy(false); }
  };
  useEffect(() => { let active = true; setReview(undefined); setSelected({}); setError("");
    if (dirty) return;
    setBusy(true);
    fetch(`/api/drafts/${encodeURIComponent(draft.id)}/quality-check`).then(async response => { const data = await response.json(); if (!response.ok) throw new Error(data.error); if (active) { setReview(data); setKey(currentKey); } }).catch(error => { if(active) setError(error.message); }).finally(()=>{if(active)setBusy(false);});
    return () => { active = false; };
  }, [draft.id,draft.updatedAt,dirty]);
  const submit = async (route: string, body: unknown) => {
    setBusy(true); setError("");
    try { const response = await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/${route}`, { method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body) }); const data=await response.json(); if(!response.ok)throw new Error(data.error); onReviewed(data); }
    catch (error) { setError(error instanceof Error ? error.message : "核对未保存"); } finally { setBusy(false); }
  };
  return <section className="utility-section draft-quality-review" aria-label="当前版本核对"><div className="inspector-heading"><h3>当前版本核对</h3><button className="text-button" disabled={busy||dirty} onClick={()=>void load()}>重新检查</button></div>
    {draft.provenance.writingMemory ? <details><summary>本次成稿的表达偏好（{draft.provenance.writingMemory.selected.length}）</summary><p>{draft.provenance.writingMemory.reason}</p>{draft.provenance.writingMemory.selected.map(item=><p key={item.memoryId}>{item.guideline}<br /><small>{item.reason} · 依据稿件 {item.evidence.map(e=>e.draftId).join("、")}</small></p>)}<small>这是生成时的历史记录；关闭或删除偏好只影响之后的生成。</small></details> : null}
    {dirty ? <p role="status">正文有未保存修改，保存后更新检查。</p> : busy ? <p role="status">正在核对本地材料…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {review && !stale ? <><p><strong>{review.ready ? "已完成当前版本的规则检查" : `${review.blockers.length} 项需要核对`}</strong></p><small>修订 {draft.revisionId?.slice(-8) || "旧稿"} · 素材 {review.binding.packageHash?.slice(0,8) || "未绑定"}。规则通过仍需人工审稿。</small>
      {review.blockers.map((message,index)=><p className="quality-review-issue" key={index}>{message}</p>)}
      {review.unmapped.length && review.facts.length ? <details><summary>重新绑定改过的正文（{review.unmapped.length}）</summary>{review.unmapped.map(block=><fieldset key={block.index}><legend>正文块 {block.index+1}</legend><p>{block.text}</p><div className="fact-choice-list">{review.facts.map(fact=><label key={fact.id}><input type="checkbox" checked={(selected[block.index]??[]).includes(fact.id)} onChange={event=>setSelected(current=>({...current,[block.index]:event.target.checked?[...(current[block.index]??[]),fact.id]:(current[block.index]??[]).filter(id=>id!==fact.id)}))}/><span>{fact.text}</span></label>)}</div><button className="secondary-button" disabled={busy||!selected[block.index]?.length} onClick={()=>void submit("review-fact",{binding:review.binding,index:block.index,factIds:selected[block.index]})}>已核对，绑定所选事实</button></fieldset>)}</details> : null}
      {review.changes.map(change=><details key={change.url}><summary>来源变更{change.reviewed?" · 已记录核对":" · 待核对"}</summary><a href={change.url} target="_blank" rel="noreferrer">打开来源</a><p>{change.reason}</p><p>受影响事实：{change.affectedFactIds.join("、")||"原文工作副本"}</p>{!change.reviewed?<><label>此稿仍适用的核对结论<textarea value={reasons[change.url]??""} maxLength={1000} onChange={event=>setReasons(current=>({...current,[change.url]:event.target.value}))}/></label><button className="secondary-button" disabled={busy||(reasons[change.url]?.trim().length??0)<10} onClick={()=>void submit("review-source-change",{url:change.url,observedHash:change.observedHash,documentHash:review.binding.documentHash,reason:reasons[change.url]})}>记录已核对结论</button></>:null}</details>)}
      {review.warnings.length?<details><summary>其他检查提示（{review.warnings.length}）</summary>{review.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</details>:null}
    </>:null}
  </section>;
}
