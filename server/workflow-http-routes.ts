import { codexStatus, requestSelectedDraftGeneration } from "./generator.js";
import {
  cancelCollectionRun,
  createCollectionRun,
  enrichCandidateBriefings,
  executeCollection,
  recoverInterruptedRuns,
  retryCollectionRun,
} from "./horizon.js";
import { fillDraftInPublisher, openPublisher, publisherStatus } from "./publishing.js";
import { importArticleSkill, readSkillInstructions } from "./skill-registry.js";
import { buildHomeNews, storyById, retainStoryForWriting } from "./story-desk.js";
import {
  getLocalDatabase,
  readState,
  readStateProjection,
  replaceState,
  runStorageExclusive,
  updateState,
  workflowMaterialsRoot,
  workflowJobsRoot,
  workflowMediaRoot,
  workflowRoot,
} from "./storage.js";
import { bootstrapView, runDiagnosticsView } from "./bootstrap-view.js";
import { normalizeTopicIds } from "./topics.js";
import {
  applySpendingPolicy,
  assertMeteredProviderAllowed,
  assertMeteredSourceAllowed,
} from "./spending-policy.js";
import type {
  AiProviderConfig,
  ArticleAgentDraftInput,
  ArticleAgentRole,
  ArticleDraft,
  CandidateFeedbackKind,
  CollectionRequest,
  DraftSaveMode,
  EditorialProfile,
  ImageMaterial,
  Settings,
  SourceConfig,
  SourcePreset,
} from "./types.js";
import { retryPackageJob } from "./job-recovery.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, validDateInput, routeParam } from "./http-route-support.js";

export function registerWorkflowHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/bootstrap",
  asyncRoute(async (_request, response) => {
    const state = await runtime.readStateProjection(bootstrapView);
    const skills = await Promise.all(state.aiSettings.skills.map(async (skill) => ({
      ...skill,
      available: Boolean((await readSkillInstructions(skill, 512)).trim()),
    })));
    response.json({
      ...state,
      aiSettings: { ...state.aiSettings, skills },
    });
  }),
);

app.get(
  "/api/shell",
  asyncRoute(async (_request, response) => {
    const state = await runtime.readState();
    response.json({
      notifications: state.notifications.slice(0, 80),
      notificationsMuted: state.settings.notificationsMuted,
      activeRunCount: state.runs.filter((run) => ["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status)).length,
    });
  }),
);

app.get("/api/runs/:runId/diagnostics", asyncRoute(async (request, response) => {
  const diagnostics = await runtime.readStateProjection(state => runDiagnosticsView(state, routeParam(request.params.runId), runtime.readArtifact));
  if (!diagnostics) { response.status(404).json({ error: "运行记录不存在" }); return; }
  response.json(diagnostics);
}));
}

export function registerWorkflowHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.post("/api/product/jobs/:jobId/retry", asyncRoute(async (request, response) => {
  const database = await runtime.getLocalDatabase();
  const oldJob = database.getJob(routeParam(request.params.jobId));
  if (!oldJob || !["build-content-package", "draft-from-package", "draft-from-editorial-intake", "draft-from-intake-review", "explain-story", "hydrate-story-assets", "supplement-story-evidence"].includes(oldJob.type) || oldJob.status !== "failed") { response.status(409).json({ error: "这个任务不能从这里重试" }); return; }
  const storyId = oldJob.payload && typeof oldJob.payload === "object" && "storyId" in oldJob.payload ? String(oldJob.payload.storyId) : "";
  const story = storyById(await runtime.readState(), storyId);
  if (story) await runtime.updateState((state) => retainStoryForWriting(state, storyId, runtime.readArtifact));
  response.status(202).json(retryPackageJob(database, oldJob.id, story?.title));
}));
}

export function registerWorkflowHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/product/jobs",
  asyncRoute(async (request, response) => {
    const limit = Number(request.query.limit ?? 100);
    response.json((await runtime.getLocalDatabase()).listJobs(Number.isFinite(limit) ? limit : 100));
  }),
);

