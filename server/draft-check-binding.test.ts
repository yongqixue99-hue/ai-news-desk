import assert from "node:assert/strict";
import test from "node:test";
import { bindDraftCheck, currentDocumentClaims, isDraftCheckCurrent } from "./draft-check-binding.js";
import { sourceChangesForPackage } from "./source-change-impact.js";
import { evaluateDraftPackageQuality } from "./editorial-quality-desk.js";
import type { ArticleDraft } from "./types.js";
import type { ContentPackage } from "./product-types.js";
const draft: ArticleDraft = { id:"d", runId:"r", candidateId:"c", createdAt:"2026-09-01", updatedAt:"2026-09-01", status:"editing", title:"模型价格发生变化", paragraphs:["GPT-5.5 的价格为 1 美元。"], bodyHtml:"<p>GPT-5.5 的价格为 1 美元。</p>", take:"", sources:[], uncertainties:[], images:[], community:"", topics:[], provenance:{originalUrl:"https://example.com", generatedBy:"test", contentPackageId:"p"}, factClaims:[{id:"c",claim:"GPT-5.5 的价格为 1 美元。",status:"full-source",capturedAt:"2026-09-01",factIds:["f"],sourceUrl:"https://example.com"}] };
const pack: ContentPackage = { id:"p",storyId:"s", mode:"brief",intent:"news",title:"t",createdAt:"2026-09-01",facts:[{id:"f",text:"GPT-5.5 的价格为 1 美元。",status:"supported",sourceSignalIds:["s"],sourceUrls:["https://example.com"]}],sources:[],sourceSignalIds:[],assets:[],imageIds:[],discussionSamples:[],communityFocus:[],uncertainties:[],suggestedAngles:[],communityEvidenceLabel:"",status:"ready",blockers:[] };
test("checks bind the rendered document, evidence metadata and frozen package", () => {
 const binding=bindDraftCheck(draft,pack); assert.equal(isDraftCheckCurrent(binding,draft,pack),true);
 assert.equal(isDraftCheckCurrent(binding,{...draft,bodyHtml:"<p>different</p>"},pack),false);
 assert.equal(isDraftCheckCurrent(binding,{...draft,factClaims:[]},pack),false);
 assert.equal(isDraftCheckCurrent(binding,draft,{...pack,facts:[]}),false);
});
test("edited HTML cannot borrow unchanged legacy paragraphs or fact mappings", () => {
 const edited={...draft,bodyHtml:"<p>GPT-5.5 的价格为 2 美元。</p>"};
 assert.equal(currentDocumentClaims(edited)[0]?.status,"unverified");
 assert.equal(evaluateDraftPackageQuality({draft:edited,contentPackage:pack}).ready,false);
});
test("newly read source changes list the exact affected frozen facts without overwriting them", () => {
 const source={signalId:"s",sourceKind:"article" as const,sourceLabel:"S",url:"https://example.com",originalTitle:"t",originalText:"old",originalLanguage:"en" as const,basis:"full-source" as const,capturedAt:"2026-09-01T00:00:00Z",truncated:false,rightsNotice:""};
 const p={...pack,sourceEvidence:[source]}; const before=JSON.stringify(p);
 const changes=sourceChangesForPackage(p,{ getSourceSnapshot: <T>() => ({urlKey:source.url,requestedUrl:source.url,canonicalUrl:source.url,capturedAt:"2026-09-02T00:00:00Z",page:{text:"new"} as T}) });
 assert.deepEqual(changes[0]?.affectedFactIds,["f"]); assert.equal(JSON.stringify(p),before);
});

test("a factual contradiction in the closing take is also blocked",()=> {
 const report=evaluateDraftPackageQuality({draft:{...draft,take:"GPT-5.5 的价格为 2 美元。"},contentPackage:pack});
 assert.ok(report.blockers.some(issue=>issue.message.startsWith("文末判断：")));
});
test("explicit fact review binds only the inspected document and chosen frozen facts",async()=>{
 const {bindReviewedParagraph}=await import("./draft-quality-review.js");
 const edited=structuredClone({...draft,bodyHtml:"<p>GPT-5.5：价格为 1 美元。</p>"});
 const store={getContentPackage:<T>()=>pack as T,getSourceSnapshot:<T>()=>undefined};
 const binding=bindDraftCheck(edited,pack);
 bindReviewedParagraph(edited,store,binding,0,["f"]);
 assert.equal(currentDocumentClaims(edited)[0]?.status,"full-source");
 assert.throws(()=>bindReviewedParagraph({...edited,title:"changed"},store,binding,0,["f"]),/变化/u);
});
test("source review acknowledgements expire when either document or frozen evidence changes",async()=>{
 const {reviewDraftQuality}=await import("./draft-quality-review.js");
 const p:ContentPackage={...pack,sourceEvidence:[{signalId:"s",sourceKind:"article",sourceLabel:"S",url:"https://example.com",originalTitle:"t",originalText:"old",originalLanguage:"en",basis:"full-source",capturedAt:"2026-09-01T00:00:00Z",truncated:false,rightsNotice:""}]};
 const store={getContentPackage:<T>()=>p as T,getSourceSnapshot:<T>()=>({urlKey:"u",requestedUrl:"https://example.com",canonicalUrl:"https://example.com",capturedAt:"2026-09-02T00:00:00Z",page:{text:"new"} as T})};
 const before=reviewDraftQuality(draft,store);const change=before.changes[0]!;
 const reviewed={...draft,sourceChangeReviews:[{...before.binding,url:change.url,observedHash:change.observedHash,reason:"已经核对变化，未影响本稿引用的价格事实。",reviewedAt:"2026-09-10"}]};
 assert.equal(reviewDraftQuality(reviewed,store).changes[0]?.reviewed,true);
 assert.equal(reviewDraftQuality({...reviewed,title:"changed"},store).changes[0]?.reviewed,false);
 p.facts=[{...p.facts[0]!,text:"changed fact"}];
 assert.equal(reviewDraftQuality(reviewed,store).changes[0]?.reviewed,false);
});
