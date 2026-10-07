import { buildAggregationView, retainAggregationEntry } from "./aggregation-desk.js";
import { aggregationSourceIds } from "./aggregation-catalog.js";
import { traceDiscoveryUrl } from "./discovery-trace.js";
import { readStoredStorySources } from "./source-desk.js";
import { createHash, randomUUID } from "node:crypto";
import { readTodayView } from "./today-view-cache.js";
import {
  cancelCollectionRun,
  createCollectionRun,
  enrichCandidateBriefings,
  executeCollection,
  recoverInterruptedRuns,
  retryCollectionRun,
} from "./horizon.js";
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
import { normalizeTopicIds } from "./topics.js";
import { buildFocusedNewsSearchRequest, buildTopicFeed, communityPlatforms, createZhihuHotlist, retainZhihuTopic } from "./source-desk.js";
import {
  applySpendingPolicy,
  assertMeteredProviderAllowed,
  assertMeteredSourceAllowed,
} from "./spending-policy.js";
import type { AssignmentMode, ContentPackage, EditorialIntent } from "./product-types.js";
import { homeLayoutFor, parseHomeLayout } from "./home-layout.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, routeParam } from "./http-route-support.js";

export function registerStoryHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.get("/api/discovery/trace", async (request, response, next) => {
  try { response.json(traceDiscoveryUrl(await runtime.readState(), String(request.query.url ?? ""))); }
  catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "链接诊断失败" }); }
});

app.get("/api/home-news", asyncRoute(async (request, response) => {
  const keyword = typeof request.query.keyword === "string" ? request.query.keyword.trim().slice(0, 120) : "";
  response.json(buildHomeNews(await runtime.readState(), keyword));
}));

app.get("/api/home-layout", asyncRoute(async (_request, response) => {
  response.json(homeLayoutFor((await runtime.readState()).settings.homeLayout));
}));

app.patch("/api/home-layout", asyncRoute(async (request, response) => {
  let layout;
  try { layout = parseHomeLayout(request.body); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "栏目设置无效" }); return; }
  await runtime.updateState((state) => { state.settings.homeLayout = layout; });
  response.json(layout);
}));
}

export function registerStoryHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.get("/api/aggregations", asyncRoute(async (_request, response) => {
  response.json(buildAggregationView(await runtime.readState()));
}));

app.post("/api/aggregations/refresh", asyncRoute(async (_request, response) => {
  const state = await runtime.readState();
  const sourceIds = state.sources.filter(s => aggregationSourceIds.has(s.id) && s.enabled && s.selected).map(s => s.id);
  if (!sourceIds.length) { response.status(409).json({error: "请在新闻源中启用并选入至少一个聚合平台。"}); return; }
  const result = await createCollectionRun({sourceIds, topicIds: ["ai"], windowHours: 7 * 24, aggregation: true});
  if (!result.created && !sourceIds.every(id => result.run.sourceIds.includes(id))) {
    response.status(409).json({error: "另一个采集任务正在运行，请等它完成后再更新聚合资讯。"}); return;
  }
  response.json(result);
}));

app.post("/api/aggregations/:id/select", asyncRoute(async (request, response) => {
  const id = routeParam(request.params.id);
  if (!buildAggregationView(await runtime.readState()).entries.some(e => e.id === id)) { response.status(404).json({error: "条目已不在当前快照，请刷新列表。"}); return; }
  response.json(await runtime.updateState(state => retainAggregationEntry(state, id)));
}));
}

export function registerStoryHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/today/titles",
  asyncRoute(async (_request, response) => { response.json(await runtime.backfillTodayTitles()); }),
);

