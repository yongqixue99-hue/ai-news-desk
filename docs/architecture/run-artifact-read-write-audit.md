# D1 读写点审查

基线 c65c069。下列全文搜索共 30 个命中，包含类型定义、局部变量和纯写入，并非 30 个数据库读取。内容只有代码，不含用户数据。

| 路径 | 处理 |
| --- | --- |
| aggregation-desk | 先获取每次运行的聚合明细，再运行原有成功路由快照和排序；选入的轻量修改也传入读取接口 |
| story-desk | 隐藏证据只补到原有事件；每次投影每个运行/种类最多读取一次，分组、日期、评分和机会不变 |
| community-feed / community-view | 来源匹配使用同一次投影的明细快照；讨论采样和趋势不变 |
| candidate-pool | 只有显式 ID 才获取隐藏候选；完整状态旧调用兼容 |
| discovery-funnel | 纯生成器不读存储，保留原实现；输出经 horizon 写入同一存储事务 |
| discovery-trace / workflow-performance | 原始观察、拒绝理由、推荐快照和报告按需补回；CLI 同样传入读取接口 |
| bootstrap-view / workflow routes | 轻量 bootstrap 保持 B1；诊断 GET 返回完整三个字段，缺失运行仍 404 |
| horizon / story-explanation | 编辑隐藏证据前，显式补入私有修改副本；成功提交后缓存才反映改动 |
| visual-desk | 查找 Story 时传入明细接口，保持隐藏信号与主来源身份；图像选择和可见候选写入边界不改 |
| learning / package / workflow routes | 轻量修改里的 Story 查找及留作选题传入读取接口；原反馈逻辑和事实分数不改 |
| package-desk / editorial-intake / editorial-jobs / source-material / topic-feeds | 原调用通过完整 readState 获取明细；事实包、来源规则和读者内容不改 |
| storage / LocalDatabase | 常驻状态与日常修改为轻量副本；明细缓存返回副本；失败写入不改变修订号或已提交缓存 |
| data-management / portable inspector | 轻量备份显式补入明细；SQLite 归档包含新表；只读检查同时校验压缩片段和所有明细 |

## 基线字段命中

```text
server/aggregation-desk.ts:39:  const routes = new Set(runs.flatMap(r => r.aggregationItems === undefined ? [] : r.sourceResults?.find(s=>s.sourceId===id)?.routes?.map(route=>route.url) || []));
server/aggregation-desk.ts:41:    const run = runs.find(r=>r.aggregationItems!==undefined && r.sourceResults?.some(s=>s.sourceId===id && s.status!=='error'));
server/aggregation-desk.ts:42:    return run ? [{run,items:run.aggregationItems!.filter(i=>sourceId(i)===id)}] : [];
server/aggregation-desk.ts:45:  const hasSelectedApi = id === 'aihot-news' && runs.some(r => r.aggregationItems !== undefined && r.sourceResults?.find(s=>s.sourceId===id)?.routes?.some(route=>route.url===aihotSelectedUrl && route.status==='success'));
server/aggregation-desk.ts:47:    const run = runs.find(r=>r.aggregationItems!==undefined && r.sourceResults?.find(s=>s.sourceId===id)?.routes?.some(route=>route.url===url && route.status==='success'));
server/aggregation-desk.ts:48:    return run ? [{run,items:run.aggregationItems!.filter(i=>sourceId(i)===id && i.metadata?.feed_url===url)}] : [];
server/types.ts:607:  aggregationItems?: RawHorizonItem[];
server/types.ts:626:  discoveryTrace?: DiscoveryTraceEntry[];
server/types.ts:629:  evidenceCandidates?: Candidate[];
server/candidate-pool.ts:5:  return [...new Map([...run.candidates, ...(run.evidenceCandidates ?? [])].filter(candidate => explicitIds.has(candidate.id)).map(candidate => [candidate.id, candidate])).values()]
server/candidate-pool.ts:8:export const candidateFromRun = (run: WorkflowRun | undefined, id: string) => run?.candidates.find(candidate => candidate.id === id) ?? run?.evidenceCandidates?.find(candidate => candidate.id === id);
server/discovery-funnel.ts:24:  const evidenceCandidates = unique.map((item) => {
server/discovery-funnel.ts:33:  const ranked = rankCandidatesWithDiagnostics(evidenceCandidates, options.feedback, options.personalizationEnabled);
server/discovery-funnel.ts:64:  return { candidates: ranked.candidates, funnel, trace, evidenceCandidates };
server/bootstrap-view.ts:7:  runs: state.runs.map(({ discoveryTrace, evidenceCandidates, aggregationItems, ...run }) => run),
server/bootstrap-view.ts:18:    discoveryTrace: run.discoveryTrace ?? [],
server/bootstrap-view.ts:19:    evidenceCandidates: run.evidenceCandidates ?? [],
server/bootstrap-view.ts:20:    aggregationItems: run.aggregationItems ?? [],
server/horizon.ts:236:    for (const candidate of [...target.candidates, ...(target.evidenceCandidates ?? [])]) {
server/horizon.ts:553:      aggregationItems: aggregationSnapshot(rawItems),
server/horizon.ts:566:    const { candidates, funnel, trace, evidenceCandidates } = collectDiscoveryCandidates(rawItems, {
server/horizon.ts:572:    await patchRun(runId, { filteredRawCount: funnel.matchedCount, collectionFunnel: funnel, discoveryTrace: trace, evidenceCandidates });
server/community-feed.ts:301:  const matched = runs.flatMap((run) => [...run.candidates, ...(run.evidenceCandidates ?? []).filter(item => !run.candidates.some(visible => visible.id === item.id))].flatMap((candidate) => {
server/story-http-routes.ts:134:    const evidenceCandidates = evidencePool
server/story-http-routes.ts:138:    for (const story of evidenceCandidates) {
server/story-desk.ts:289:  for (const run of state.runs) for (const candidate of run.evidenceCandidates ?? []) {
server/story-desk.ts:291:    const via = run.discoveryTrace?.find(entry => entry.rawId === candidate.rawId)?.candidateId;
server/workflow-performance.ts:53:    for (const trace of run.discoveryTrace ?? []) {
server/workflow-performance.ts:103:      runs: runs.length, runsWithTrace: runs.filter(run => Boolean(run.discoveryTrace)).length,
server/discovery-trace.ts:27:    const saved = (run.discoveryTrace ?? []).filter(entry => same(entry.url));
```

