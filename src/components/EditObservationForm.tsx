import { useState } from "react";
import { reworkReasons } from "../../server/edit-observation.js";
import { draftDocumentKey } from "../../server/draft-document.js";
import type { ArticleDraft } from "../types";
export function EditObservationForm({draft,dirty}:{draft:ArticleDraft;dirty:boolean}) {
 const [reasons,setReasons]=useState<string[]>([]); const [minutes,setMinutes]=useState("");const [note,setNote]=useState("");const [message,setMessage]=useState("");const [busy,setBusy]=useState(false);const [id,setId]=useState(()=>crypto.randomUUID());
 return <details className="edit-observation"><summary>记录实际返工</summary><form onSubmit={async event=>{event.preventDefault();setBusy(true);setMessage("");try {
 const response=await fetch(`/api/drafts/${encodeURIComponent(draft.id)}/edit-observation`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id,documentKey:draftDocumentKey(draft),reasons,userEditMinutes:minutes.trim()?Number(minutes):null,note})});const result=await response.json();if(!response.ok)throw new Error(result.error);setMessage("已记录本次返工；未测量的时间保持未知。");setId(crypto.randomUUID());setReasons([]);setMinutes("");setNote("");
 }catch(error){setMessage(error instanceof Error?error.message:"记录失败，请重试");}finally{setBusy(false);}}}>
 <fieldset><legend>这次为什么改</legend>{Object.entries(reworkReasons).map(([key,label])=><label key={key}><input type="checkbox" checked={reasons.includes(key)} onChange={event=>setReasons(current=>event.target.checked?[...current,key]:current.filter(reason=>reason!==key))}/>{label}</label>)}</fieldset>
 <label>人工编辑分钟数（未测量留空）<input type="number" min="0" max="1440" step="0.1" value={minutes} onChange={event=>setMinutes(event.target.value)}/></label><label>补充说明<textarea maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/></label><button className="secondary-button" disabled={busy||dirty||!reasons.length}>{dirty?"先保存当前正文":busy?"记录中…":"记录本次返工"}</button>{message?<p role="status">{message}</p>:null}</form></details>;
}
