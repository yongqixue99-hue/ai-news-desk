import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import { findChromeExecutable } from "../../server/chrome-launch.js";
import { createDefaultState } from "../../server/defaults.js";

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


test("aggregation browsing is read-only, retains filtered summaries and works on mobile", {timeout:120_000}, async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'newsdesk-aggregations-'));
 const state=createDefaultState();state.settings.scheduleEnabled=false;state.settings.officialMonitorEnabled=false;
 state.sources.forEach(s=>{s.enabled=false;s.selected=false;});
 const now=new Date().toISOString();
 state.runs=[{id:'aggregate-fixture',createdAt:now,updatedAt:now,collectedAt:now,status:'ready',stage:'done',windowHours:168,sourceIds:['smol-ainews'],scheduled:false,rawCount:1,candidates:[],logs:[],
 aggregationItems:[{id:'digest',source_type:'rss',title:'A new decision model',url:'https://news.smol.ai/issues/fixture',content:'A short publisher summary, preserved before scoring.',published_at:'2026-01-01T00:00:00Z',fetched_at:now,metadata:{source_id:'smol-ainews'}}],
 sourceResults:[{sourceId:'smol-ainews',sourceName:'AINews',status:'healthy',healthImpact:'success',rawCount:1,candidateCount:0,detail:''}]}];
 await writeFile(path.join(root,'state.json'),JSON.stringify(state));
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;let output='';
 const server=spawn(process.execPath,['--import','tsx','server/start.ts'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',AI_NEWS_DESK_PORT:String(port),AI_NEWS_DESK_WORKFLOW_ROOT:root},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 server.stdout.on('data',c=>output+=String(c));server.stderr.on('data',c=>output+=String(c));
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
 await waitForHealth(origin,()=>output);browser=await chromium.launch({executablePath:await findChromeExecutable(),headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const posts:string[]=[];const errors:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/#aggregations`);await page.getByRole('heading',{name:'聚合资讯',exact:true}).waitFor();await page.getByRole('heading',{name:'A new decision model'}).waitFor();
 await page.getByLabel('筛选聚合资讯').fill('not present');await page.getByRole('heading',{name:'没有匹配内容'}).waitFor();await page.getByLabel('筛选聚合资讯').fill('');
 await page.getByRole('button',{name:'AIBase 待接入'}).click();await page.getByRole('heading',{name:'此平台尚待接入'}).waitFor();await page.getByRole('button',{name:'全部平台'}).click();
 const artifacts=path.resolve('.artifacts/aggregations/browser');await mkdir(artifacts,{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,`aggregations-${width}.png`),fullPage:true});}
 assert.deepEqual(posts,[], 'opening and filtering must not create work or call AI');
 await page.getByRole('button',{name:'留作选题',exact:true}).click();await page.getByRole('button',{name:'已留待选题'}).waitFor();
 const view=await(await page.request.get(`${origin}/api/aggregations`)).json();assert.equal(view.entries[0].selected,true);
 await page.reload();await page.getByRole('button',{name:'已留待选题'}).waitFor();
 await page.getByRole('button',{name:'更新聚合资讯'}).click();await page.getByRole('alert').filter({hasText:'至少一个聚合平台'}).waitFor();
 assert.deepEqual(errors,[]);assert.equal(posts.length,2);
 }finally{await browser?.close();await stopProcessTree(server);await rm(root,{recursive:true,force:true});}
});
