import { hasOfficialUpdateAnchor } from "./official-update-url.js";
import { buildStories, buildTodayView } from "./story-desk.js";
import type { WorkflowState } from "./types.js";
const keyFor = (value: string) => {
  const url = new URL(value);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("请输入原文的 HTTP(S) 链接");
  if (!hasOfficialUpdateAnchor(url)) url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^(?:utm_.+|fbclid|gclid)$/iu.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); url.pathname = url.pathname.replace(/\/$/u, "") || "/";
  return url.href;
};
export const discoveryStageLabels: Record<string, string> = {
  "missing-published-at": "未取得原始发布日期", "invalid-published-at": "发布日期无法识别", "future-published-at": "日期位于未来",
  "outside-date-range": "不在所选日期内", "outside-window": "超过采集窗口", "keyword-mismatch": "关键词未命中",
  "duplicate-url": "相同原文链接已去重", "score-or-topic": "未达到选题评分或主题门槛", "merged-event": "按标题合并至另一候选，可核对是否误合并",
  "candidate-limit": "已采到，超出本轮候选上限", candidate: "已进入候选", unknown: "历史路径未记录",
};
export const captureRecommendationSnapshot = (state: WorkflowState, computedAt: string) => {
  const today = buildTodayView(state, computedAt);
  return { computedAt, stories: [...today.mustReads, ...today.secondary, ...(today.interesting ?? [])].map(story => ({ storyId: story.id, signals: story.signals.map(({ runId, candidateId, url }) => ({ runId, candidateId, url })) })) };
};
/** Read-only, never fetches the submitted URL or invokes a model. */
export const traceDiscoveryUrl = (state: WorkflowState, url: string, now = new Date().toISOString()) => {
  const key = keyFor(url);
  const same = (other: string) => { try { return keyFor(other) === key; } catch { return false; } };
  const observations = state.runs.flatMap(run => {
    const saved = (run.discoveryTrace ?? []).filter(entry => same(entry.url));
    const entries = saved.length ? saved : run.candidates.filter(candidate => same(candidate.url) || same(candidate.canonicalUrl || candidate.url)).map(candidate => ({ rawId: candidate.rawId, url: candidate.url, title: candidate.title, publishedAt: candidate.publicationDateKnown === false ? undefined : candidate.publishedAt, observedAt: candidate.fetchedAt, dateBasis: candidate.publicationEvidence?.basis, stage: "candidate", candidateId: candidate.id }));
    return entries.map(entry => ({ ...entry, runId: run.id, runAt: run.collectedAt ?? run.createdAt, label: discoveryStageLabels[entry.stage] ?? entry.stage }));
  }).sort((a,b) => Date.parse(a.runAt) - Date.parse(b.runAt));
  const story = buildStories(state, now).find(story => story.signals.some(signal => same(signal.url))
    || observations.some(entry => story.signals.some(signal => signal.runId === entry.runId && signal.candidateId === entry.candidateId)));
  const today = buildTodayView(state, now);
  const visible = [...today.mustReads, ...today.secondary, ...(today.interesting ?? [])].some(item => item.id === story?.id);
  const displayReason = !story ? observations.length ? "尚未形成可展示事件" : "本地记录中未找到该链接；旧运行未保存逐条路径，不能断言从未采到"
    : visible ? "已进入当前推荐" : !story.assignment.canDraft ? `材料不足：${story.assignment.reason}`
    : story.ignored || story.published || story.drafted ? "已处理，未进入当前推荐"
    : story.opportunity?.lane === "routine" ? "常规动态，保留在全部候选"
    : "受当前时间窗口、栏目或推荐名额影响，未显示在推荐位";
  return { url: key, observations, storyId: story?.id, displayReason,
    firstObservedAt: observations[0]?.observedAt ?? observations[0]?.runAt, firstCandidateAt: observations.find(entry => ["candidate", "merged-event"].includes(entry.stage))?.runAt,
    firstRecordedRecommendationAt: state.runs.flatMap(run => run.recommendationSnapshot && run.recommendationSnapshot.stories.some(item => item.signals.some(signal => same(signal.url))) ? [run.recommendationSnapshot.computedAt] : []).sort()[0],
    recommendedNow: visible, monitoring: "仅记录实际采集时刻；未记录持续在线区间，不计算实时覆盖率或在线推荐延迟。" };
};
