// Proposal screenshots from a fresh synthetic database; no server, credentials or external requests.
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright-core';
import { LocalDatabase } from '../../server/local-database.ts';
import { artifactFixture, seedSchema6 } from '../../server/run-artifact-fixture.ts';
const output = path.resolve('docs/design/optimization-2026-10-07/D1');
await mkdir(output, { recursive: true });
const root = await mkdtemp(path.join(os.tmpdir(), 'newsdesk-d1-synthetic-preview-'));
let store, browser;
try {
  const state = artifactFixture(), base = state.runs[0];
  state.runs = Array.from({ length: 4 }, (_, index) => ({ ...structuredClone(base), id: `synthetic-${index}`,
    logs: [{ at: base.createdAt, stage: '隔离示例', level: 'info', message: '虚构运行记录'.repeat(2000) }],
    discoveryTrace: Array.from({ length: 500 }, (_, i) => ({ rawId: `raw-${index}-${i}`, url: `https://example.com/synthetic/${index}/${i}`, title: '虚构采集明细', stage: 'candidate-limit' })) }));
  await seedSchema6(root, state);
  const beforeDb = new DatabaseSync(path.join(root, 'newsdesk.db'), { readOnly: true });
  const beforeBytes = Buffer.byteLength(beforeDb.prepare("SELECT value_json FROM state_fragments WHERE key='runs'").get().value_json); beforeDb.close();
  store = await LocalDatabase.open({ workflowRoot: root, initialState: artifactFixture });
  assert.deepEqual(store.readState().runs, state.runs);
  const db = new DatabaseSync(store.databasePath, { readOnly: true });
  const afterBytes = Buffer.byteLength(db.prepare("SELECT value_json FROM state_fragments WHERE key='runs'").get().value_json);
  const rows = db.prepare('SELECT kind, COUNT(*) AS count FROM run_artifacts GROUP BY kind ORDER BY kind').all(); db.close();
  const checkpoints = (await readdir(path.join(root, 'backups'))).filter(name => name.startsWith('before-run-artifacts-')).length;
  const kb = bytes => (bytes / 1024).toFixed(1) + ' KB';
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>
  *{box-sizing:border-box}body{margin:0;background:#f7f7f7;color:#242424;font:15px/1.65 -apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif}main{max-width:1080px;margin:64px auto;padding:0 28px}.eyebrow{color:#b32b28;font-size:13px;font-weight:600;letter-spacing:1px}h1{font-size:32px;letter-spacing:-1px;margin:12px 0 8px}p{color:#777;margin:0}.badge{float:right;border:1px solid #ddd;padding:4px 12px;border-radius:20px;color:#777;font-size:12px}.metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#e6e6e6;margin:32px 0;border:1px solid #e6e6e6;border-radius:12px;overflow:hidden}.metric{background:white;padding:24px}.metric span{color:#777;font-size:13px}.metric strong{display:block;font-size:28px;line-height:1.6}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.panel{border:1px solid #e2e2e2;border-radius:12px;background:white;padding:24px}h2{font-size:18px;margin:0 0 18px}.label{color:#777;font-size:13px}.size{font-size:24px;margin:8px 0;color:#b32b28;font-weight:600}.bar{height:8px;border-radius:4px;background:#eee;overflow:hidden;margin:12px 0 22px}.bar i{display:block;height:100%;background:#c02c29}.row{display:flex;gap:8px;justify-content:space-between;border-top:1px solid #eee;padding:12px 0;font-size:13px}.row span{color:#777}.row code{font-size:12px;overflow-wrap:anywhere}.flow{margin-top:24px;border-left:3px solid #c02c29;background:#fff;padding:18px 22px}.flow strong{display:block;margin-bottom:4px}footer{font-size:12px;color:#888;margin-top:24px}@media(max-width:600px){main{margin:28px auto;padding:0 20px}h1{font-size:26px}.badge{float:none;display:inline-block;margin:12px 0 0}.metrics{margin:24px 0}.metric{padding:14px 10px}.metric strong{font-size:23px}.grid{grid-template-columns:1fr}.panel{padding:20px}.row{flex-wrap:wrap}.flow{padding:16px 18px}}
  </style><main><div class="eyebrow">AI NEWS DESK · D1 存储提案</div><div class="badge">等待用户决定</div><h1>运行诊断存储拆分</h1><p>虚构数据展示方案；保持全部历史，只改变日常读取方式。</p>
  <div class="metrics"><div class="metric"><span>历史运行</span><strong>4 → 4</strong></div><div class="metric"><span>诊断可读</span><strong>4 / 4</strong></div><div class="metric"><span>迁移检查点</span><strong>${checkpoints} 份</strong></div></div>
  <div class="grid"><section class="panel"><h2>日常状态</h2><div class="label">runs 片段 · 无损存储字节</div><div class="size">${kb(beforeBytes)} → ${kb(afterBytes)}</div><div class="bar"><i style="width:${Math.max(1, afterBytes / beforeBytes * 100)}%"></i></div><div class="row">候选、日志、推荐历史<span>完整保留</span></div><div class="row">大型片段<span>无损压缩 · SHA-256 校验</span></div><div class="row">日常编辑<span>只复制轻量状态</span></div></section>
  <section class="panel"><h2>按需读取的明细</h2><div class="label">独立 run_artifacts 表 · ${rows.reduce((sum,row)=>sum+row.count,0)} 份记录</div>${rows.map(row=>`<div class="row"><code>${row.kind}</code><span>${row.count} 份 · 校验完整</span></div>`).join('')}<div class="row">轻量备份 / 完整归档<span>补回全部运行明细</span></div></section></div>
  <div class="flow"><strong>先留检查点 → 同一事务迁移 → 校验后提交</strong><p>模拟中断会回滚；再次打开可继续迁移。旧备份和旧 runs 数组仍可读取。</p></div>
  <footer>这是隔离数据库生成的方案说明图，非已上线产品界面；全部来源为 example.com，无真实草稿、账号、模型调用或用户数据。</footer></main></html>`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const measurements = { synthetic: true, runs: 4, beforeBytes, afterBytes, artifactRows: rows.map(row=>({...row})), checkpoints, views: [] };
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    const errors=[]; page.on('pageerror',error=>errors.push(String(error))); page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
    await page.route('**/*',route=>route.abort());
    await page.setContent(html); await page.evaluate(()=>document.fonts.ready);
    const overflow = await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.equal(overflow,0);assert.deepEqual(errors,[]);
    await page.screenshot({ path: path.join(output, `proposal-${width}.png`), fullPage: true, animations: 'disabled' });
    measurements.views.push({width,overflow,errors:errors.length,externalRequests:0});await page.close();
  }
  await writeFile(path.join(output,'synthetic-measurements.json'),JSON.stringify(measurements,null,2)+'\n');
  console.log(JSON.stringify(measurements));
} finally { await browser?.close();store?.close();await rm(root,{recursive:true,force:true}); }
