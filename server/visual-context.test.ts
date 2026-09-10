import assert from "node:assert/strict";
import test from "node:test";
import { auditVisualContext } from "./visual-context.js";
import { planEditorialImagePlacements } from "./editorial-image-policy.js";
const image = { id:"known",url:"https://storage.googleapis.com/gemini-3-8-cyber__evals__cwe-ben.webp", caption:"Gemini 3.8 Flash Cyber StaticBench", width:2000,height:1125 };
test("source caption conflicts are quarantined even when the model copies the caption faithfully", () => {
 assert.equal(auditVisualContext(image,"Gemini 3.8 Flash Cyber 在 CWE-Bench 上的结果。")[0]?.code,"source-caption-conflict");
 assert.equal(planEditorialImagePlacements({availableImages:[image],modelSelections:[{imageId:"known",afterParagraph:0,caption:image.caption}],paragraphs:["Gemini 3.8 Flash Cyber 在 CWE-Bench 上的结果。"],imageLimit:2}).length,0);
 assert.deepEqual(auditVisualContext(image,"Gemini 3.8 Flash Cyber 在 CWE-Bench 上的结果。","Gemini 3.8 Flash Cyber · CWE-Bench"),[]);
});
test("known chart methods cannot silently generalize to other models", () => {
 const chart={...image,url:"https://storage.googleapis.com/agentic-video__evals.webp",caption:"效率对比"};
 assert.equal(auditVisualContext(chart,"Gemini 3.7 Flash 改善视频理解。")[0]?.code,"visual-conditions-missing");
 assert.deepEqual(auditVisualContext(chart,"Gemini 3.7 Flash", "Gemini 3.7 Flash；high thinking，low media resolution，静态 1 FPS；准确率相对增益。"),[]);
});
test("same topic is not the same model or experimental episode", () => {
 const chart={...image,url:"https://qianwen-res.oss-accelerate-overseas.aliyuncs.com/EC-Bench/fig6_bankruptcy.png",caption:"一次破产的逐日过程"};
 assert.equal(auditVisualContext(chart,"GPT-5.5 在一月破产。")[0]?.code,"visual-case-mismatch");
 assert.ok(auditVisualContext({...chart,url:"https://example.com/plot",caption:"Qwen3.5-Plus Episode 0"},"Qwen3.5-Plus Episode 1 的结果").some(issue=>issue.code==="visual-run-mismatch"));
});
