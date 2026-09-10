import { draftDocumentKey } from "./draft-document.js";
import type { LocalDatabase } from "./local-database.js";
import type { ArticleDraft } from "./types.js";
export const reworkReasons = { fact: "事实错误", condition: "条件遗漏", repetition: "内容重复", structure: "结构不顺", translation: "翻译腔", image: "图文不符", headline: "标题夸张", angle: "主动调整角度" } as const;
export const recordEditObservation = (database: Pick<LocalDatabase,"recordWorkflowEvent" | "hasWorkflowEvent">, draft: ArticleDraft, input: { id: string; documentKey: string; reasons: string[]; userEditMinutes?: number | null; note?: string }) => {
  if (!/^[a-zA-Z0-9-]{8,80}$/u.test(input.id) || input.documentKey !== draftDocumentKey(draft)) throw new Error("稿件版本已变化，请保存后再记录返工");
  if (!Array.isArray(input.reasons) || !input.reasons.length || input.reasons.some(reason => !Object.hasOwn(reworkReasons, reason))) throw new Error("请选择实际发生的返工原因");
  if (input.userEditMinutes !== undefined && input.userEditMinutes !== null && (!Number.isFinite(input.userEditMinutes) || input.userEditMinutes < 0 || input.userEditMinutes > 1440)) throw new Error("人工编辑时间需为 0–1440 分钟，未测量请留空");
  if (input.note && input.note.length > 1000) throw new Error("备注请保持在 1000 字内");
  const subjectId = `${draft.id}:${input.id}`;
  if (database.hasWorkflowEvent("draft.edit-observation",subjectId)) return { reused:true };
  database.recordWorkflowEvent({type:"draft.edit-observation",subjectType:"draft",subjectId,payload:{draftId:draft.id,revisionId:draft.revisionId,
    confirmationId:draft.editorialBaseline?.confirmed?.id,reasons:[...new Set(input.reasons)],userEditMinutes:input.userEditMinutes ?? null,
    timingBasis:input.userEditMinutes == null?"unmeasured":"user-reported",note:input.note?.trim()||undefined}});
  return {reused:false};
};
