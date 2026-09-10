import assert from "node:assert/strict";
import test from "node:test";
import { renderArticleBlock, structuredDraftBodyHtml } from "./article-blocks.js";
import { currentDraftParagraphs } from "./draft-check-binding.js";
import type { ArticleDraft } from "./types.js";
test("headings, lists, code, quotes and tables round trip without executing source markup",()=>{
 const paragraphs=["适用条件","第一步\n第二步","  const example = '<script>';\n  return example;","型号\t限制\nA\t仅预览","作者明确的原句"];
 const draft:ArticleDraft={id:"d",runId:"r",candidateId:"c",createdAt:"2026-09-10",updatedAt:"2026-09-10",status:"editing",title:"测试",paragraphs,take:"",sources:[],images:[],uncertainties:[],community:"",topics:[],provenance:{originalUrl:"https://example.com",generatedBy:"test"}};
 const kinds=["heading","ordered-list","code","table","quote"] as const;
 draft.bodyHtml=structuredDraftBodyHtml(draft,kinds.map((kind,paragraphIndex)=>({kind,paragraphIndex})));
 for(const tag of ["h2","ol","pre","table","blockquote"])assert.ok(draft.bodyHtml.includes(`<${tag}>`));
 assert.equal(draft.bodyHtml.includes("<script>"),false); assert.deepEqual(currentDraftParagraphs(draft),paragraphs);
 assert.throws(()=>renderArticleBlock("A\tB\nonly one cell",{kind:"table",paragraphIndex:0}),/表格/u);
});
