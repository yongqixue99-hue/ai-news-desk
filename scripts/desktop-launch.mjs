import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, realpathSync, statSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'));
process.chdir(root);
const port=Number(process.env.AI_NEWS_DESK_PORT || 4317);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('无效的本机端口');
const url=`http://127.0.0.1:${port}`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const samePath=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
async function probe(){
 try {
  const response=await fetch(`${url}/api/desktop/status`,{signal:AbortSignal.timeout(2000)});
  if(!response.ok) throw new Error('端口 4317 正被旧版服务或其他程序占用。请先退出旧服务，再打开应用。');
  const body=await response.json();
  if(body.app!=='ai-news-desk'||!samePath(realpathSync(body.projectPath),root)) throw new Error('端口 4317 正被另一份工作台占用；未启动第二份，也未修改任何数据。');
  return true;
 } catch(error) {
  if(error instanceof TypeError || error.name==='TimeoutError') return false;
  throw error;
 }
}
function newest(dir){return Math.max(0,...readdirSync(dir,{withFileTypes:true}).map(e=>{const p=path.join(dir,e.name);return e.isDirectory()?newest(p):statSync(p).mtimeMs;}));}
function npm(args){
 const cli=process.platform==='win32'?path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'):path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js');
 const result=existsSync(cli)?spawnSync(process.execPath,[cli,...args],{cwd:root,stdio:'inherit'}):spawnSync('npm',args,{cwd:root,stdio:'inherit'});
 if(result.error||result.status!==0)throw new Error(`首次准备失败：npm ${args.join(' ')}。请查看启动日志。`);
}
try {
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major!==22||minor<16)throw new Error('需要 Node.js 22.16 或更新的 22.x。请使用随项目提供的启动入口。');
 if(!await probe()) {
  if(!existsSync('node_modules/tsx'))npm(['ci']);
  if(!existsSync('dist/index.html')||Math.max(newest('src'),statSync('package-lock.json').mtimeMs)>statSync('dist/index.html').mtimeMs)npm(['run','build']);
  // Recheck after preparation: concurrent launchers can safely reuse the winner.
  if(!await probe()) {
   const logs=path.resolve(root,process.env.AI_NEWS_DESK_WORKFLOW_ROOT || '.workflow','logs');
   mkdirSync(logs,{recursive:true});
   const log=openSync(path.join(logs,'desktop-service.log'),'a');
   const child=spawn(process.execPath,['--import','tsx','server/start.ts'],{cwd:root,env:{...process.env,NODE_ENV:'production'},detached:true,windowsHide:true,stdio:['ignore',log,log]});
   child.unref();closeSync(log);
  }
  let ready=false;
  for(let attempt=0;attempt<60;attempt++){if(await probe()){ready=true;break;}await sleep(1000);}
  if(!ready)throw new Error('服务未能在一分钟内启动。请查看 .workflow/logs/desktop-service.log。');
 }
 if(!process.argv.includes('--no-open')){
  if(process.platform==='win32'){
   const browsers=[process.env['ProgramFiles(x86)'],process.env.ProgramFiles,process.env.LOCALAPPDATA].filter(Boolean).flatMap(base=>[path.join(base,'Microsoft/Edge/Application/msedge.exe'),path.join(base,'Google/Chrome/Application/chrome.exe')]);
   const browser=browsers.find(existsSync);
   if(browser){const child=spawn(browser,[`--app=${url}`],{detached:true,stdio:'ignore'});child.unref();}
   else {const child=spawn('explorer.exe',[url],{detached:true,stdio:'ignore'});child.unref();}
  } else {spawnSync('/usr/bin/open',[url]);}
 }
 console.log('AI 新闻台已就绪。关闭窗口不会删除稿件；后台任务可继续执行。');
} catch(error){console.error(error.message);process.exitCode=1;}
