import assert from "node:assert/strict";
import test from "node:test";
import { recordEditObservation } from "./edit-observation.js";
import { draftDocumentKey } from "./draft-document.js";
import type { ArticleDraft } from "./types.js";
test("rework keeps unmeasured time null, binds the document and deduplicates retries",()=>{
 const draft={id:"d",title:"test",paragraphs:["text"],take:"",provenance:{originalUrl:"https://example.com",generatedBy:"test"}} as ArticleDraft;
 const recorded:Array<any>=[];
 const store={hasWorkflowEvent:(_type:string,id:string)=>recorded.some(event=>event.subjectId===id),recordWorkflowEvent:(event:any)=>{recorded.push(event);return {...event,id:"e",createdAt:"2026-09-10"};}};
 const input={id:"request-001",documentKey:draftDocumentKey(draft),reasons:["condition"]};
 assert.equal(recordEditObservation(store,draft,input).reused,false);assert.equal(recorded[0].payload.userEditMinutes,null);
 assert.equal(recordEditObservation(store,draft,input).reused,true);assert.equal(recorded.length,1);
 assert.throws(()=>recordEditObservation(store,{...draft,title:"changed"},input),/版本/u);
});
