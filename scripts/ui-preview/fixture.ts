/** Synthetic UI only. No storage, worker, credentials, proxy or outbound requests. */
import express from "express";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { createDefaultState } from "../../server/defaults.js";
import { bootstrapView } from "../../server/bootstrap-view.js";
import { buildTodayView } from "../../server/story-desk.js";
import { buildEditorialSystemView } from "../../server/editorial-system.js";
import { defaultHomeLayout } from "../../server/home-layout.js";
import { buildCommunityView } from "../../server/community-view.js";
import { buildAggregationView } from "../../server/aggregation-desk.js";
import { buildDraftOverview } from "../../server/draft-overview.js";
import { discoveryFixture } from "../../tests/fixtures/discovery.js";
import type { Candidate, WorkflowRun } from "../../server/types.js";

const now = process.env.AI_NEWS_DESK_PREVIEW_TIME || new Date().toISOString();
let state = createDefaultState();
state.settings.scheduleEnabled = false;
state.settings.officialMonitorEnabled = false;
state.sources.forEach(source => { source.enabled = false; source.selected = false; });
const examples = [
  ["示例模型开放本地运行", "Example releases Model 3.5", "开发者可以下载权重，在自己的电脑上处理文字，服务不依赖云端。"],
  ["示例团队发布长文档检索工具", "Sample releases document search", "工具支持按原文段落返回检索结果，便于核对回答引用的具体出处。"],
  ["示例实验公布语音翻译研究", "Example research: speech translation", "研究比较了两种语音处理方法，结果仅来自实验条件，实际使用仍需验证。"],
  ["示例产品增加任务历史导出", "Sample adds task history export", "用户可以把任务记录导出为文件，迁移时保留原有笔记和来源链接。"],
  ["示例模型发布新版本", "Example releases Model 4.5", "示例模型发布新版本"],
];
const candidates: Candidate[] = examples.map(([titleZh, title, summaryZh], index) => ({
  id: `example-${index}`, rawId: `example-${index}`, title: title!, sourceType: "rss", sourceName: `示例官方 ${index + 1}`,
  sourceRole: "official", url: `https://example.com/releases/${index}`, canonicalUrl: `https://example.com/releases/${index}`,
  excerpt: summaryZh!, publishedAt: new Date(Date.parse(now) - (index + 1) * 3_600_000).toISOString(), fetchedAt: now,
  score: 13, scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 0, heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 }, recommendationScore: 80,
  clusterSize: 1, relatedSources: [`示例官方 ${index + 1}`], evidence: "一手线索", imageCount: 0, images: [], selected: false,
  status: "candidate", topicIds: ["ai"], briefing: { titleZh: titleZh!, summaryZh: summaryZh!, basis: "full-source", generatedAt: now },
}));
state.runs = [{ id: "example-run", createdAt: now, updatedAt: now, collectedAt: now, status: "ready", stage: "完成",
  windowHours: 24, sourceIds: [], scheduled: false, rawCount: candidates.length, candidates, logs: [],
} satisfies WorkflowRun];
let today = buildTodayView(state, now);
const workbenchPreview = process.env.AI_NEWS_DESK_PREVIEW_WORKBENCH === "1";
const communityPreview = process.env.AI_NEWS_DESK_PREVIEW_COMMUNITY === "1";
const full = process.env.AI_NEWS_DESK_PREVIEW_MATRIX === "1" || workbenchPreview || communityPreview ? discoveryFixture(now) : undefined;
if (full) {
  state = full.state; today = full.today;
  if (workbenchPreview) {
    state.runs[0]!.origin = "collection";
    state.runs[0]!.candidates.forEach((candidate, index) => { candidate.selected = index < 2; });
    state.sources.filter(source => source.role !== "community").slice(0, 2).forEach((source, index) => {
      source.enabled = true; source.selected = true; source.name = `隔离采集来源 ${index + 1}`;
    });
  }
  const communityCandidate = structuredClone(state.runs[0]!.candidates[1]!);
  communityCandidate.id = "community-fixture"; communityCandidate.sourceRole = "community";
  communityCandidate.sourceName = "隔离示例 Hacker News";
  communityCandidate.engagement = { points: 8, comments: 4, discussionUrl: "https://example.com/discussion" };
  state.runs[0]!.candidates.push(communityCandidate);
  if (communityPreview) {
    state.runs[0]!.candidates = state.runs[0]!.candidates.filter(candidate => candidate.id !== "community-fixture");
    state.runs[0]!.candidates.forEach((candidate, index) => {
      candidate.sourceRole = "community"; candidate.sourceType = "hackernews"; candidate.sourceName = "隔离社区 Hacker News";
      candidate.topicIds = index < 4 ? ["ai"] : ["technology"];
      candidate.engagement = { points: (6 - index) * 8, comments: 4, discussionUrl: `https://example.com/discussion/${index}` };
    });
    const template = state.sources[0]!;
    state.sources = (["healthy", "error", "unknown"] as const).map((health, index) => ({
      ...template, id: `community-source-${index}`, name: `隔离社区来源 ${index + 1}`, role: "community", enabled: true,
      selected: false, health, note: "仅供隔离界面验收", lastHealthDetail: "虚构来源状态", lastCheckedAt: now,
    }));
  }
  state.notifications = [{ schemaVersion: "workflow-notification/v1", id: "fixture-notification", type: "collection-failed", severity: "warning", title: "隔离示例：来源待重试", message: "这是截图夹具，不是实际运行通知。", createdAt: now }];
}
const jobs = process.env.AI_NEWS_DESK_PREVIEW_JOBS === "1" ? [{ id: "example-job", lane: "foreground", type: "build-content-package",
  idempotencyKey: "example-only", status: "running", payload: { storyId: today.radar?.[0]?.story?.id, storyTitle: examples[0]![0] },
  progress: 0.4, stage: "读取原文", attempts: 1, maxAttempts: 3, createdAt: now, updatedAt: now, heartbeatAt: now }] : [];
