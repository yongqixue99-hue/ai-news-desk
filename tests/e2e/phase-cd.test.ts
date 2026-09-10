import { structuredDraftBodyHtml } from "../../server/article-blocks.js";
import { sourceSnapshotKey } from "../../server/source-snapshot.js";
import type { ContentPackage } from "../../server/product-types.js";
import { appendDraftRevision } from "../../server/draft-revisions.js";
import { draftDocumentKey } from "../../server/draft-document.js";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import type { ArticleDraft } from "../../server/types.js";
import { createDefaultState } from "../../server/defaults.js";
import { rawItemToCandidate } from "../../server/scoring.js";
import { buildTodayView } from "../../server/story-desk.js";
import { LocalDatabase } from "../../server/local-database.js";

const draftFixture = (id: string, title: string): ArticleDraft => ({
  id, title, candidateId: id, runId: "test-run", status: "editing",
  createdAt: "2026-09-05T00:00:00Z", updatedAt: "2026-09-05T00:00:00Z",
  paragraphs: ["用于核对草稿打开行为的测试正文。"], bodyHtml: "<p>用于核对草稿打开行为的测试正文。</p>",
  take: "", sources: [], uncertainties: [], images: [], community: "", topics: [],
  provenance: { originalUrl: `https://example.com/${id}`, generatedBy: "codex-cli", authoringMode: "human-first" },
});

const freePort = () => new Promise<number>((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const port = (server.address() as AddressInfo).port;
    server.close((error) => error ? reject(error) : resolve(port));
  });
});

const waitForHealth = async (url: string, output: () => string) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const response = await fetch(`${url}/api/health`).catch(() => undefined);
    if (response?.ok) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`isolated server did not become healthy\n${output()}`);
};

const waitForExit = (
  child: ReturnType<typeof spawn>,
  timeoutMs: number,
) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise<boolean>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (exited: boolean) => {
      if (timer) clearTimeout(timer);
      child.off("exit", onExit);
      resolve(exited);
    };
    const onExit = () => finish(true);
    child.once("exit", onExit);
    timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
  });
};

const stopProcessTree = async (child: ReturnType<typeof spawn>) => {
  const pid = child.pid;
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform !== "win32" && pid) process.kill(-pid, "SIGTERM");
    else child.kill("SIGTERM");
  }

  await waitForExit(child, 3_000);

  // `tsx` starts an esbuild service. On Linux it can outlive the direct child,
  // so kill the detached process group as a final cleanup step.
  if (process.platform !== "win32" && pid) {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
    }
  } else if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  await waitForExit(child, 2_000);
  child.stdout?.destroy();
  child.stderr?.destroy();
};

