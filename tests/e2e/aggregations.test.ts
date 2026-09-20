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

 const news=(source:string,title:string,url:string,rank:number)=>({id:title,source_type:'rss' as const,title,url,content:`${source} original summary`,published_at:now,fetched_at:now,metadata:{source_id:source,aggregation_order:rank,...(source==='aihot-news'?{aggregation_channel:'hot',aggregation_rank:rank}:{aggregation_channel:'feed'})}});
 state.runs[0]!.aggregationItems!.push(news('aihot-news','报名：重磅模型发布活动','https://example.com/promo',1),news('aihot-news','Jev 发布新决策模型','https://example.com/release',2),news('alphasignal','AlphaSignal original model release','https://example.com/release',1));
 state.runs[0]!.sourceResults!.push(...['aihot-news','alphasignal'].map(sourceId=>({sourceId,sourceName:sourceId,status:'healthy' as const,healthImpact:'success' as const,rawCount:2,candidateCount:0,detail:''})));
 await writeFile(path.join(root,'state.json'),JSON.stringify(state));
 const port=await freePort(),origin=`http://127.0.0.1:${port}`;let output='';
 const server=spawn(process.execPath,['--import','tsx','server/start.ts'],{cwd:process.cwd(),env:{...process.env,NODE_ENV:'production',AI_NEWS_DESK_PORT:String(port),AI_NEWS_DESK_WORKFLOW_ROOT:root},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 server.stdout.on('data',c=>output+=String(c));server.stderr.on('data',c=>output+=String(c));
 let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
 try{
 await waitForHealth(origin,()=>output);browser=await chromium.launch({executablePath:await findChromeExecutable(),headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}});
 const shots=path.resolve('.artifacts/aggregation-ranking/browser');await mkdir(shots,{recursive:true});
 const capture=async(name:string)=>{for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(shots,`${name}-${width}.png`),fullPage:true});}await page.setViewportSize({width:1440,height:1000});};
 const posts:string[]=[];const errors:string[]=[];page.on('request',r=>{if(r.method()==='POST')posts.push(r.url());});page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`${origin}/#today`);
 await page.getByRole('heading',{name:'Jev 发布新决策模型',exact:true}).waitFor();
 assert.equal(await page.locator('.radar-row').count(),1,'the home shortlist merges aggregate copies');
 assert.equal(await page.getByText('待核对线索',{exact:true}).count(),1);
 assert.equal(await page.locator('.today-search-disclosure').getAttribute('open'),null);
 assert.equal(await page.locator('.radar-evidence').getAttribute('open'),null);
 await capture('topic-radar');
 await page.getByLabel('筛选当前新闻列表').fill('no match');
 await page.getByText('当前筛选没有结果',{exact:true}).waitFor();
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();
 await page.locator('.radar-evidence summary').click();
 await page.locator('.radar-evidence').getByRole('link',{name:'AIHOT',exact:true}).waitFor();
 await page.goto(`${origin}/#sources`);
 await page.getByRole('heading',{name:'新闻源',exact:true}).waitFor();
 assert.equal(await page.locator('.source-settings-disclosure').getAttribute('open'),null);
 await capture('compact-sources');
 await page.locator('.source-coverage > summary').click();
 await page.getByLabel('发现用途').selectOption('products');
 assert.equal(await page.locator('.source-manager-row').count(),1);
 await page.getByText('Product Hunt · 新产品',{exact:true}).waitFor();
 await capture('coverage-products');

 await page.goto(`${origin}/#aggregations`);await page.getByRole('heading',{name:'聚合资讯',exact:true}).waitFor();await page.getByRole('heading',{name:'Jev 发布新决策模型'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'报名：重磅模型发布活动'}).count(),0);await capture('roundup');
 await page.getByRole('button',{name:'AIHOT 已停用'}).click();await page.getByRole('heading',{name:'报名：重磅模型发布活动'}).waitFor();
 assert.equal(await page.locator('.aggregation-row h2').first().innerText(),'报名：重磅模型发布活动');await capture('platform');
 await page.getByRole('button',{name:'AlphaSignal 已停用'}).click();await page.getByRole('heading',{name:'AlphaSignal original model release'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Jev 发布新决策模型'}).count(),0);
 await page.getByRole('button',{name:'全部平台'}).click();await page.getByRole('button',{name:'日报合集',exact:true}).click();await page.getByRole('heading',{name:'A new decision model'}).waitFor();
 await page.getByLabel('筛选聚合资讯').fill('not present');await page.getByRole('heading',{name:'没有匹配内容'}).waitFor();await page.getByLabel('筛选聚合资讯').fill('');
 await page.getByRole('button',{name:'AIBase 待接入'}).click();await page.getByRole('heading',{name:'此平台尚待接入'}).waitFor();await page.getByRole('button',{name:'全部平台'}).click();
 const artifacts=path.resolve('.artifacts/aggregations/browser');await mkdir(artifacts,{recursive:true});
 for(const width of [1440,390]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(artifacts,`aggregations-${width}.png`),fullPage:true});}
 assert.deepEqual(posts,[], 'opening and filtering must not create work or call AI');
 await page.getByRole('button',{name:'留作选题',exact:true}).click();await page.getByRole('button',{name:'已留待选题'}).waitFor();
 const view=await(await page.request.get(`${origin}/api/aggregations`)).json();assert.equal(view.entries.find((e:{title:string})=>e.title==='A new decision model').selected,true);
 await page.reload();await page.getByRole('button',{name:'日报合集',exact:true}).click();await page.getByRole('button',{name:'已留待选题'}).waitFor();
 await page.getByRole('button',{name:'更新聚合资讯'}).click();await page.getByRole('alert').filter({hasText:'至少一个聚合平台'}).waitFor();
 assert.deepEqual(errors,[]);assert.equal(posts.length,2);
 }finally{await browser?.close();await stopProcessTree(server);await rm(root,{recursive:true,force:true});}
});