app.get(
  "/api/product/jobs/:jobId",
  asyncRoute(async (request, response) => {
    const job = (await runtime.getLocalDatabase()).getJob(routeParam(request.params.jobId));
    if (!job) {
      response.status(404).json({ error: "任务不存在" });
      return;
    }
    response.json(job);
  }),
);
}

export function registerWorkflowHttpRoutes4(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/events",
  asyncRoute(async (request, response) => {
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.flushHeaders();
    const database = await runtime.getLocalDatabase();
    let latestId = database.listWorkflowEvents(1)[0]?.id;
    let latestJobsJson = "";
    const writeJobs = () => {
      const jobsJson = JSON.stringify(database.listJobs(20));
      if (jobsJson === latestJobsJson) return;
      latestJobsJson = jobsJson;
      response.write(`event: jobs\ndata: ${jobsJson}\n\n`);
    };
    response.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    writeJobs();
    const timer = setInterval(() => {
      try {
        const events = database.listWorkflowEvents(50);
        const cursorIndex = latestId ? events.findIndex((event) => event.id === latestId) : -1;
        const unseen = latestId
          ? cursorIndex >= 0 ? events.slice(0, cursorIndex) : events.slice(0, 1)
          : events.slice(0, 1);
        for (const event of [...unseen].reverse()) {
          response.write(`event: workflow\ndata: ${JSON.stringify(event)}\n\n`);
        }
        latestId = events[0]?.id ?? latestId;
        writeJobs();
        response.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        // The next interval retries. A transient read error must not terminate
        // the user's open editor or force a full-page reload.
      }
    }, 3_000);
    request.on("close", () => clearInterval(timer));
  }),
);
}

export function registerWorkflowHttpRoutes5(app: Express, runtime: HttpRouteRuntime): void {
app.get("/api/desktop/status", (_request, response) => {
  response.json({ app: "ai-news-desk", projectPath: process.cwd(), workflowRoot, pid: process.pid });
});

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    const state = await runtime.readState();
    const [codex, publisher] = await Promise.all([
      codexStatus(),
      publisherStatus(state.settings),
    ]);
    response.json({ ok: true, codex, publisher, horizon: { ok: true, detail: "本地 Horizon 已接入" } });
  }),
);
}