test("C/D isolated editor binds current facts, source reviews and measured-or-unknown rework", {timeout:180_000},async()=>{
 const workflowRoot=await mkdtemp(path.join(os.tmpdir(),"newsdesk-phase-cd-"));const artifacts=path.resolve(".artifacts/phase-cd/browser");await mkdir(artifacts,{recursive:true});
 const state=createDefaultState();state.settings.scheduleEnabled=false;state.settings.officialMonitorEnabled=false;state.settings.inlineCompletionEnabled=false;state.sources.forEach(source=>{source.enabled=false;source.selected=false;});
 const draft=draftFixture("phase-cd-draft","当前正文与冻结事实核对");const factText="GPT-5.5 的价格为 1 美元。";const url="https://example.com/release";
 draft.paragraphs=[factText];draft.bodyHtml="<p>GPT-5.5：价格为 1 美元。</p>";draft.provenance.contentPackageId="phase-cd-package";
 draft.factClaims=[{id:"claim",claim:factText,status:"full-source",sourceUrl:url,capturedAt:draft.createdAt,factIds:["f1"]}];
 const pack:ContentPackage={id:"phase-cd-package",storyId:"s",mode:"brief",intent:"news",title:draft.title,createdAt:draft.createdAt,facts:[{id:"f1",text:factText,status:"supported",sourceSignalIds:["s"],sourceUrls:[url]}],sources:[],sourceSignalIds:["s"],assets:[],imageIds:[],discussionSamples:[],communityFocus:[],uncertainties:[],suggestedAngles:[],communityEvidenceLabel:"",status:"ready",blockers:[],sourceEvidence:[{signalId:"s",sourceKind:"article",sourceLabel:"隔离样本",url,originalTitle:"Original",originalText:factText,originalLanguage:"zh",basis:"full-source",capturedAt:draft.createdAt,truncated:false,rightsNotice:"仅供测试"}]};
 state.drafts=[draft];appendDraftRevision(state,draft,"initial");await writeFile(path.join(workflowRoot,"state.json"),JSON.stringify(state));
 const db=await LocalDatabase.open({workflowRoot});db.saveContentPackage(pack);db.saveSourceSnapshot({urlKey:sourceSnapshotKey(url),requestedUrl:url,canonicalUrl:url,capturedAt:"2026-09-09T00:00:00Z",page:{text:factText+" 更新了文档说明。"}});db.close();
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;let output="";const server=spawn(process.execPath,["--import","tsx","server/start.ts"],{cwd:process.cwd(),env:{...process.env,NODE_ENV:"production",AI_NEWS_DESK_PORT:String(port),AI_NEWS_DESK_WORKFLOW_ROOT:workflowRoot,NO_COLOR:"1"},stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32"});server.stdout.on("data",chunk=>{output+=String(chunk);});server.stderr.on("data",chunk=>{output+=String(chunk);});
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
 await waitForHealth(origin,()=>output);browser=await chromium.launch({executablePath:await findChromeExecutable(),headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.route("**/api/drafts/*/completions",route=>route.fulfill({json:{available:false,reason:"隔离测试"}}));
 await page.goto(`${origin}/#drafts`,{waitUntil:"domcontentloaded"});await page.getByRole("textbox",{name:"连续文章编辑器"}).waitFor();const tools=page.getByRole("navigation",{name:"草稿辅助工具"});await tools.getByRole("button",{name:"资料",exact:true}).click();const panel=page.getByRole("region",{name:"当前版本核对"});await panel.getByText(/重新绑定改过的正文/u).click();await panel.getByRole("checkbox").check();
 await Promise.all([page.waitForResponse(response=>response.url().endsWith("/review-fact")&&response.ok()),panel.getByRole("button",{name:"已核对，绑定所选事实"}).click()]);
 await panel.getByText("来源变更 · 待核对",{exact:true}).click();await panel.getByLabel("此稿仍适用的核对结论").fill("已核对新增加的文档说明，引用价格及适用对象没有发生变化。");await Promise.all([page.waitForResponse(response=>response.url().endsWith("/review-source-change")&&response.ok()),panel.getByRole("button",{name:"记录已核对结论"}).click()]);await panel.getByText("来源变更 · 已记录核对",{exact:true}).waitFor();
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`quality panel ${width}`);await page.screenshot({path:path.join(artifacts,`quality-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1000});await tools.getByRole("button",{name:"版本",exact:true}).click();await page.getByText("记录实际返工",{exact:true}).click();await page.getByRole("checkbox",{name:"结构不顺",exact:true}).check();await page.getByRole("button",{name:"记录本次返工",exact:true}).click();await page.getByText("已记录本次返工；未测量的时间保持未知。",{exact:true}).waitFor();await page.screenshot({path:path.join(artifacts,"rework.png"),fullPage:true});
 const saved=await(await page.request.get(`${origin}/api/drafts/${draft.id}`)).json() as ArticleDraft;assert.equal(saved.sourceChangeReviews?.length,1);assert.equal(saved.factClaims?.[0]?.status,"full-source");
 const impact=await(await page.request.get(`${origin}/api/source-changes`)).json();assert.equal(impact[0].draftId,draft.id);
 await page.getByRole("button",{name:"关闭右侧面板",exact:true}).click();
 const title=page.getByLabel("文章标题",{exact:true});await title.fill("修改后的当前正文核对");await page.waitForResponse(response=>response.url()===`${origin}/api/drafts/${draft.id}`&&response.request().method()==="PATCH"&&response.ok());await tools.getByRole("button",{name:"资料",exact:true}).click();await panel.getByText("来源变更 · 待核对",{exact:true}).waitFor();
 const latest=await(await page.request.get(`${origin}/api/drafts/${draft.id}`)).json() as ArticleDraft;
 const paragraphs=["适用条件","第一步\n第二步","  const example = '<script>';\n  return example;","型号\t限制\nA\t仅预览","作者明确的原句",...Array.from({length:7},(_,i)=>`保留第 ${i+6} 个正文块。`)];
 const rich={...latest,paragraphs,take:""};const kinds=["heading","ordered-list","code","table","quote"] as const;
 rich.bodyHtml=structuredDraftBodyHtml(rich,kinds.map((kind,paragraphIndex)=>({kind,paragraphIndex})));
 const patched=await page.request.patch(`${origin}/api/drafts/${draft.id}`,{data:{updatedAt:latest.updatedAt,paragraphs,bodyHtml:rich.bodyHtml,take:""}});assert.ok(patched.ok());
 await page.reload({waitUntil:"domcontentloaded"});const editor=page.getByRole("textbox",{name:"连续文章编辑器"});await editor.locator("table").waitFor();
 for(const tag of ["h2","ol","pre","table","blockquote"])assert.ok(await editor.locator(tag).count());assert.equal(await editor.locator("script").count(),0);
 await page.getByLabel("文章标题",{exact:true}).fill("富文本结构保存检查");await page.waitForResponse(response=>response.url()===`${origin}/api/drafts/${draft.id}`&&response.request().method()==="PATCH"&&response.ok());
 const richSaved=await(await page.request.get(`${origin}/api/drafts/${draft.id}`)).json() as ArticleDraft;assert.match(richSaved.bodyHtml!,/<table/u);assert.match(richSaved.bodyHtml!,/&lt;script&gt;/u);assert.ok(richSaved.paragraphs.length>=12);
 const colors=await editor.locator("pre").evaluate(element=>({foreground:getComputedStyle(element).color,background:getComputedStyle(element).backgroundColor}));
 const luminance=(rgb:string)=>{const c=rgb.match(/\d+/g)!.slice(0,3).map(Number).map(v=>v/255).map(v=>v<=.04045?v/12.92:Math.pow((v+.055)/1.055,2.4));return c[0]!*.2126+c[1]!*.7152+c[2]!*.0722;};
 const fg=luminance(colors.foreground),bg=luminance(colors.background),contrast=(Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);assert.ok(contrast>=4.5,"code text must remain readable against its actual background");
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:950});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`rich blocks ${width}`);await page.screenshot({path:path.join(artifacts,`rich-${width}.png`),fullPage:true});}
 await page.goto(`${origin}/#runs`,{waitUntil:"domcontentloaded"});await page.getByText("查找漏掉的新闻链接",{exact:true}).click();await page.getByLabel("诊断原文链接").fill("https://unobserved.example/story");await page.getByRole("button",{name:"查本地记录",exact:true}).click();await page.getByText(/不能断言从未采到/u).waitFor();await page.screenshot({path:path.join(artifacts,"trace.png"),fullPage:true});
 const verifyDb=await LocalDatabase.open({workflowRoot});const observation=verifyDb.listWorkflowEvents().find(event=>event.type==="draft.edit-observation");verifyDb.close();assert.ok(observation);assert.equal(observation.payload.userEditMinutes,null);assert.equal(observation.payload.timingBasis,"unmeasured");assert.deepEqual(errors,[]);await writeFile(path.join(artifacts,"checks.json"),JSON.stringify({pageErrors:errors,sourceReview:saved.sourceChangeReviews,observation,affectedDrafts:impact},null,2));
 }finally{await browser?.close();await stopProcessTree(server);await rm(workflowRoot,{recursive:true,force:true});}
});
