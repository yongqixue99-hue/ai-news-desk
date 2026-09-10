import { DatabaseSync } from "node:sqlite";
import { writingMemoryView } from "./learning-desk.js";
import type { LocalDatabase } from "./local-database.js";
import type { WritingMemoryKind } from "./types.js";

// Only these audited instructions can reach the model. Retrieved edits are evidence for preference, never new article facts.
const guidelines: Record<WritingMemoryKind,string> = {
 "remove-promotional-language":"删除宣传式用词，保留可核验的具体变化。",
 "prefer-specific-numbers":"需要数字时仅使用本篇冻结事实中已有且核验过的数字及其条件；不得为了具体而补造数字。",
 "shorter-introduction":"缩短导语，优先说明本篇已核验的变化，保留关键限定。",
 "fewer-headings":"减少不必要的小标题，保留原文步骤、表格和必要层级。",
 "preserve-community-quotes":"仅保留本篇冻结讨论样本中有作者与永久链接的原句，不扩大样本结论。",
 "shorter-paragraphs":"适当拆短段落，不删事实条件、单位、归属或引用。",
 "higher-image-density":"在现有合格素材内增加有用配图；不得放宽权利、型号、实验条件或图文匹配检查。",
};
export const preferenceTerms = (text: string) => {
 const normalized=text.normalize("NFKC").toLowerCase().slice(0,1000);
 const words: string[] = [...(normalized.match(/[a-z][a-z0-9_-]{1,30}/gu) ?? [])];
 for(const run of normalized.match(/[\p{Script=Han}]{2,}/gu) ?? []) for(let i=0;i<run.length-1;i++)words.push(run.slice(i,i+2));
 return [...new Set(words)].filter(word=>!["the","and","for","with","this","that","发布","模型"].includes(word)).slice(0,40);
};
export const rankWritingContexts = (documents: Array<{id:string;text:string}>, query: string, method: "fts5-bm25"|"term-overlap"="fts5-bm25") => {
 const terms=preferenceTerms(query);if(!terms.length||!documents.length)return [];
 if(method==="term-overlap")return documents.map(doc=>({id:doc.id,score:terms.filter(term=>preferenceTerms(doc.text).includes(term)).length})).filter(hit=>hit.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
 const index=new DatabaseSync(":memory:");
 try {index.exec("CREATE VIRTUAL TABLE preferences USING fts5(id UNINDEXED, context)");
 const insert=index.prepare("INSERT INTO preferences(id,context) VALUES (?,?)");
 for(const doc of documents)insert.run(doc.id,preferenceTerms(doc.text).join(" "));
 return (index.prepare("SELECT id, -bm25(preferences) AS score FROM preferences WHERE preferences MATCH ? ORDER BY bm25(preferences), id LIMIT 20").all(terms.map(term=>`\"${term}\"`).join(" OR ")) as unknown as Array<{id:string;score:number}>);
 } finally {index.close();}
};
export interface WritingPreferencePlan {
 version:"writing-preferences/v1"; method:"fts5-bm25"|"term-overlap"|"global-stable"|"disabled"; reason:string; queryTerms:string[];
 selected:Array<{memoryId:string;kind:WritingMemoryKind;guideline:string;reason:string;evidence:Array<{eventId:string;draftId:string;confirmationId:string}>}>;
}
export const writingPreferencePlan = (database: LocalDatabase, input:{enabled?:boolean;title?:string;topics?:string[];intent?:string;mode?:string}={}):WritingPreferencePlan => {
 const view=writingMemoryView(database,input.enabled!==false);
 const empty:WritingPreferencePlan={version:"writing-preferences/v1",method:"disabled",reason:input.enabled===false?"写作记忆已关闭":input.intent==="source"?"原文工作副本保持原作者结构与表达":!view.applicationUnlocked?"尚不足五次有效人工确认修改":"没有至少来自三篇确认稿的稳定偏好",queryTerms:[],selected:[]};
 if(input.enabled===false||input.intent==="source"||!view.applicationUnlocked)return empty;
 const memories=view.memories.filter(memory=>memory.applicable && Object.hasOwn(guidelines,memory.kind) && (memory.kind!=="preserve-community-quotes"||input.intent==="community"));
 if(!memories.length)return empty;
 const query=[input.title,...(input.topics??[]),input.mode].filter(Boolean).join(" ");
 const documents=memories.flatMap(memory=>memory.evidence.filter(e=>e.confirmationId&&e.context).map(e=>({id:`${memory.id}:${e.eventId}`,text:e.context!})));
 let method:WritingPreferencePlan["method"]="fts5-bm25",hits:Array<{id:string;score:number}>;
 try {hits=rankWritingContexts(documents,query);}catch {method="term-overlap";hits=rankWritingContexts(documents,query,"term-overlap");}
 const ranked=memories.map(memory=>({memory,hits:hits.filter(hit=>hit.id.startsWith(`${memory.id}:`))})).sort((a,b)=>(b.hits[0]?.score??0)-(a.hits[0]?.score??0)||b.memory.evidenceCount-a.memory.evidenceCount||a.memory.id.localeCompare(b.memory.id));
 if(!hits.length)method="global-stable";
 return {version:"writing-preferences/v1",method,queryTerms:preferenceTerms(query),reason:hits.length?"按当前题目检索已确认的表达偏好，原稿文字不进入事实包":"未找到同主题样本，仅采用跨稿重复出现的通用表达偏好",selected:ranked.slice(0,3).map(({memory,hits})=>({memoryId:memory.id,kind:memory.kind,guideline:guidelines[memory.kind],reason:hits.length?"当前主题命中了历史确认稿":"至少三篇独立确认稿重复支持",evidence:memory.evidence.filter(e=>e.confirmationId).sort((a,b)=>Number(hits.some(hit=>hit.id.endsWith(b.eventId)))-Number(hits.some(hit=>hit.id.endsWith(a.eventId)))).slice(0,5).map(e=>({eventId:e.eventId,draftId:e.draftId,confirmationId:e.confirmationId!}))}))};
};