## 基线调用命中

```text
server/story-explanation-service.ts:1:import { candidateFromRun } from "./candidate-pool.js";
server/story-explanation-service.ts:38:  const candidate = candidateFromRun(run, signal.candidateId);
server/story-explanation-service.ts:47:      const target = candidateFromRun(current.runs.find(entry => entry.id === run.id), candidate.id);
server/story-http-routes.ts:43:  try { response.json(traceDiscoveryUrl(await runtime.readState(), String(request.query.url ?? ""))); }
server/story-http-routes.ts:66:  response.json(buildAggregationView(await runtime.readState()));
server/story-http-routes.ts:82:  if (!buildAggregationView(await runtime.readState()).entries.some(e => e.id === id)) { response.status(404).json({error: "条目已不在当前快照，请刷新列表。"}); return; }
server/workflow-performance.ts:24:export const buildWorkflowPerformance = (state: Readonly<WorkflowState>, options: { now?: string; days?: number; benchmarkUrls?: string[]; rework?: { events: WorkflowEventRecord[]; total: number; truncated: boolean } } = {}) => {
server/story-desk.ts:989:    radar: buildTopicRadar([...new Map([...active, ...releaseHighlights].map(story => [story.id, story])).values()], buildAggregationView(state, Date.parse(now)).entries, now, stories),
server/candidate-pool.ts:8:export const candidateFromRun = (run: WorkflowRun | undefined, id: string) => run?.candidates.find(candidate => candidate.id === id) ?? run?.evidenceCandidates?.find(candidate => candidate.id === id);
server/learning-http-routes.ts:22:import { buildWorkflowPerformance } from "./workflow-performance.js";
server/learning-http-routes.ts:346:  response.json(await runtime.readStateProjection(state => buildWorkflowPerformance(state, { days, now, benchmarkUrls: urls, rework })));
server/aggregation-desk.ts:51:export function buildAggregationView(state: WorkflowState, now=Date.now()): AggregationView {
server/aggregation-desk.ts:114: const entry=buildAggregationView(state).entries.find(e=>e.id===id);if(!entry)throw new Error('该条目已不在当前快照，请刷新列表。');
server/index.ts:188:import { buildWorkflowPerformance } from "./workflow-performance.js";
server/editorial-intake.ts:1:import { candidateFromRun } from "./candidate-pool.js";
server/editorial-intake.ts:42:  return candidateFromRun(run, input.candidateId);
server/editorial-jobs.ts:1:import { candidateFromRun } from "./candidate-pool.js";
server/editorial-jobs.ts:10:  const candidate = candidateFromRun((await readState()).runs.find((run) => run.id === input.runId), input.candidateId);
server/package-desk.ts:1:import { candidateFromRun } from "./candidate-pool.js";
server/package-desk.ts:54:  candidateFromRun(state.runs.find(run => run.id === runId), candidateId);
server/workflow-performance-cli.ts:2:import { buildWorkflowPerformance } from "./workflow-performance.js";
server/workflow-performance-cli.ts:8:console.log(JSON.stringify(await readStateProjection(state => buildWorkflowPerformance(state, { now, rework })), null, 2));
server/horizon.ts:217:  const candidates = candidatePool(run, candidateIds).filter((candidate) =>
```

## 扩展调用审查

`readStateProjection` 的所有别名与调用也已审查，包括 visual-desk 的 `project`、只读性能 CLI、Story 反馈修改、留作选题与采集完成时的推荐快照。包生成与编辑意图的入口仍拿完整状态。来源图片 SHA-256 与跨 OS 本机路径检查没有变化。