const responses: Record<string, unknown> = {
  "/api/bootstrap": bootstrapView(state), "/api/editorial-system": buildEditorialSystemView(state, new Date(now)),
  "/api/today": today, "/api/home-layout": defaultHomeLayout, "/api/drafts/overview": buildDraftOverview(state.drafts),
  "/api/shell": { notifications: state.notifications, notificationsMuted: false, activeRunCount: 0 }, "/api/product/jobs": jobs,
  "/api/intakes/reviews": [], "/api/home-news": today.mustReads,
  "/api/community": buildCommunityView(state, now), "/api/aggregations": buildAggregationView(state, Date.parse(now)),
  "/api/x/status": { configured: false, paidEnabled: false, bearerTokenConfigured: false, sourceIds: [], mode: "disabled", detail: "隔离示例，不连接 X" },
  "/api/health": { ok: true, codex: { ok: true, detail: "隔离示例，无模型调用" }, publisher: { mode: "chrome-extension", ok: false, detail: "隔离示例，没有平台连接" }, horizon: { ok: true, detail: "隔离示例，采集已关闭" } },
  "/api/publisher/status": { mode: "chrome-extension", ok: false, detail: "隔离示例，没有平台连接" },
  "/api/data/storage": { stateBytes: 0, databaseBytes: 0, legacyStateBytes: 0, mediaBytes: 0, materialBytes: 0, jobBytes: 0, backupBytes: 0, totalBytes: 0 },
  "/api/delivery/social/status": { connected: false, settings: { enabled: false, extensionId: "", tokenConfigured: false }, accounts: [] },
};
if (full) {
  const communityStory = structuredClone(full.story);
  communityStory.explanation.status = "ready";
  const communityDetail = {
    story: communityStory, contentPackage: full.contentPackage,
    intake: { storyId: communityStory.id, signalId: "ui-fixture:community-fixture", sourceKind: "linked-community", recommendedIntent: "news", recommendationReason: "隔离示例：先核对外部原文，社区仅作讨论线索。", options: [
      { intent: "news", mode: "brief", available: false, workingCopy: false, label: "按新闻写", description: "隔离示例，不调用生成", reason: "示例材料不用于真实生成" },
      { intent: "source", mode: "curate", available: false, workingCopy: true, label: "整理原文", description: "隔离示例", reason: "仅用于界面验收" },
      { intent: "community", mode: "community", available: false, workingCopy: false, label: "分析讨论", description: "有限样本", reason: "少于 5 条有效样本" },
    ] },
  };
  responses["/api/editorial-intakes/ui-fixture/community-fixture"] = communityDetail;
  if (communityPreview) for (const candidate of state.runs[0]!.candidates) {
    const detail = structuredClone(communityDetail);
    detail.story.title = candidate.briefing?.titleZh || candidate.title;
    detail.story.originalTitle = candidate.title;
    detail.contentPackage.title = detail.story.title;
    detail.intake.signalId = `ui-fixture:${candidate.id}`;
    detail.story.signals.push({
      ...structuredClone(communityStory.signals[0]!), runId: "ui-fixture", candidateId: candidate.id,
      sourceName: candidate.sourceName, sourceRole: "community", sourceType: "hackernews",
      title: candidate.title, titleZh: candidate.briefing?.titleZh, url: candidate.url,
      discussionUrl: candidate.engagement?.discussionUrl, isCommunity: true, factBearing: false, linkedSource: true,
      engagement: { points: candidate.engagement?.points, comments: candidate.engagement?.comments },
    });
    responses[`/api/editorial-intakes/ui-fixture/${candidate.id}`] = detail;
  }
  responses[`/api/stories/${full.story.id}`] = { story: full.story, contentPackage: full.contentPackage, feedback: [] };
  responses[`/api/stories/${full.story.id}/reading`] = full.contentPackage.sourceEvidence;
  responses[`/api/drafts/${full.draft.id}`] = full.draft;
  responses[`/api/drafts/${full.draft.id}/revisions`] = [];
  responses[`/api/drafts/${full.draft.id}/agent/threads`] = [];
}
const app = express();
app.use(express.json({ limit: "16kb" }));
app.use("/api", (req, res, next) => {
  // This opt-in fixture updates only fictional in-memory selection. No worker,
  // storage, collection, generation or delivery routes are made writable.
  if (workbenchPreview && req.method === "PATCH" && /^\/runs\/ui-fixture\/candidates\/[a-f0-9]{14}$/u.test(req.path)) {
    const candidate = state.runs[0]!.candidates.find(item => item.id === req.path.split("/").at(-1));
    if (!candidate || typeof req.body?.selected !== "boolean") { res.status(400).json({ error: "无效的示例选择" }); return; }
    candidate.selected = req.body.selected; responses["/api/bootstrap"] = bootstrapView(state);
    res.json({ run: state.runs[0] }); return;
  }
  // The reader records an opened event; this fixture acknowledges it without storing anything.
  if (full && req.method === "POST" && /^\/stories\/[^/]+\/events$/u.test(req.path)) { res.json({ event: { id: "fixture-event", createdAt: now } }); return; }
  if (req.method !== "GET") { res.status(405).json({ error: "隔离截图仅允许读取示例数据" }); return; }
  if (req.path === "/events") {
    res.setHeader("Content-Type", "text/event-stream"); res.write(`event: jobs\ndata: ${JSON.stringify(jobs)}\n\n`);
    return;
  }
  const value = responses[`/api${req.path}`];
  if (value !== undefined) { res.json(value); return; }
  next();
});
app.use("/api", (_req, res) => { res.status(404).json({ error: "示例接口未配置" }); });
// Same-origin comparison keeps SVG rasterization in the same renderer. Both
// builds remain distinct; only their HTML asset prefix is redirected here.
if (process.env.AI_NEWS_DESK_PREVIEW_BEFORE_DIST) {
  const beforeRoot = path.resolve(process.env.AI_NEWS_DESK_PREVIEW_BEFORE_DIST);
  // Vite's modulepreload map uses absolute /assets paths. Prefer current assets
  // and fall back to old hashed assets; relative imports still stay in __before.
  app.use("/assets", express.static(path.join(path.resolve(process.env.AI_NEWS_DESK_DIST_ROOT || ".artifacts/verify/dist"), "assets")));
  app.use("/assets", express.static(path.join(beforeRoot, "assets")));
  app.use("/__before/assets", express.static(path.join(beforeRoot, "assets"), { fallthrough: false }));
  app.get("/__before/", async (_req, res, next) => {
    try { res.type("html").send((await readFile(path.join(beforeRoot, "index.html"), "utf8")).replaceAll('="/assets/', '="/__before/assets/')); }
    catch (error) { next(error); }
  });
}
app.use(express.static(path.resolve(process.env.AI_NEWS_DESK_DIST_ROOT || ".artifacts/verify/dist")));
const server = app.listen(0, "127.0.0.1", () => {
  const address = server.address();
  if (address && typeof address !== "string") console.log(`http://127.0.0.1:${address.port}`);
});
process.on("SIGTERM", () => { server.closeAllConnections(); server.close(); });
process.on("SIGINT", () => { server.closeAllConnections(); server.close(); });