app.get(
  "/api/today",
  asyncRoute(async (_request, response) => {
    const view = await readTodayView();
    // Browsing must not enqueue legacy maintenance or invoke a provider.
    if (_request.query.readOnly === "1") { response.json(view); return; }
    const database = await runtime.getLocalDatabase();
    for (const story of [...view.mustReads, ...(view.interesting ?? []), ...view.secondary].slice(0, 5)) {
      if ((story.localImageCount ?? 0) >= 2) continue;
      database.enqueueJob({
        lane: "background",
        type: "hydrate-story-assets",
        idempotencyKey: `hydrate-story-assets:${story.id}:${story.lastSeenAt}`,
        payload: { storyId: story.id, minimumImages: 2 },
        maxAttempts: 2,
      });
    }
    const evidencePool = [
      ...view.watching,
      ...(view.pending ?? []),
      ...view.mustReads,
      ...(view.interesting ?? []),
      ...view.secondary,
    ].filter((story, index, stories) => (story.evidenceStrength !== "strong"
      || Boolean(story.releaseDossier && story.releaseDossier.readyCount < story.releaseDossier.totalCount))
      && stories.findIndex((entry) => entry.id === story.id) === index);
    const evidenceJobs = database.listJobs(500).filter((job) => job.type === "supplement-story-evidence");
    const activeEvidenceStoryIds = new Set(evidenceJobs
      .filter((job) => ["queued", "running", "retrying"].includes(job.status))
      .map((job) => job.payload && typeof job.payload === "object" && "storyId" in job.payload
        ? String((job.payload as { storyId: unknown }).storyId)
        : "")
      .filter(Boolean));
    const recentCutoff = Date.now() - 6 * 60 * 60_000;
    const recentlyAttemptedStoryIds = new Set(evidenceJobs
      .filter((job) => Date.parse(job.updatedAt) >= recentCutoff)
      .map((job) => job.payload && typeof job.payload === "object" && "storyId" in job.payload
        ? String((job.payload as { storyId: unknown }).storyId)
        : "")
      .filter(Boolean));
    const availableSlots = Math.max(0, 5 - activeEvidenceStoryIds.size);
    const evidenceCandidates = evidencePool
      .filter((story) => !activeEvidenceStoryIds.has(story.id) && !recentlyAttemptedStoryIds.has(story.id))
      .slice(0, availableSlots);
    const evidenceRetryWindow = Math.floor(Date.now() / (6 * 60 * 60_000));
    for (const story of evidenceCandidates) {
      database.enqueueJob({
        lane: "background",
        type: "supplement-story-evidence",
        idempotencyKey: `supplement-story-evidence:auto:${story.id}:${story.lastSeenAt}:${evidenceRetryWindow}`,
        payload: { storyId: story.id, trigger: "auto" },
        maxAttempts: 2,
      });
    }
    response.json(view);
  }),
);

app.get(
  "/api/stories/:storyId",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const story = storyById(await runtime.readState(), storyId);
    if (!story) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    const database = await runtime.getLocalDatabase();
    response.json({
      story,
      contentPackage: database.latestContentPackageForStory<ContentPackage>(storyId),
      feedback: database.listFeedback("story", storyId, 30),
      assetCollection: database.listJobs(500).find((job) => job.type === "hydrate-story-assets" && job.status === "complete"
        && (job.payload as { storyId?: string; scope?: string } | undefined)?.storyId === storyId
        && (job.payload as { scope?: string }).scope === "article")?.result,
    });
  }),
);

app.get(
  "/api/stories/:storyId/reading",
  asyncRoute(async (request, response) => {
    const story = storyById(await runtime.readState(), routeParam(request.params.storyId));
    if (!story) { response.status(404).json({ error: "Story 不存在" }); return; }
    const database = await runtime.getLocalDatabase();
    response.json(readStoredStorySources(story, database.latestContentPackageForStory<ContentPackage>(story.id), database));
  }),
);
}

export function registerStoryHttpRoutes4(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/stories/:storyId/explanation",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const story = storyById(await runtime.readState(), storyId);
    if (!story) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    const force = request.body?.force === true;
    if (story.explanation.status === "ready" && !force) {
      response.json({ story, reused: true });
      return;
    }
    const database = await runtime.getLocalDatabase();
    const explanationRevision = story.explanation.generatedAt || story.lastSeenAt;
    const queued = database.enqueueJob({
      type: "explain-story",
      idempotencyKey: force
        ? `explain-story:v2-refresh:${story.id}:${explanationRevision}`
        : `explain-story:v2:${story.id}:${story.lastSeenAt}`,
      payload: { storyId: story.id },
      maxAttempts: 2,
    });
    if (queued.job.status === "complete") {
      const updated = storyById(await runtime.readState(), storyId);
      response.json({ job: queued.job, story: updated, reused: true });
      return;
    }
    response.status(202).json({ job: queued.job, story, reused: queued.reused });
  }),
);
}

