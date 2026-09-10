import {recordDraftEdit} from "../../server/learning-desk.js";
import {snapshotDraft} from "../../server/draft-revisions.js";
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

test("E1 preference evidence, contextual preview, pause and deletion work without model calls",{timeout:120_000},async()=>{
 const workflowRoot=await mkdtemp(path.join(os.tmpdir(),"newsdesk-phase-e-"));const artifacts=path.resolve(".artifacts/phase-e/browser");await mkdir(artifacts,{recursive:true});const state=createDefaultState();state.settings.scheduleEnabled=false;state.settings.officialMonitorEnabled=false;state.settings.inlineCompletionEnabled=false;state.sources.forEach(source=>{source.enabled=false;source.selected=false;});
 await writeFile(path.join(workflowRoot,"state.json"),JSON.stringify(state));const db=await LocalDatabase.open({workflowRoot});
 for(let i=0;i<5;i++){const draft=draftFixture(`memory-${i}`,"本地推理性能");draft.bodyHtml="<p>重磅革命性升级：本地推理工具发布。</p>";draft.paragraphs=["重磅革命性升级：本地推理工具发布。"];const before=snapshotDraft(draft);draft.bodyHtml="<p>本地推理工具发布。</p>";draft.paragraphs=["本地推理工具发布。"];recordDraftEdit(db,{draftId:draft.id,confirmationId:`confirmed-${i}`,before,after:snapshotDraft(draft),saveMode:"manual",confirmed:true});}db.close();
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;let output="";const server=spawn(process.execPath,["--import","tsx","server/start.ts"],{cwd:process.cwd(),env:{...process.env,NODE_ENV:"production",AI_NEWS_DESK_PORT:String(port),AI_NEWS_DESK_WORKFLOW_ROOT:workflowRoot,NO_COLOR:"1"},stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32"});server.stdout.on("data",chunk=>{output+=String(chunk);});server.stderr.on("data",chunk=>{output+=String(chunk);});let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try {await waitForHealth(origin,()=>output);browser=await chromium.launch({executablePath:await findChromeExecutable(),headless:true});const page=await browser.newPage({viewport:{width:1440,height:1100}});const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 await page.goto(`${origin}/#editorial-system`,{waitUntil:"domcontentloaded"});await page.getByRole("heading",{name:"从修改中学习",exact:true}).waitFor();await page.getByText("预览当前选题会用哪些偏好",{exact:true}).click();await page.getByLabel("当前选题",{exact:true}).fill("本地推理性能");const preview=page.locator(".preference-preview");await preview.getByRole("button",{name:"只预览，不调用模型"}).click();await preview.getByText("删除宣传式用词，保留可核验的具体变化。",{exact:true}).waitFor();
 await page.getByText(/查看记忆与依据/u).click();await page.getByText("查看全部保留依据",{exact:true}).click();await page.getByText(/修改前：重磅革命性/u).first().waitFor();
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,`memories-${width}.png`),fullPage:true});}
 await page.setViewportSize({width:1440,height:1100});const memory=page.locator(".writing-memory-list > article").first();await memory.getByRole("button",{name:"关闭",exact:true}).click();await preview.getByRole("button",{name:"只预览，不调用模型"}).click();await preview.getByText("没有至少来自三篇确认稿的稳定偏好",{exact:true}).waitFor();await memory.getByRole("button",{name:"启用",exact:true}).click();await preview.getByLabel("写作方向").selectOption("source");await preview.getByRole("button",{name:"只预览，不调用模型"}).click();await preview.getByText("原文工作副本保持原作者结构与表达",{exact:true}).waitFor();
 page.once("dialog",dialog=>void dialog.accept());await memory.getByRole("button",{name:"删除删除宣传式用词",exact:true}).click();await page.getByText("有真实修改后，这里才会出现可解释的偏好。",{exact:true}).waitFor();await page.reload({waitUntil:"domcontentloaded"});const view=await(await page.request.get(`${origin}/api/editorial-system`)).json();assert.equal(view.writingMemories.memories.length,0);assert.equal(view.writingMemories.effectiveEditCount,5);assert.deepEqual(errors,[]);await writeFile(path.join(artifacts,"checks.json"),JSON.stringify({pageErrors:errors,afterDeletion:view.writingMemories},null,2));
 }finally{await browser?.close();await stopProcessTree(server);await rm(workflowRoot,{recursive:true,force:true});}
});