export function registerWorkflowHttpRoutes6(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/runs/collect",
  asyncRoute(async (request, response) => {
    const body = (request.body ?? {}) as CollectionRequest;
    const dateFrom = typeof body.dateFrom === "string" ? body.dateFrom.trim() : undefined;
    const dateTo = typeof body.dateTo === "string" ? body.dateTo.trim() : undefined;
    if ((dateFrom || dateTo) && (!dateFrom || !dateTo || !validDateInput(dateFrom) || !validDateInput(dateTo))) {
      response.status(400).json({ error: "请填写有效的开始日期和结束日期" });
      return;
    }
    if (dateFrom && dateTo) {
      const rangeDays = (Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000;
      if (rangeDays < 0) {
        response.status(400).json({ error: "开始日期不能晚于结束日期" });
        return;
      }
      if (rangeDays > 30) {
        response.status(400).json({ error: "单次最多搜索 31 天，请缩短日期范围" });
        return;
      }
    }
    const keywords = typeof body.keywords === "string" ? body.keywords.trim() : undefined;
    if (keywords && keywords.length > 120) {
      response.status(400).json({ error: "关键词最多 120 个字符" });
      return;
    }
    const sourceIds = Array.isArray(body.sourceIds)
      ? body.sourceIds.filter((id): id is string => typeof id === "string").slice(0, 50)
      : undefined;
    if (sourceIds?.length) {
      const spendingState = await runtime.readState();
      for (const source of spendingState.sources.filter((entry) => sourceIds.includes(entry.id))) {
        assertMeteredSourceAllowed(spendingState, source);
      }
    }
    const result = await createCollectionRun({
      dateFrom,
      dateTo,
      keywords,
      sourceIds,
      topicIds: normalizeTopicIds(body.topicIds),
    });
    response.status(result.created ? 202 : 200).json({ ...result, reused: !result.created });
  }),
);

app.post(
  "/api/runs/:runId/cancel",
  asyncRoute(async (request, response) => {
    const runId = Array.isArray(request.params.runId) ? request.params.runId[0] : request.params.runId;
    const state = await runtime.readState();
    if (!state.runs.some((run) => run.id === runId)) {
      response.status(404).json({ error: "运行记录不存在" });
      return;
    }
    const run = await cancelCollectionRun(runId);
    if (!run) response.status(409).json({ error: "这个任务已经结束，无法取消" });
    else response.json(run);
  }),
);

app.post(
  "/api/runs/:runId/retry",
  asyncRoute(async (request, response) => {
    const runId = Array.isArray(request.params.runId) ? request.params.runId[0] : request.params.runId;
    const result = await retryCollectionRun(runId);
    response.status(result.created ? 202 : 200).json({ ...result, reused: !result.created });
  }),
);

app.post(
  "/api/runs/:runId/briefings",
  asyncRoute(async (request, response) => {
    const runId = Array.isArray(request.params.runId) ? request.params.runId[0] : request.params.runId;
    const state = await runtime.readState();
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) {
      response.status(404).json({ error: "运行记录不存在" });
      return;
    }
    if (["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status)) {
      response.status(409).json({ error: "任务仍在运行，中文摘要会在采集后自动生成" });
      return;
    }
    const candidateIds = Array.isArray(request.body?.candidateIds)
      ? request.body.candidateIds.filter((value: unknown): value is string => typeof value === "string").slice(0, 30)
      : undefined;
    response.json(await enrichCandidateBriefings(runId, { candidateIds }));
  }),
);

app.patch(
  "/api/runs/:runId/candidates/:candidateId",
  asyncRoute(async (request, response) => {
    const candidate = await runtime.updateState((state) => {
      const target = state.runs
        .find((entry) => entry.id === request.params.runId)
        ?.candidates.find((entry) => entry.id === request.params.candidateId);
      if (!target) return undefined;
      target.selected = Boolean(request.body.selected);
      return target;
    });
    if (!candidate) response.status(404).json({ error: "候选新闻不存在" });
    else response.json(candidate);
  }),
);
}

export function registerWorkflowHttpRoutes7(app: Express, runtime: HttpRouteRuntime): void {
app.delete(
  "/api/runs/:runId/candidates",
  asyncRoute(async (request, response) => {
    const result = await runtime.updateState((state) => {
      const run = state.runs.find((entry) => entry.id === request.params.runId);
      if (!run) return undefined;
      if (["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status)) {
        throw new Error("任务仍在运行，完成或取消后才能清空候选");
      }
      const candidateIds = Array.isArray(request.body?.candidateIds)
        ? new Set(request.body.candidateIds.filter((value: unknown): value is string => typeof value === "string"))
        : undefined;
      const cleared = candidateIds
        ? run.candidates.filter((candidate) => candidateIds.has(candidate.id)).length
        : run.candidates.length;
      const clearedAt = new Date().toISOString();
      run.candidates = candidateIds
        ? run.candidates.filter((candidate) => !candidateIds.has(candidate.id))
        : [];
      if (!run.candidates.length) run.candidatesClearedAt = clearedAt;
      run.stage = run.candidates.length ? "部分候选已清空" : "候选已清空";
      run.updatedAt = clearedAt;
      run.logs.push({
        at: clearedAt,
        stage: run.stage,
        message: `已清空 ${cleared} 条候选；已有草稿和来源记录不受影响`,
        level: "info",
      });
      return { run, cleared };
    });
    if (!result) response.status(404).json({ error: "运行记录不存在" });
    else response.json(result);
  }),
);
}

export const workflowHttpRouteRegistrars = [registerWorkflowHttpRoutes1, registerWorkflowHttpRoutes2, registerWorkflowHttpRoutes3, registerWorkflowHttpRoutes4, registerWorkflowHttpRoutes5, registerWorkflowHttpRoutes6, registerWorkflowHttpRoutes7] as const;