export function registerStoryHttpRoutes5(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/stories/:storyId/assets",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const story = storyById(await runtime.readState(), storyId);
    if (!story) { response.status(404).json({ error: "Story 不存在" }); return; }
    const database = await runtime.getLocalDatabase();
    const active = database.listJobs(500).find((job) => job.type === "hydrate-story-assets"
      && ["queued", "running", "retrying"].includes(job.status)
      && (job.payload as { storyId?: string; scope?: string } | undefined)?.storyId === storyId
      && (job.payload as { scope?: string }).scope === "article");
    const queued = active ? { job: active, reused: true } : database.enqueueJob({
      type: "hydrate-story-assets", idempotencyKey: `article-assets:${storyId}:${randomUUID()}`,
      payload: { storyId, minimumImages: 2, scope: "article" }, maxAttempts: 1,
    });
    response.status(202).json(queued);
  }),
);
}

export function registerStoryHttpRoutes6(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/stories/:storyId/evidence",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const story = storyById(await runtime.readState(), storyId);
    if (!story) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    if (story.evidenceStrength === "strong"
      && (!story.releaseDossier || story.releaseDossier.readyCount >= story.releaseDossier.totalCount)) {
      response.json({ story, reused: true });
      return;
    }
    const database = await runtime.getLocalDatabase();
    const activeJob = database.listJobs(100).find((job) => job.type === "supplement-story-evidence"
      && ["queued", "running", "retrying"].includes(job.status)
      && job.payload && typeof job.payload === "object" && "storyId" in job.payload
      && String((job.payload as { storyId: unknown }).storyId) === storyId);
    if (activeJob) {
      response.status(202).json({ job: activeJob, story, reused: true });
      return;
    }
    const queued = database.enqueueJob({
      type: "supplement-story-evidence",
      idempotencyKey: `supplement-story-evidence:manual:${story.id}:${randomUUID()}`,
      payload: { storyId, trigger: "manual" },
      maxAttempts: 2,
    });
    if (queued.job.status === "complete") {
      response.json({
        job: queued.job,
        story: storyById(await runtime.readState(), storyId),
        reused: true,
      });
      return;
    }
    response.status(202).json({ job: queued.job, story, reused: queued.reused });
  }),
);
}

export function registerStoryHttpRoutes7(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/stories/search",
  asyncRoute(async (request, response) => {
    const body = (request.body ?? {}) as { query?: unknown };
    const query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) {
      response.status(400).json({ error: "请输入要搜索的模型、公司或事件" });
      return;
    }
    if (query.length > 120) {
      response.status(400).json({ error: "搜索词最多 120 个字符" });
      return;
    }
    const state = await runtime.readState();
    const collection = buildFocusedNewsSearchRequest(
      state.sources,
      query,
      normalizeTopicIds(state.settings.collectionTopics),
    );
    if (!collection.sourceIds?.length) {
      response.status(409).json({ error: "当前没有已启用的官网或新闻来源，请先在来源页启用至少一个来源" });
      return;
    }
    for (const source of state.sources.filter((entry) => collection.sourceIds?.includes(entry.id))) {
      assertMeteredSourceAllowed(state, source);
    }
    const result = await createCollectionRun(collection);
    response.status(result.created ? 202 : 200).json({ ...result, reused: !result.created });
  }),
);
}

export const storyHttpRouteRegistrars = [registerStoryHttpRoutes1, registerStoryHttpRoutes2, registerStoryHttpRoutes3, registerStoryHttpRoutes4, registerStoryHttpRoutes5, registerStoryHttpRoutes6, registerStoryHttpRoutes7] as const;
