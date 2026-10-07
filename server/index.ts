import { inspectXiaoheiheCover } from "./xiaoheihe-cover.js";
import { normalizeXiaoheiheOptions, reserveXiaoheiheDefaults, xiaoheiheSelection } from "./xiaoheihe-publishing.js";
import { ensurePublisherConnected } from "./publishing.js";
import { primaryDeliveryStatus, wechatPreflight, resolveWeChatAttempt } from "./primary-delivery.js";
import { normalizeWeChatMetadata } from "./wechat-metadata.js";
import { normalizeSocialMetadata } from "./social-metadata.js";
import { registerDraftLibraryRoutes } from "./draft-library-routes.js";
import { registerAiStyleScoreRoutes } from "./ai-style-score-routes.js";
import { registerSocialDeliveryRoutes, startSocialBridge, socialDeliveryServices } from "./social-delivery-routes.js";
import { createDeliveryBatchDesk, pendingDeliveryBatchJobs } from "./delivery-batch-desk.js";
import { createDeliveryBatchDrivers } from "./delivery-batch-drivers.js";
import { registerDeliveryBatchRoutes } from "./delivery-batch-routes.js";
import { deliveryPlatforms, type DeliveryPlatform } from "./delivery-batch-types.js";
import { openRegularChromeUrls } from "./chrome-launch.js";
import { registerCommunityRoutes } from "./community-routes.js";
import { buildAggregationView, retainAggregationEntry } from "./aggregation-desk.js";
import { aggregationSourceIds } from "./aggregation-catalog.js";
import { writingPreferencePlan } from "./writing-preference-retrieval.js";
import { recordEditObservation } from "./edit-observation.js";
import { draftReworkChanges, readReworkObservations, summarizeReworkObservations } from "./draft-rework.js";
import { reviewDraftQuality, bindReviewedParagraph } from "./draft-quality-review.js";
import { affectedDraftsForSourceChanges } from "./source-change-impact.js";
import { traceDiscoveryUrl } from "./discovery-trace.js";
import { confirmDraftInState } from "./draft-confirmation.js";
import { queueEditorialDraft } from "./editorial-jobs.js";
import { readStoredStorySources } from "./source-desk.js";
import { createHash, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
import { createTodayTitleBackfill, enqueueTodayTitleBackfill } from "./today-title-backfill.js";
import { readTodayView } from "./today-view-cache.js";
import { pruneJobArtifacts } from "./artifact-retention.js";
import { buildDraftOverview } from "./draft-overview.js";
import { createLocalSecurityMiddleware } from "./http-security.js";
import {
  insertedMediaIds,
  publisherImagePostBodyHtml,
  publisherBodyHtml,
  publisherImageCaptions,
  sanitizeDraftHtml,
} from "./article-html.js";
import {
  articleAgentThreadsForDraft,
  askArticleAgent,
  createArticleAgentThread,
} from "./article-agent.js";
import {
  clearCandidateFeedback,
  recordCandidateFeedback,
  recordPublishedCandidateFeedback,
  restoreCandidateFeedback,
} from "./candidate-feedback.js";
import { codexStatus, requestSelectedDraftGeneration } from "./generator.js";
import { createCommunityDraft, type CommunityDraftMode } from "./community-draft.js";
import {
  cancelCollectionRun,
  createCollectionRun,
  enrichCandidateBriefings,
  executeCollection,
  recoverInterruptedRuns,
  retryCollectionRun,
} from "./horizon.js";
import { appendDraftRevision, restoreDraftRevision, revisionsForDraft, snapshotDraft } from "./draft-revisions.js";
import {
  checksumForState,
  createPortableWorkflowArchive,
  createWorkflowBackup,
  storageUsageFor,
  verifyWorkflowBackup,
} from "./data-management.js";
import { PortableArchiveInspectionError } from "./portable-archive-inspector.js";
import {
  PortableArchiveUploadError,
  previewPortableArchiveUpload,
  withPortableArchiveUpload,
} from "./portable-archive-upload.js";
import {
  createPortableArchiveImportConfirmationDesk,
  PortableArchiveImportConfirmationError,
} from "./portable-archive-import-confirmation.js";
import {
  importPortableArchive,
  isPortableArchiveImportActive,
  PortableArchiveImportError,
} from "./portable-archive-importer.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import {
  draftQualityFindingsFor,
  evaluateDraftPackageQuality,
  reconcileDraftFactEvidence,
} from "./editorial-quality-desk.js";
import { assertDraftTransition } from "./draft-lifecycle.js";
import {
  attachWeChatDeliveryReceipt,
  attachXiaoheiheDeliveryReceipt,
  confirmDraftPublication,
  currentPublicationConfirmation,
  PublicationRevisionConflictError,
  publicationRevisionHash,
  assertPublicationRevision,
  reconcileDraftPublicationAfterEdit,
  recordXiaoheiheFillAttempt,
} from "./publication-state.js";
import { importDraftImageFromUrl, saveUploadedDraftImage } from "./media.js";
import { normalizeLegacyUserUpload } from "./user-provided-media.js";
import {
  buildScreenshotImagePostDraft,
  saveScreenshotImagePostAssets,
  type ScreenshotCropRegion,
} from "./image-post.js";
import {
  assertUniqueMaterialFingerprint,
  copyMaterialToDraft,
  DuplicateMaterialError,
  importMaterialFromUrl,
  removeMaterialFile,
  saveMaterialBytes,
  saveUploadedMaterial,
} from "./materials.js";
import {
  loadOptionalMaterialLibraryCatalog,
  seedMaterialLibrary,
} from "./material-library-seed.js";
import {
  evaluatePublishedImagePromotion,
  inspectDraftImageFile,
  publicPublishedImagePromotionStatus,
} from "./published-materials.js";
import {
  extensionPublisherBridge,
  MINIMUM_EXTENSION_VERSION,
  UnsupportedExtensionVersionError,
  ExtensionPublisherProtocolError,
} from "./publisher-extension.js";
import {
  appendEditorialReadiness,
  evaluatePublisherPreflight,
  publisherRuntimeFromStatus,
} from "./publisher-preflight.js";
import { fillDraftInPublisher, openPublisher, publisherStatus } from "./publishing.js";
import { rememberRecentValues } from "./publishing-memory.js";
import { reapplyPersonalizationToRuns } from "./personalization.js";
import {
  buildEditorialSystemView,
  decideEditorialSuggestion,
  updateEditorialProfile,
} from "./editorial-system.js";
import {
  recordDraftEdit,
  recordPublishedWritingSignals,
  writingMemoryView,
} from "./learning-desk.js";
import { completionAvailability, editorialProfileForWriting } from "./editorial-controls.js";
import { probeProviderConnection } from "./provider-health.js";
import { validateRemoteUrl } from "./remote-url.js";
import {
  applySourcePreset,
  batchUpdateSources,
  createSourcePreset,
  deleteSourcePreset,
} from "./source-management.js";
import { applySourceProbeResult, probeSource } from "./source-probe.js";
import { officialPollInterval } from "./official-source-monitor.js";
import { normalizePublisherTopics } from "./xiaoheihe-format.js";
import { startScheduler } from "./scheduler.js";
import { startOwnedServer } from "./startup.js";
import {
  deleteProviderApiKey,
  deleteXBearerToken,
  deleteWeChatAppSecret,
  getXBearerToken,
  getWeChatAppSecret,
  setProviderApiKey,
  setXBearerToken,
  setWeChatAppSecret,
} from "./secrets.js";
import { readXCredentialStatus } from "./x-credentials.js";
import { accountsForXSource } from "./x-official.js";
import { importArticleSkill, readSkillInstructions } from "./skill-registry.js";
import { createWeChatDraftDesk } from "./wechat-draft.js";
import { createWeChatHttpGateway } from "./wechat-http.js";
import { loadWeChatPlacementImage } from "./wechat-image.js";
import { createDeliveryDesk } from "./delivery-desk.js";
import { createWeChatDelivery } from "./wechat-delivery.js";
import { createXiaoheiheDelivery } from "./xiaoheihe-delivery.js";
import { buildWorkflowPerformance } from "./workflow-performance.js";
import { contentPackageDesk } from "./content-package-desk.js";
import { buildHomeNews, storyById, retainStoryForWriting } from "./story-desk.js";
import { enrichStoryExplanation } from "./story-explanation-service.js";
import { storyEvidenceDesk } from "./story-evidence-desk.js";
import {
  createDraftFromPackage,
  createHumanDraftFromPackage,
  editorialGeneratorRevision,
} from "./draft-desk.js";
import { editorialIntakeDesk } from "./editorial-intake.js";
import { ClassifiedJobError, createJobDesk } from "./job-desk.js";
import {
  buildInlineCompletionPrompt,
  isStableInlineCompletionPreview,
  prepareInlineCompletion,
} from "./inline-completion.js";
import { runInlineCompletionProvider, streamInlineCompletionProvider } from "./provider-runtime.js";
import { hydrateStoryAssets } from "./visual-desk.js";
import {
  confirmIntakeReview,
  executeReviewGeneration,
  createLinkIntakeReview,
  createManualXPostIntakeReview,
  createScreenshotIntakeReview,
  ensureIntakeContentPackageForDraft,
  listIntakeReviews,
} from "./intake-review-service.js";
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
import { sourceRoleFor } from "./source-routing.js";
import { buildFocusedNewsSearchRequest, buildTopicFeed, communityPlatforms, createZhihuHotlist, retainZhihuTopic } from "./source-desk.js";
import type { ZhihuHotSnapshot } from "./zhihu-hotlist.js";
import {
  applySpendingPolicy,
  assertMeteredProviderAllowed,
  assertMeteredSourceAllowed,
} from "./spending-policy.js";
import {
  appendWorkflowNotification,
  markAllWorkflowNotificationsRead,
  markWorkflowNotificationRead,
} from "./notifications.js";
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
import type { AssignmentMode, ContentPackage, EditorialIntent } from "./product-types.js";

import { homeLayoutFor, parseHomeLayout } from "./home-layout.js";
import { retryPackageJob } from "./job-recovery.js";
import { registerSourceHttpRoutes1, registerSourceHttpRoutes2, registerSourceHttpRoutes3 } from "./source-http-routes.js";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, deliveryRoute, validDateInput, sourceKinds, sourceRoles, draftableAssignmentModes, storyEventTypes, routeParam, decodedHeader, decodedHeaderList, storeNewMaterial, respondMaterialError, publisherPreflightFor, decodeHeader, parseScreenshotCropHeader, parseImagePostLinesHeader } from "./http-route-support.js";
import { registerStoryHttpRoutes1, registerStoryHttpRoutes2, registerStoryHttpRoutes3, registerStoryHttpRoutes4, registerStoryHttpRoutes5, registerStoryHttpRoutes6, registerStoryHttpRoutes7 } from "./story-http-routes.js";
import { registerPackageHttpRoutes1, registerPackageHttpRoutes2 } from "./package-http-routes.js";
import { registerEditorialHttpRoutes1, registerEditorialHttpRoutes2 } from "./editorial-http-routes.js";

const app = express();
const zhihuHotlist = createZhihuHotlist({
  load: async () => (await getLocalDatabase()).getSourceSnapshot<ZhihuHotSnapshot>("source-desk:zhihu-hot:v1")?.page,
  save: async (page) => { (await getLocalDatabase()).saveSourceSnapshot({ urlKey: "source-desk:zhihu-hot:v1",
    requestedUrl: "https://www.zhihu.com/hot", canonicalUrl: "https://www.zhihu.com/hot", page, capturedAt: page.attemptedAt }); },
});
app.disable("x-powered-by");
const port = Number(process.env.AI_NEWS_DESK_PORT || 4317);
const deliveryDesk = createDeliveryDesk();
const wechatDelivery = createWeChatDelivery({
  deliveryDesk, read: readState, update: updateState,
  gateway: async (appId, signal) => createWeChatHttpGateway({ appId, appSecret: await getWeChatAppSecret(), signal }),
  review: async draft => reviewDraftQuality(draft, await getLocalDatabase()),
  loadImage: loadWeChatPlacementImage,
});
const portableArchiveImportConfirmations = createPortableArchiveImportConfirmationDesk();

app.use(createLocalSecurityMiddleware(port, { publisherExtensionToken: () => extensionPublisherBridge.token }));
app.use((request, response, next) => {
  const mutating = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method);
  if (mutating && request.path !== "/api/data/archive/import" && isPortableArchiveImportActive()) {
    response.status(503).json({ error: "完整归档正在导入，工作台已暂时进入只读维护状态" });
    return;
  }
  next();
});
const defaultJsonBody = express.json({ limit: "2mb" });
app.use((request, response, next) => {
  // A complete state backup can grow beyond normal command payloads. Keep the
  // larger allowance isolated to the restore endpoint instead of raising the
  // body limit for every API call.
  if (request.path === "/api/data/restore"
    || request.path === "/api/data/archive/inspect"
    || request.path === "/api/data/archive/import") next();
  else defaultJsonBody(request, response, next);
});
app.use("/media", express.static(workflowMediaRoot, { fallthrough: false }));
app.use("/materials", express.static(workflowMaterialsRoot, { fallthrough: false }));

























registerSocialDeliveryRoutes(app);
registerCommunityRoutes(app);
registerDraftLibraryRoutes(app);
registerAiStyleScoreRoutes(app);

const httpRouteRuntime: HttpRouteRuntime = {
  get readState() { return readState; },
  get readStateProjection() { return readStateProjection; },
  get updateState() { return updateState; },
  get replaceState() { return replaceState; },
  get getLocalDatabase() { return getLocalDatabase; },
  get deliveryDesk() { return deliveryDesk; },
  get zhihuHotlist() { return zhihuHotlist; },
  get wechatDelivery() { return wechatDelivery; },
  get portableArchiveImportConfirmations() { return portableArchiveImportConfirmations; },
  get backfillTodayTitles() { return backfillTodayTitles; },
  get xiaoheiheDelivery() { return xiaoheiheDelivery; },
};

app.get(
  "/api/bootstrap",
  asyncRoute(async (_request, response) => {
    const state = await readStateProjection(bootstrapView);
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
    const state = await readState();
    response.json({
      notifications: state.notifications.slice(0, 80),
      notificationsMuted: state.settings.notificationsMuted,
      activeRunCount: state.runs.filter((run) => ["queued", "collecting", "scoring", "extracting", "generating"].includes(run.status)).length,
    });
  }),
);

app.get("/api/runs/:runId/diagnostics", asyncRoute(async (request, response) => {
  const diagnostics = await readStateProjection(state => runDiagnosticsView(state, routeParam(request.params.runId)));
  if (!diagnostics) { response.status(404).json({ error: "运行记录不存在" }); return; }
  response.json(diagnostics);
}));

app.get(
  "/api/drafts/overview",
  asyncRoute(async (_request, response) => {
    response.json(buildDraftOverview((await readState()).drafts));
  }),
);

registerStoryHttpRoutes1(app, httpRouteRuntime);
app.post("/api/product/jobs/:jobId/retry", asyncRoute(async (request, response) => {
  const database = await getLocalDatabase();
  const oldJob = database.getJob(routeParam(request.params.jobId));
  if (!oldJob || !["build-content-package", "draft-from-package", "draft-from-editorial-intake", "draft-from-intake-review", "explain-story", "hydrate-story-assets", "supplement-story-evidence"].includes(oldJob.type) || oldJob.status !== "failed") { response.status(409).json({ error: "这个任务不能从这里重试" }); return; }
  const storyId = oldJob.payload && typeof oldJob.payload === "object" && "storyId" in oldJob.payload ? String(oldJob.payload.storyId) : "";
  const story = storyById(await readState(), storyId);
  if (story) await updateState((state) => retainStoryForWriting(state, storyId));
  response.status(202).json(retryPackageJob(database, oldJob.id, story?.title));
}));

registerSourceHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes2(app, httpRouteRuntime);

const backfillTodayTitles = createTodayTitleBackfill({
  readView: readTodayView,
  enrich: enrichCandidateBriefings,
});
// Page fallback and collection jobs reuse the same bounded analysis operation.
registerStoryHttpRoutes3(app, httpRouteRuntime);

registerPackageHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes4(app, httpRouteRuntime);

app.post(
  "/api/stories/:storyId/events",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const type = typeof request.body?.type === "string" ? request.body.type : "";
    if (!storyEventTypes.has(type)) {
      response.status(400).json({ error: "不支持的 Story 行为事件" });
      return;
    }
    const currentStory = storyById(await readState(), storyId);
    if (!currentStory) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    if (type === "interested" || type === "not_interested") {
      await updateState((state) => {
        const story = storyById(state, storyId);
        if (!story) return;
        const primary = story.signals.find((signal) => !signal.isCommunity) ?? story.signals[0];
        if (primary) {
          recordCandidateFeedback(state, {
            runId: primary.runId,
            candidateId: primary.candidateId,
            kind: type,
          });
        }
        for (const signal of story.signals) {
          const candidate = state.runs.find((run) => run.id === signal.runId)
            ?.candidates.find((entry) => entry.id === signal.candidateId);
          if (candidate) candidate.userFeedback = type;
        }
        reapplyPersonalizationToRuns(state);
      });
    }
    const database = await getLocalDatabase();
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim().slice(0, 500) : undefined;
    const payload = request.body?.payload && typeof request.body.payload === "object"
      ? request.body.payload as Record<string, unknown>
      : undefined;
    const event = database.recordFeedback({ type, subjectType: "story", subjectId: storyId, reason, payload });
    database.recordWorkflowEvent({ type: `story.${type}`, subjectType: "story", subjectId: storyId, payload });
    response.status(201).json({ event, story: storyById(await readState(), storyId) });
  }),
);

app.delete(
  "/api/stories/:storyId/feedback",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const restored = await updateState((state) => {
      const story = storyById(state, storyId);
      if (!story) return undefined;
      for (const signal of story.signals) restoreCandidateFeedback(state, signal.candidateId);
      reapplyPersonalizationToRuns(state);
      return storyById(state, storyId);
    });
    if (!restored) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    const database = await getLocalDatabase();
    const event = database.recordFeedback({ type: "feedback_restored", subjectType: "story", subjectId: storyId });
    database.recordWorkflowEvent({ type: "story.feedback_restored", subjectType: "story", subjectId: storyId });
    response.json({ event, story: restored });
  }),
);

registerStoryHttpRoutes5(app, httpRouteRuntime);

registerPackageHttpRoutes2(app, httpRouteRuntime);

app.get(
  "/api/product/jobs",
  asyncRoute(async (request, response) => {
    const limit = Number(request.query.limit ?? 100);
    response.json((await getLocalDatabase()).listJobs(Number.isFinite(limit) ? limit : 100));
  }),
);

app.get(
  "/api/product/jobs/:jobId",
  asyncRoute(async (request, response) => {
    const job = (await getLocalDatabase()).getJob(routeParam(request.params.jobId));
    if (!job) {
      response.status(404).json({ error: "任务不存在" });
      return;
    }
    response.json(job);
  }),
);

app.get(
  "/api/product/feedback",
  asyncRoute(async (request, response) => {
    const limit = Number(request.query.limit ?? 100);
    response.json((await getLocalDatabase()).listFeedback(undefined, undefined, Number.isFinite(limit) ? limit : 100));
  }),
);

app.get(
  "/api/events",
  asyncRoute(async (request, response) => {
    response.status(200);
    response.setHeader("content-type", "text/event-stream; charset=utf-8");
    response.setHeader("cache-control", "no-cache, no-transform");
    response.setHeader("connection", "keep-alive");
    response.flushHeaders();
    const database = await getLocalDatabase();
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

app.get(
  "/api/editorial-system",
  asyncRoute(async (_request, response) => {
    const database = await getLocalDatabase();
    response.json({
      ...buildEditorialSystemView(await readState()),
      writingMemories: writingMemoryView(database, (await readState()).settings.writingMemoryEnabled),
    });
  }),
);

app.post("/api/editorial-memories/preview", asyncRoute(async (request,response) => {
  const state=await readState();
  const title=typeof request.body?.title === "string" ? request.body.title.slice(0,500) : "";
  const intent=["news","community","source"].includes(request.body?.intent) ? request.body.intent : "news";
  response.json(writingPreferencePlan(await getLocalDatabase(),{enabled:state.settings.writingMemoryEnabled,title,intent}));
}));

app.patch(
  "/api/editorial-system/profile",
  asyncRoute(async (request, response) => {
    const patch = (request.body ?? {}) as Partial<EditorialProfile>;
    const view = await updateState((state) => {
      updateEditorialProfile(state, patch);
      return buildEditorialSystemView(state);
    });
    response.json({ ...view, writingMemories: writingMemoryView(await getLocalDatabase(), (await readState()).settings.writingMemoryEnabled) });
  }),
);

app.post(
  "/api/editorial-system/suggestions/:suggestionId/decision",
  asyncRoute(async (request, response) => {
    const suggestionId = Array.isArray(request.params.suggestionId)
      ? request.params.suggestionId[0]
      : request.params.suggestionId;
    const decision = request.body?.decision;
    if (decision !== "adopted" && decision !== "ignored") {
      response.status(400).json({ error: "请选择采纳或忽略" });
      return;
    }
    const view = await updateState((state) => {
      decideEditorialSuggestion(state, suggestionId, decision);
      return buildEditorialSystemView(state);
    });
    response.json({ ...view, writingMemories: writingMemoryView(await getLocalDatabase(), (await readState()).settings.writingMemoryEnabled) });
  }),
);

app.patch(
  "/api/editorial-memories/:memoryId",
  asyncRoute(async (request, response) => {
    if (typeof request.body?.enabled !== "boolean") {
      response.status(400).json({ error: "enabled 必须是布尔值" });
      return;
    }
    const database = await getLocalDatabase();
    const memory = database.setEditorialMemoryEnabled(routeParam(request.params.memoryId), request.body.enabled);
    if (!memory) {
      response.status(404).json({ error: "编辑记忆不存在" });
      return;
    }
    database.recordWorkflowEvent({
      type: request.body.enabled ? "writing_memory.enabled" : "writing_memory.disabled",
      subjectType: "writing-memory",
      subjectId: memory.id,
    });
    response.json(writingMemoryView(database, (await readState()).settings.writingMemoryEnabled));
  }),
);

app.delete(
  "/api/editorial-memories/:memoryId",
  asyncRoute(async (request, response) => {
    const database = await getLocalDatabase();
    const memoryId = routeParam(request.params.memoryId);
    if (!database.deleteEditorialMemory(memoryId)) {
      response.status(404).json({ error: "编辑记忆不存在" });
      return;
    }
    database.recordWorkflowEvent({
      type: "writing_memory.deleted",
      subjectType: "writing-memory",
      subjectId: memoryId,
    });
    response.json(writingMemoryView(database, (await readState()).settings.writingMemoryEnabled));
  }),
);

app.patch(
  "/api/notifications/:notificationId/read",
  asyncRoute(async (request, response) => {
    const notificationId = Array.isArray(request.params.notificationId)
      ? request.params.notificationId[0]
      : request.params.notificationId;
    const result = await updateState((state) => ({
      notification: markWorkflowNotificationRead(state, notificationId),
      notifications: state.notifications,
    }));
    if (!result.notification) {
      response.status(404).json({ error: "通知不存在" });
      return;
    }
    response.json(result.notifications);
  }),
);

app.post(
  "/api/notifications/read-all",
  asyncRoute(async (_request, response) => {
    const notifications = await updateState((state) => {
      markAllWorkflowNotificationsRead(state);
      return state.notifications;
    });
    response.json(notifications);
  }),
);

app.get(
  "/api/data/export",
  asyncRoute(async (_request, response) => {
    const backup = createWorkflowBackup(await readState());
    const date = backup.exportedAt.slice(0, 10);
    response.setHeader("content-disposition", `attachment; filename=ai-news-desk-${date}.json`);
    response.json(backup);
  }),
);

app.get(
  "/api/data/archive",
  asyncRoute(async (_request, response) => {
    const database = await getLocalDatabase();
    const archive = await createPortableWorkflowArchive({
      workflowRoot,
      database,
      state: await readState(),
    });
    database.recordWorkflowEvent({
      type: "backup.portable_created",
      subjectType: "backup",
      subjectId: archive.fileName,
      payload: { fileCount: archive.manifest.files.length, stateChecksum: archive.manifest.stateChecksum },
    });
    response.setHeader("content-disposition", `attachment; filename=${archive.fileName}`);
    // Express defaults to hiding files below a dot-prefixed path component.
    // The exact, server-created archive lives below `.workflow/backups`, so
    // allow that trusted path explicitly instead of returning a misleading 404.
    response.sendFile(archive.archivePath, { dotfiles: "allow" });
  }),
);

app.post(
  "/api/data/archive/inspect",
  asyncRoute(async (request, response) => {
    const contentType = request.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
    if (!contentType || !["application/gzip", "application/x-gzip", "application/octet-stream"].includes(contentType)) {
      response.status(415).json({ error: "请选择 .tar.gz 格式的完整归档进行预检" });
      return;
    }
    try {
      const preview = await previewPortableArchiveUpload(request, { windowsWorkflowRoot: workflowRoot });
      const confirmation = portableArchiveImportConfirmations.issue({
        archiveSha256: preview.archiveSha256,
        workspaceChecksum: checksumForState(await readState()),
      });
      response.json({ ...preview, confirmationToken: confirmation.token, confirmationExpiresAt: confirmation.expiresAt });
    } catch (error) {
      if (error instanceof PortableArchiveUploadError || error instanceof PortableArchiveInspectionError) {
        const tooLarge = error.code === "upload-too-large" || error.code === "archive-too-large";
        response.status(tooLarge ? 413 : 400).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  }),
);

app.post(
  "/api/data/archive/import",
  asyncRoute(async (request, response) => {
    const contentType = request.get("content-type")?.split(";", 1)[0]?.trim().toLocaleLowerCase("en-US");
    if (!contentType || !["application/gzip", "application/x-gzip", "application/octet-stream"].includes(contentType)) {
      response.status(415).json({ error: "请选择刚刚通过预检的 .tar.gz 完整归档" });
      return;
    }
    const confirmationToken = request.get("x-archive-confirmation")?.trim();
    if (!confirmationToken) {
      response.status(409).json({ error: "请先重新预检归档并明确确认覆盖导入" });
      return;
    }
    try {
      const result = await withPortableArchiveUpload(
        request,
        { windowsWorkflowRoot: workflowRoot },
        (archivePath) => runStorageExclusive(({ database, replaceDatabaseSnapshot }) => importPortableArchive({
          archivePath,
          workflowRoot,
          database,
          replaceDatabaseSnapshot,
          confirmArchive: async (archiveSha256) => portableArchiveImportConfirmations.claim(
            confirmationToken,
            { archiveSha256, workspaceChecksum: checksumForState(database.readState()) },
          ),
        })),
      );
      response.json({ ok: true, ...result });
    } catch (error) {
      if (error instanceof PortableArchiveUploadError || error instanceof PortableArchiveInspectionError
        || error instanceof PortableArchiveImportConfirmationError || error instanceof PortableArchiveImportError) {
        const tooLarge = error.code === "upload-too-large" || error.code === "archive-too-large";
        const conflict = error instanceof PortableArchiveImportConfirmationError || error instanceof PortableArchiveImportError;
        response.status(tooLarge ? 413 : conflict ? 409 : 400).json({ error: error.message, code: error.code });
        return;
      }
      throw error;
    }
  }),
);

app.get(
  "/api/data/storage",
  asyncRoute(async (_request, response) => {
    response.json(await storageUsageFor(workflowRoot));
  }),
);

app.post(
  "/api/data/restore",
  express.json({ limit: "25mb" }),
  asyncRoute(async (request, response) => {
    const verified = verifyWorkflowBackup(request.body);
    const database = await getLocalDatabase();
    await createPortableWorkflowArchive({
      workflowRoot,
      database,
      state: await readState(),
    });
    const restored = await replaceState(verified.state);
    database.recordWorkflowEvent({
      type: "backup.restored",
      subjectType: "backup",
      subjectId: verified.checksum,
      payload: { stateVersion: restored.version },
    });
    response.json({
      ok: true,
      restoredAt: new Date().toISOString(),
      stateVersion: restored.version,
      counts: {
        sources: restored.sources.length,
        drafts: restored.drafts.length,
        runs: restored.runs.length,
        materials: restored.materials.length,
      },
    });
  }),
);

// Lightweight identity probe for the local desktop launcher; never exposes credentials.
app.get("/api/desktop/status", (_request, response) => {
  response.json({ app: "ai-news-desk", projectPath: process.cwd(), workflowRoot, pid: process.pid });
});

app.get(
  "/api/health",
  asyncRoute(async (_request, response) => {
    const state = await readState();
    const [codex, publisher] = await Promise.all([
      codexStatus(),
      publisherStatus(state.settings),
    ]);
    response.json({ ok: true, codex, publisher, horizon: { ok: true, detail: "本地 Horizon 已接入" } });
  }),
);

registerStoryHttpRoutes6(app, httpRouteRuntime);

registerSourceHttpRoutes2(app, httpRouteRuntime);

app.patch(
  "/api/settings",
  asyncRoute(async (request, response) => {
    const allowed = request.body as Partial<Settings>;
    if (allowed.homeLayout !== undefined) {
      try { allowed.homeLayout = parseHomeLayout(allowed.homeLayout); }
      catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "栏目设置无效" }); return; }
    }
    if (allowed.spendingPolicy !== undefined
      && allowed.spendingPolicy !== "zero-cost"
      && allowed.spendingPolicy !== "allow-metered") {
      response.status(400).json({ error: "费用策略不正确" });
      return;
    }
    const settings = await updateState((state) => {
      const requestedSpendingPolicy = allowed.spendingPolicy;
      const next = {
        ...state.settings,
        ...allowed,
        // Publication history is write-protected and only changes through the
        // explicit "published successfully" confirmation endpoint.
        socialBridge: state.settings.socialBridge,
        recentTopics: state.settings.recentTopics,
        recentCommunities: state.settings.recentCommunities,
      };
      // Keep scheduled collection aligned with Today's 48-hour editorial
      // window so a late daily run cannot create an artificial blind spot.
      if (allowed.homeLayout !== undefined) next.homeLayout = parseHomeLayout(allowed.homeLayout);
      next.windowHours = 48;
      next.officialMonitorEnabled = next.officialMonitorEnabled !== false;
      next.officialMonitorIntervalMinutes = officialPollInterval(next.officialMonitorIntervalMinutes);
      next.lastOfficialPollAt = state.settings.lastOfficialPollAt;
      next.collectionTopics = normalizeTopicIds(next.collectionTopics);
      next.imageLimit = Math.max(0, Math.min(12, Number(next.imageLimit) || 0));
      next.autoGenerateCount = Math.max(1, Math.min(10, Number(next.autoGenerateCount) || 3));
      next.publisherMode = next.publisherMode === "cdp" ? "cdp" : "chrome-extension";
      next.personalizationEnabled = next.personalizationEnabled !== false;
      next.recommendationMode = next.recommendationMode === "balanced" ? "balanced" : "focused";
      for (const key of ["editorialProfileEnabled", "writingMemoryEnabled", "inlineCompletionEnabled"] as const) {
        next[key] = next[key] !== false;
      }
      next.notificationsMuted = next.notificationsMuted !== false;
      state.settings = next;
      if (requestedSpendingPolicy) applySpendingPolicy(state, requestedSpendingPolicy);
      if (typeof allowed.personalizationEnabled === "boolean") reapplyPersonalizationToRuns(state);
      return state.settings;
    });
    response.json(settings);
  }),
);

app.patch(
  "/api/wechat/settings",
  asyncRoute(async (request, response) => {
    const body = (request.body ?? {}) as {
      accountName?: string;
      appId?: string;
      originalId?: string;
      defaultAuthor?: string;
      appSecret?: string;
      clearAppSecret?: boolean;
    };
    const current = await readState();
    const accountName = typeof body.accountName === "string"
      ? body.accountName.trim().slice(0, 80)
      : current.settings.wechat.accountName;
    const appId = typeof body.appId === "string"
      ? body.appId.trim().slice(0, 80)
      : current.settings.wechat.appId;
    const defaultAuthor = typeof body.defaultAuthor === "string"
      ? body.defaultAuthor.trim().slice(0, 16)
      : current.settings.wechat.defaultAuthor;
    const originalId = typeof body.originalId === "string"
      ? body.originalId.trim()
      : current.settings.wechat.originalId ?? "";
    if (originalId && !/^gh_[a-zA-Z0-9]{6,40}$/.test(originalId)) {
      response.status(400).json({ error: "公众号原始 ID 格式不正确，通常以 gh_ 开头；不要填写 AppID 或密钥" });
      return;
    }
    if (appId && !/^wx[0-9a-zA-Z]{8,}$/.test(appId)) {
      response.status(400).json({ error: "微信公众号 AppID 格式不正确，通常以 wx 开头" });
      return;
    }
    if (typeof body.appSecret === "string" && body.appSecret.trim().length < 16) {
      response.status(400).json({ error: "微信公众号 AppSecret 长度不正确" });
      return;
    }
    let secretHint: string | undefined;
    if (typeof body.appSecret === "string" && body.appSecret.trim()) {
      secretHint = await setWeChatAppSecret(body.appSecret);
    } else if (body.clearAppSecret) {
      await deleteWeChatAppSecret();
    }
    const settings = await updateState((state) => {
      state.settings.wechat = {
        accountName,
        appId,
        originalId,
        defaultAuthor,
        appSecretConfigured: secretHint
          ? true
          : body.clearAppSecret
            ? false
            : state.settings.wechat.appSecretConfigured,
        ...(secretHint
          ? { appSecretHint: secretHint }
          : body.clearAppSecret
            ? {}
            : state.settings.wechat.appSecretHint
              ? { appSecretHint: state.settings.wechat.appSecretHint }
              : {}),
      };
      return state.settings.wechat;
    });
    response.json(settings);
  }),
);

app.post(
  "/api/wechat/test",
  asyncRoute(async (_request, response) => {
    const state = await readState();
    if (!state.settings.wechat.appId || !state.settings.wechat.appSecretConfigured) {
      response.status(400).json({ error: "请先保存微信公众号 AppID 和 AppSecret" });
      return;
    }
    const gateway = createWeChatHttpGateway({
      appId: state.settings.wechat.appId,
      appSecret: await getWeChatAppSecret(),
    });
    response.json(await createWeChatDraftDesk({ gateway }).checkConnection());
  }),
);

app.patch(
  "/api/ai/providers/:providerId",
  asyncRoute(async (request, response) => {
    const providerId = Array.isArray(request.params.providerId)
      ? request.params.providerId[0]
      : request.params.providerId;
    const current = await readState();
    const existing = current.aiSettings.providers.find((provider) => provider.id === providerId);
    if (!existing) {
      response.status(404).json({ error: "AI 厂商不存在" });
      return;
    }
    const body = request.body as Partial<AiProviderConfig> & {
      apiKey?: string;
      clearApiKey?: boolean;
      active?: boolean;
    };
    if (body.active) assertMeteredProviderAllowed(current, existing);
    let keyHint: string | undefined;
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      keyHint = await setProviderApiKey(providerId, body.apiKey);
    } else if (body.clearApiKey && existing.kind !== "codex-cli") {
      await deleteProviderApiKey(providerId);
    }
    const aiSettings = await updateState((state) => {
      const provider = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("AI 厂商不存在");
      const nextModel = typeof body.model === "string" ? body.model.trim().slice(0, 120) : provider.model;
      const nextInlineCompletionModel = typeof body.inlineCompletionModel === "string"
        ? body.inlineCompletionModel.trim().slice(0, 120)
        : provider.inlineCompletionModel;
      const nextVisionModel = typeof body.visionModel === "string"
        ? body.visionModel.trim().slice(0, 120)
        : provider.visionModel;
      const nextBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().slice(0, 500) : provider.baseUrl;
      const connectionConfigurationChanged = nextModel !== provider.model
        || nextInlineCompletionModel !== provider.inlineCompletionModel
        || nextVisionModel !== provider.visionModel
        || nextBaseUrl !== provider.baseUrl
        || Boolean(keyHint)
        || Boolean(body.clearApiKey);
      provider.model = nextModel;
      provider.inlineCompletionModel = nextInlineCompletionModel;
      provider.visionModel = nextVisionModel;
      provider.baseUrl = nextBaseUrl;
      if (keyHint) {
        provider.apiKeyConfigured = true;
        provider.apiKeyHint = keyHint;
      }
      if (body.clearApiKey && provider.kind !== "codex-cli") {
        provider.apiKeyConfigured = false;
        provider.apiKeyHint = undefined;
        if (state.aiSettings.activeProviderId === provider.id) state.aiSettings.activeProviderId = "codex-cli";
        if (state.aiSettings.analysisProviderId === provider.id) state.aiSettings.analysisProviderId = "codex-cli";
        if (state.aiSettings.optimizationProviderId === provider.id) state.aiSettings.optimizationProviderId = "codex-cli";
      }
      if (body.active) {
        if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
          throw new Error("请先配置这个厂商的 API Key");
        }
        if (!provider.model) throw new Error("请先填写模型名称");
        if (provider.kind === "openai-compatible" && !provider.baseUrl) throw new Error("请先填写 API Base URL");
        state.aiSettings.activeProviderId = provider.id;
      }
      if (connectionConfigurationChanged) delete state.aiSettings.latestProviderHealth[provider.id];
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

app.post(
  "/api/ai/providers/:providerId/test",
  asyncRoute(async (request, response) => {
    const providerId = Array.isArray(request.params.providerId)
      ? request.params.providerId[0]
      : request.params.providerId;
    const current = await readState();
    const provider = current.aiSettings.providers.find((entry) => entry.id === providerId);
    if (!provider) {
      response.status(404).json({ error: "AI 厂商不存在" });
      return;
    }

    assertMeteredProviderAllowed(current, provider);

    const result = await probeProviderConnection(provider);
    const aiSettings = await updateState((state) => {
      const target = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!target) return undefined;
      state.aiSettings.latestProviderHealth[providerId] = result;
      return state.aiSettings;
    });
    if (!aiSettings) response.status(404).json({ error: "AI 厂商已被删除" });
    else response.json({ result, aiSettings });
  }),
);

app.patch(
  "/api/ai/agent-roles",
  asyncRoute(async (request, response) => {
    const role = request.body?.role as ArticleAgentRole;
    const providerId = typeof request.body?.providerId === "string" ? request.body.providerId : "";
    if (!(["analysis", "optimization"] as string[]).includes(role) || !providerId) {
      response.status(400).json({ error: "文章 Agent 角色或模型不正确" });
      return;
    }
    const aiSettings = await updateState((state) => {
      const provider = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("AI 厂商不存在");
      assertMeteredProviderAllowed(state, provider);
      if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
        throw new Error("请先配置这个厂商的 API Key");
      }
      if (!provider.model) throw new Error("请先填写模型名称");
      if (provider.kind === "openai-compatible" && !provider.baseUrl) {
        throw new Error("请先填写 API Base URL");
      }
      if (role === "analysis") state.aiSettings.analysisProviderId = providerId;
      else state.aiSettings.optimizationProviderId = providerId;
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

app.patch(
  "/api/ai/writing-review",
  asyncRoute(async (request, response) => {
    const mode = request.body?.mode;
    if (!["auto", "minimal", "voice", "off"].includes(mode)) {
      response.status(400).json({ error: "写作审校模式不正确" });
      return;
    }
    const aiSettings = await updateState((state) => {
      state.aiSettings.writingReviewMode = mode;
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

app.patch(
  "/api/ai/skills/:skillId",
  asyncRoute(async (request, response) => {
    const skills = await updateState((state) => {
      const skill = state.aiSettings.skills.find((entry) => entry.id === request.params.skillId);
      if (!skill) return undefined;
      if (request.body.enabled !== undefined) skill.enabled = Boolean(request.body.enabled);
      return state.aiSettings.skills;
    });
    if (!skills) response.status(404).json({ error: "Skill 不存在" });
    else response.json(skills);
  }),
);

app.post(
  "/api/ai/skills/import",
  asyncRoute(async (request, response) => {
    const rawPath = typeof request.body?.path === "string" ? request.body.path.trim() : "";
    if (!rawPath) {
      response.status(400).json({ error: "请填写 Skill 文件夹或 SKILL.md 路径" });
      return;
    }
    const imported = await importArticleSkill(rawPath);
    const skills = await updateState((state) => {
      const index = state.aiSettings.skills.findIndex((skill) => skill.id === imported.id);
      if (index >= 0) state.aiSettings.skills[index] = { ...imported, enabled: state.aiSettings.skills[index].enabled };
      else state.aiSettings.skills.push(imported);
      return state.aiSettings.skills;
    });
    response.status(201).json(skills);
  }),
);

app.post(
  "/api/materials",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "10mb" }),
  asyncRoute(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: "没有收到图片文件" });
      return;
    }
    try {
      const state = await readState();
      const material = await saveUploadedMaterial(
        request.body,
        (request.get("content-type") || "").split(";")[0],
        {
          title: request.get("x-material-title"),
          attribution: request.get("x-material-attribution"),
          sourceUrl: decodedHeader(request, "x-material-source-url"),
          tags: decodedHeaderList(request, "x-material-tags"),
          rights: request.get("x-material-rights") as ImageMaterial["rights"],
          evidenceNote: request.get("x-material-evidence-note"),
          evidencePath: decodedHeader(request, "x-material-evidence-path"),
          licenseId: request.get("x-material-license-id"),
          licenseUrl: decodedHeader(request, "x-material-license-url"),
          modificationNote: request.get("x-material-modification-note"),
          allowedPlatforms: decodedHeaderList(request, "x-material-allowed-platforms"),
          expiresAt: decodedHeader(request, "x-material-expires-at"),
          entityTags: decodedHeaderList(request, "x-material-entity-tags"),
        },
        request.get("x-file-name"),
        state.materials,
      );
      await storeNewMaterial(material);
      response.status(201).json(material);
    } catch (error) {
      if (!respondMaterialError(response, error)) throw error;
    }
  }),
);

app.post(
  "/api/materials/from-url",
  asyncRoute(async (request, response) => {
    const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!url) {
      response.status(400).json({ error: "请填写图片直链" });
      return;
    }
    try {
      const state = await readState();
      const strings = (value: unknown) => Array.isArray(value)
        ? value.filter((item): item is string => typeof item === "string")
        : [];
      const material = await importMaterialFromUrl(url, {
        title: typeof request.body?.title === "string" ? request.body.title : undefined,
        attribution: typeof request.body?.attribution === "string" ? request.body.attribution : undefined,
        sourceUrl: typeof request.body?.sourceUrl === "string" ? request.body.sourceUrl : url,
        tags: strings(request.body?.tags),
        rights: request.body?.rights,
        evidenceNote: typeof request.body?.evidenceNote === "string" ? request.body.evidenceNote : undefined,
        evidencePath: typeof request.body?.evidencePath === "string" ? request.body.evidencePath : undefined,
        licenseId: typeof request.body?.licenseId === "string" ? request.body.licenseId : undefined,
        licenseUrl: typeof request.body?.licenseUrl === "string" ? request.body.licenseUrl : undefined,
        modificationNote: typeof request.body?.modificationNote === "string" ? request.body.modificationNote : undefined,
        allowedPlatforms: strings(request.body?.allowedPlatforms),
        expiresAt: typeof request.body?.expiresAt === "string" ? request.body.expiresAt : undefined,
        entityTags: strings(request.body?.entityTags),
      }, state.materials);
      await storeNewMaterial(material);
      response.status(201).json(material);
    } catch (error) {
      if (!respondMaterialError(response, error)) throw error;
    }
  }),
);

app.delete(
  "/api/materials/:materialId",
  asyncRoute(async (request, response) => {
    const removed = await updateState((state) => {
      const index = state.materials.findIndex((material) => material.id === request.params.materialId);
      if (index < 0) return undefined;
      const material = state.materials.splice(index, 1)[0];
      if (material?.seedAssetId && !state.materialSeedTombstones.includes(material.seedAssetId)) {
        state.materialSeedTombstones.push(material.seedAssetId);
        state.materialSeedTombstones = state.materialSeedTombstones.slice(-1_000);
      }
      return material;
    });
    if (!removed) {
      response.status(404).json({ error: "图片素材不存在" });
      return;
    }
    await removeMaterialFile(removed);
    response.status(204).end();
  }),
);

registerSourceHttpRoutes3(app, httpRouteRuntime);

registerStoryHttpRoutes7(app, httpRouteRuntime);

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
      const spendingState = await readState();
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
    const state = await readState();
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
    const state = await readState();
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
    const candidate = await updateState((state) => {
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

app.post(
  "/api/runs/:runId/candidates/:candidateId/feedback",
  asyncRoute(async (request, response) => {
    const kind = request.body?.kind as CandidateFeedbackKind;
    if (!(["interested", "not_interested"] as CandidateFeedbackKind[]).includes(kind)) {
      response.status(400).json({ error: "候选反馈类型不正确" });
      return;
    }
    const result = await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === request.params.runId);
      const candidate = run?.candidates.find((entry) => entry.id === request.params.candidateId);
      if (!run || !candidate) return undefined;
      const feedback = recordCandidateFeedback(state, {
        runId: run.id,
        candidateId: candidate.id,
        kind,
      });
      reapplyPersonalizationToRuns(state);
      return {
        feedback,
        run: state.runs.find((entry) => entry.id === run.id),
        feedbackCount: state.candidateFeedback.length,
      };
    });
    if (!result?.feedback || !result.run) response.status(404).json({ error: "候选新闻不存在" });
    else response.json(result);
  }),
);

app.delete(
  "/api/runs/:runId/candidates/:candidateId/feedback",
  asyncRoute(async (request, response) => {
    const result = await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === request.params.runId);
      const candidate = run?.candidates.find((entry) => entry.id === request.params.candidateId);
      if (!run || !candidate) return undefined;
      restoreCandidateFeedback(state, candidate.id);
      reapplyPersonalizationToRuns(state);
      return {
        run: state.runs.find((entry) => entry.id === run.id),
        feedbackCount: state.candidateFeedback.length,
      };
    });
    if (!result?.run) response.status(404).json({ error: "候选新闻不存在" });
    else response.json(result);
  }),
);

app.delete(
  "/api/candidate-feedback",
  asyncRoute(async (_request, response) => {
    const result = await updateState((state) => {
      const cleared = clearCandidateFeedback(state);
      reapplyPersonalizationToRuns(state);
      return { cleared, feedbackCount: state.candidateFeedback.length };
    });
    response.json(result);
  }),
);

app.delete(
  "/api/runs/:runId/candidates",
  asyncRoute(async (request, response) => {
    const result = await updateState((state) => {
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

registerEditorialHttpRoutes1(app, httpRouteRuntime);







app.post(
  "/api/image-posts/from-screenshot",
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "10mb" }),
  asyncRoute(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) throw new Error("没有收到截图文件");
    const state = await readState();
    const draftId = `draft_image_post_${randomUUID().slice(0, 12)}`;
    const assets = await saveScreenshotImagePostAssets(
      draftId,
      request.body,
      request.header("content-type")?.split(";")[0].trim() || "",
      parseScreenshotCropHeader(request.header("x-image-crop")),
    );
    const draft = buildScreenshotImagePostDraft({
      ...assets,
      draftId,
      title: decodeHeader(request.header("x-image-post-title")),
      lines: parseImagePostLinesHeader(request.header("x-image-post-lines")),
      community: decodeHeader(request.header("x-image-post-community"), state.settings.community || "盒友杂谈"),
      // Topics are deliberately manual/history-only. The screenshot workflow
      // never invents tags just to make a test look complete.
      topics: [],
      sourceExcerpt: decodeHeader(request.header("x-source-excerpt"), "Pay $8 to reset"),
    });
    await updateState((current) => {
      current.drafts.unshift(draft);
    });
    response.status(201).json(draft);
  }),
);

app.post("/api/drafts/:draftId/edit-observation", asyncRoute(async (request,response)=>{
  const draft=(await readState()).drafts.find(draft=>draft.id===routeParam(request.params.draftId));
  if(!draft){response.status(404).json({error:"草稿不存在"});return;}
  response.json(recordEditObservation(await getLocalDatabase(),draft,request.body));
}));
app.get("/api/drafts/:draftId/rework", asyncRoute(async (request, response) => {
  const draft = (await readState()).drafts.find(item => item.id === routeParam(request.params.draftId));
  if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
  const observations = readReworkObservations(await getLocalDatabase(), { draftId: draft.id });
  response.json({ changes: draftReworkChanges(draft), observations: summarizeReworkObservations(observations), window: observations.window });
}));
app.get("/api/source-changes", asyncRoute(async (_request, response) => {
  response.json(affectedDraftsForSourceChanges((await readState()).drafts, await getLocalDatabase()));
}));
app.get("/api/drafts/:draftId/quality-check", asyncRoute(async (request, response) => {
  const draft = (await readState()).drafts.find(item => item.id === routeParam(request.params.draftId));
  if (!draft) { response.status(404).json({error:"草稿不存在"}); return; }
  response.json(reviewDraftQuality(draft, await getLocalDatabase()));
}));
app.post("/api/drafts/:draftId/review-fact", asyncRoute(async (request, response) => {
  const database = await getLocalDatabase();
  const draft = await updateState(state => {
    const draft = state.drafts.find(item => item.id === routeParam(request.params.draftId));
    if (!draft) throw new Error("草稿不存在");
    const ids = request.body?.factIds;
    if (!Array.isArray(ids) || ids.some(id => typeof id !== "string") || !request.body?.binding) throw new Error("事实选择格式无效");
    bindReviewedParagraph(draft, database, request.body.binding, request.body.index, ids);
    draft.updatedAt = new Date(Math.max(Date.now(), Date.parse(draft.updatedAt) + 1)).toISOString();
    draft.qualityWarnings = draftQualityFindingsFor(evaluateDraftPackageQuality({ draft, contentPackage: database.getContentPackage<ContentPackage>(draft.provenance.contentPackageId!)! }));
    appendDraftRevision(state,draft,"manual"); return draft;
  });
  response.json(draft);
}));
app.post("/api/drafts/:draftId/review-source-change", asyncRoute(async (request, response) => {
  const database = await getLocalDatabase();
  const draft = await updateState(state => {
    const draft = state.drafts.find(item => item.id === routeParam(request.params.draftId));
    if (!draft) throw new Error("草稿不存在");
    const report = reviewDraftQuality(draft,database);
    const change = report.changes.find(change => change.url === request.body?.url && change.observedHash === request.body?.observedHash);
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim() : "";
    if (!change || report.binding.documentHash !== request.body?.documentHash || reason.length < 10 || reason.length > 1000) throw new Error("来源或正文已变化，或尚未填写具体核对结论（10–1000 字）");
    draft.sourceChangeReviews = [...(draft.sourceChangeReviews ?? []).filter(review => review.url !== change.url), {url: change.url, observedHash: change.observedHash, packageHash: report.binding.packageHash, documentHash: report.binding.documentHash, reason, reviewedAt:new Date().toISOString()}];
    draft.updatedAt = new Date(Math.max(Date.now(),Date.parse(draft.updatedAt)+1)).toISOString();
    appendDraftRevision(state,draft,"manual"); return draft;
  }); response.json(draft);
}));

app.get("/api/drafts/:draftId", asyncRoute(async (request, response) => {
  const draft = (await readState()).drafts.find((entry) => entry.id === routeParam(request.params.draftId));
  if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
  response.json(draft);
}));

app.post("/api/drafts/:draftId/confirm", asyncRoute(async (request, response) => {
  const database = await getLocalDatabase();
  const result = await updateState((state) => {
    const draft = state.drafts.find((entry) => entry.id === routeParam(request.params.draftId));
    if (!draft) throw new Error("草稿不存在");
    return confirmDraftInState(state, draft, String(request.body?.updatedAt ?? ""));
  });
  if (!result.reused) {
    database.recordWorkflowEvent({ type: "draft.confirmed", subjectType: "draft", subjectId: result.draft.id, payload: { confirmationId: result.draft.editorialBaseline?.confirmed?.id, revisionId: result.draft.revisionId, learningEligible: result.learningEligible } });
    if (result.learningEligible && result.before && result.after) recordDraftEdit(database, { draftId: result.draft.id, before: result.before, after: result.after, saveMode: "manual", confirmed: true, confirmationId: result.draft.editorialBaseline?.confirmed?.id, context: `${result.draft.title} ${result.draft.topics.join(" ")} ${result.draft.draftStrategy ?? ""}` });
  }
  response.json(result.draft);
}));

app.patch(
  "/api/drafts/:draftId",
  asyncRoute(async (request, response) => {
    const database = await getLocalDatabase();
    const result = await updateState((state) => {
      const target = state.drafts.find((entry) => entry.id === request.params.draftId);
      if (!target) return undefined;
      const body = request.body as Partial<ArticleDraft> & { _saveMode?: DraftSaveMode };
      if (body.updatedAt && body.updatedAt !== target.updatedAt) throw new Error("草稿已在其他窗口变化，请刷新后再保存；本地内容仍保留");
      if (!target.editorialBaseline) appendDraftRevision(state, target, "manual");
      const beforeDraft = structuredClone(target);
      const before = snapshotDraft(target);
      const saveMode: DraftSaveMode = body._saveMode === "auto" ? "auto" : "manual";
      if (body.status !== undefined) assertDraftTransition(target, body.status);
      for (const key of ["title", "paragraphs", "take", "sources", "factClaims", "uncertainties", "images", "community", "topics", "status", "contentFormat", "imagePostImageIds", "layoutTheme"] as const) {
        if (body[key] !== undefined) (target[key] as unknown) = body[key];
      }
      if (body.xiaoheiheOptions !== undefined) {
        target.xiaoheiheOptions = normalizeXiaoheiheOptions(body.xiaoheiheOptions);
      }
      target.images = target.images.map(placement => ({ ...placement, image: normalizeLegacyUserUpload(placement.image) }));
      if (body.wechatMetadata !== undefined) target.wechatMetadata = normalizeWeChatMetadata(body.wechatMetadata);
      if (body.socialMetadata !== undefined) target.socialMetadata = normalizeSocialMetadata(body.socialMetadata);
      if (body.imagePostImageIds !== undefined && (!Array.isArray(body.imagePostImageIds) || body.imagePostImageIds.some(id => typeof id !== "string" || !target.images.some(image => image.id === id)) || new Set(body.imagePostImageIds).size !== body.imagePostImageIds.length || body.imagePostImageIds.length > 18)) throw new Error("图集包含无效、重复或过多图片，请重新选择");
      if (body.topics !== undefined) {
        if (!Array.isArray(body.topics) || body.topics.some(topic => typeof topic !== "string")) throw new Error("话题格式无效");
        target.topics = normalizePublisherTopics(body.topics);
        if (target.topics.length > 5) throw new Error("最多选择 5 个话题");
      }
      if (body.xiaoheiheOptions !== undefined) reserveXiaoheiheDefaults(target, state.settings, beforeDraft);
      if (body.contentFormat !== undefined && !["article", "image-post"].includes(body.contentFormat)) throw new Error("发送形式无效");
      if (body.bodyHtml !== undefined) target.bodyHtml = sanitizeDraftHtml(body.bodyHtml);
      const contentPackage = target.provenance.contentPackageId
        ? database.getContentPackage<ContentPackage>(target.provenance.contentPackageId)
        : undefined;
      if (contentPackage) {
        target.factClaims = reconcileDraftFactEvidence(contentPackage, target.factClaims ?? []);
        target.qualityWarnings = draftQualityFindingsFor(evaluateDraftPackageQuality({
          contentPackage,
          draft: target,
        }));
      }
      const updatedAt = new Date(Math.max(Date.now(), Date.parse(beforeDraft.updatedAt) + 1)).toISOString();
      reconcileDraftPublicationAfterEdit(beforeDraft, target, updatedAt);
      target.updatedAt = updatedAt;
      if (body.aiAssistedSinceConfirmation === true) target.aiAssistedSinceConfirmation = true;
      appendDraftRevision(state, target, body.aiAssistedSinceConfirmation ? "ai" : saveMode);
      return { draft: target, before, after: snapshotDraft(target), saveMode };
    });
    if (!result) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    response.json(result.draft);
  }),
);

app.patch(
  "/api/ai/completion-provider",
  asyncRoute(async (request, response) => {
    const providerId = typeof request.body?.providerId === "string" ? request.body.providerId : "";
    if (!providerId) {
      response.status(400).json({ error: "补全模型不正确" });
      return;
    }
    const aiSettings = await updateState((state) => {
      const provider = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("AI 厂商不存在");
      assertMeteredProviderAllowed(state, provider);
      if (provider.kind !== "openai-compatible") {
        throw new Error("Tab 补全需要低延迟 API；本机 Codex 登录适合长任务，不用于逐字补全");
      }
      if (!provider.apiKeyConfigured) throw new Error(`请先配置 ${provider.name} 的 API Key`);
      if (!(provider.inlineCompletionModel || provider.model).trim()) throw new Error("请先填写补全模型名称");
      if (!provider.baseUrl) throw new Error("请先填写 API Base URL");
      state.aiSettings.completionProviderId = provider.id;
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

registerEditorialHttpRoutes2(app, httpRouteRuntime);

app.post(
  "/api/drafts/:draftId/completions",
  asyncRoute(async (request, response) => {
    const draftId = routeParam(request.params.draftId);
    const before = typeof request.body?.before === "string" ? request.body.before : "";
    const after = typeof request.body?.after === "string" ? request.body.after : "";
    if (before.length + after.length > 200_000) { response.json({ available: false, reason: "正文过长，暂不自动补全" }); return; }
    if (before.trim().length < 4) {
      response.json({ available: false, reason: "再写几个字后才会出现补全" });
      return;
    }
    const state = await readState();
    const draft = state.drafts.find((entry) => entry.id === draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const packageId = draft.provenance.contentPackageId;
    const completion = completionAvailability(state.settings, state.aiSettings);
    if (!completion.ready) {
      response.json({ available: false, reason: completion.reason });
      return;
    }
    const contentPackage = packageId
      ? (await getLocalDatabase()).getContentPackage<ContentPackage>(packageId)
      : await ensureIntakeContentPackageForDraft(draft.id);
    if (!contentPackage || contentPackage.status !== "ready") {
      response.json({ available: false, reason: "当前草稿没有可用于安全补全的素材包" });
      return;
    }
    const provider = state.aiSettings.providers.find((candidate) =>
      candidate.id === state.aiSettings.completionProviderId
      && candidate.kind === "openai-compatible");
    if (!provider) {
      response.json({ available: false, reason: "请先在 AI 设置中选择一个 Tab 补全模型" });
      return;
    }
    assertMeteredProviderAllowed(state, provider);
    if (!provider.apiKeyConfigured) {
      response.json({ available: false, reason: `请先在 AI 设置中配置 ${provider.name} 的 API Key` });
      return;
    }

    const controller = new AbortController();
    const wantsStream = String(request.header("accept") ?? "").includes("text/event-stream");
    const abort = () => controller.abort();
    const abortIfUnfinished = () => { if (!response.writableEnded) controller.abort(); };
    request.once("aborted", abort);
    response.once("close", abortIfUnfinished);
    try {
      const preferencePlan = writingPreferencePlan(await getLocalDatabase(), { enabled: state.settings.writingMemoryEnabled, title: draft.title, topics: draft.topics, intent: contentPackage.intent, mode: contentPackage.mode });
      const prompt = buildInlineCompletionPrompt({
        contentPackage,
        title: draft.title,
        before,
        after,
        factMappings: draft.factClaims,
        editorialProfile: editorialProfileForWriting(state),
        writingGuidelines: preferencePlan.selected.map(item => item.guideline),
      });
      if (wantsStream) {
        response.status(200);
        response.setHeader("content-type", "text/event-stream; charset=utf-8");
        response.setHeader("cache-control", "no-cache, no-transform");
        response.setHeader("connection", "keep-alive");
        response.flushHeaders();
        const providerMeta = {
          writingMemory: preferencePlan,
          providerName: provider.name,
          model: provider.inlineCompletionModel || provider.model,
        };
        let latestPreview = "";
        const raw = await streamInlineCompletionProvider({
          provider,
          systemPrompt: prompt.system,
          userPrompt: prompt.user,
          signal: controller.signal,
          onText: (text) => {
            if (controller.signal.aborted || response.writableEnded) return;
            const preview = prepareInlineCompletion({ raw: text, contentPackage, before, after });
            if (
              !preview.available
              || !preview.text
              || !isStableInlineCompletionPreview(preview.text)
              || preview.text === latestPreview
            ) return;
            latestPreview = preview.text;
            response.write(`event: preview\ndata: ${JSON.stringify({ text: preview.text, ...providerMeta })}\n\n`);
          },
        });
        if (!controller.signal.aborted && !response.writableEnded) {
          const final = prepareInlineCompletion({ raw, contentPackage, before, after });
          response.write(`event: final\ndata: ${JSON.stringify({ ...final, ...providerMeta })}\n\n`);
          response.end();
        }
        return;
      }
      const raw = await runInlineCompletionProvider({
        provider,
        systemPrompt: prompt.system,
        userPrompt: prompt.user,
        signal: controller.signal,
      });
      if (!controller.signal.aborted && !response.writableEnded) {
        response.json({
          ...prepareInlineCompletion({ raw, contentPackage, before, after }),
          writingMemory: preferencePlan,
          providerName: provider.name,
          model: provider.inlineCompletionModel || provider.model,
        });
      }
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      if (wantsStream && response.headersSent) {
        if (!response.writableEnded) {
          response.write(`event: final\ndata: ${JSON.stringify({ available: false, reason: "补全暂不可用，不影响继续写作" })}\n\n`);
          response.end();
        }
        return;
      }
      throw error;
    } finally {
      request.off("aborted", abort);
      response.off("close", abortIfUnfinished);
    }
  }),
);

app.get(
  "/api/drafts/:draftId/agent/threads",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    response.json(await articleAgentThreadsForDraft(draftId));
  }),
);

app.post(
  "/api/drafts/:draftId/agent/threads",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const role = request.body?.role as ArticleAgentRole;
    if (!(["analysis", "optimization"] as string[]).includes(role)) {
      response.status(400).json({ error: "请选择文章分析或文章优化 Agent" });
      return;
    }
    response.status(201).json(await createArticleAgentThread(
      draftId,
      role,
      request.body?.draft as Partial<ArticleAgentDraftInput> | undefined,
    ));
  }),
);

app.post(
  "/api/drafts/:draftId/agent/threads/:threadId/messages",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const threadId = Array.isArray(request.params.threadId)
      ? request.params.threadId[0]
      : request.params.threadId;
    const message = typeof request.body?.message === "string" ? request.body.message : "";
    if (!message.trim()) {
      response.status(400).json({ error: "请输入问题" });
      return;
    }
    response.json(await askArticleAgent(
      draftId,
      threadId,
      message,
      request.body?.draft as Partial<ArticleAgentDraftInput> | undefined,
    ));
  }),
);

app.get(
  "/api/drafts/:draftId/revisions",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const state = await readState();
    if (!state.drafts.some((draft) => draft.id === draftId)) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    response.json(revisionsForDraft(state, draftId));
  }),
);

app.post(
  "/api/drafts/:draftId/revisions/:revisionId/restore",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const revisionId = Array.isArray(request.params.revisionId)
      ? request.params.revisionId[0]
      : request.params.revisionId;
    const result = await updateState((state) => {
      const draft = state.drafts.find((entry) => entry.id === draftId);
      const revision = state.draftRevisions.find(
        (entry) => entry.id === revisionId && entry.draftId === draftId,
      );
      if (!draft || !revision) return undefined;
      restoreDraftRevision(state, draft, revision);
      return { draft, revisions: revisionsForDraft(state, draft.id) };
    });
    if (!result) response.status(404).json({ error: "草稿版本不存在" });
    else response.json(result);
  }),
);

app.post(
  "/api/drafts/:draftId/media",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "10mb" }),
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const state = await readState();
    if (!state.drafts.some((draft) => draft.id === draftId)) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: "没有收到图片文件" });
      return;
    }
    const contentType = (request.get("content-type") || "").split(";")[0];
    const placement = await saveUploadedDraftImage(
      draftId,
      request.body,
      contentType,
      request.get("x-file-name"),
      request.get("x-image-caption"),
    );
    response.status(201).json(placement);
  }),
);

app.post(
  "/api/drafts/:draftId/media-from-url",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const state = await readState();
    if (!state.drafts.some((draft) => draft.id === draftId)) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const url = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!url) {
      response.status(400).json({ error: "请填写图片地址" });
      return;
    }
    const placement = await importDraftImageFromUrl(
      draftId,
      url,
      typeof request.body?.caption === "string" ? request.body.caption : undefined,
    );
    response.status(201).json(placement);
  }),
);

app.post(
  "/api/drafts/:draftId/materials/:materialId",
  asyncRoute(async (request, response) => {
    const state = await readState();
    const draft = state.drafts.find((entry) => entry.id === request.params.draftId);
    const material = state.materials.find((entry) => entry.id === request.params.materialId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (!material) {
      response.status(404).json({ error: "图片素材不存在" });
      return;
    }
    response.status(201).json(await copyMaterialToDraft(material, draft.id));
  }),
);

app.get("/api/drafts/:draftId/delivery-status", asyncRoute(async (request, response) => {
  const state = await readState();
  const draft = state.drafts.find(item => item.id === request.params.draftId);
  if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
  const quality = reviewDraftQuality(draft, await getLocalDatabase());
  response.json({ ...primaryDeliveryStatus(draft, state.settings.wechat.appId),
    xiaoheiheNextCompanion: state.settings.xiaoheiheNextCompanion ?? "Steam",
    wechatPreflight: wechatPreflight(draft, state.settings.wechat, quality.blockers) });
}));

app.post("/api/drafts/:draftId/wechat-attempts/:attemptId/resolve", deliveryRoute(async (request, response) => {
  if (request.body?.resolution !== "not-received" || request.body?.confirmed !== true) throw new Error("请先在公众号草稿箱确认本次未收到");
  if (deliveryDesk.isBusy(String(request.params.draftId), "wechat")) throw new Error("发送仍在进行，请等待结果后核对");
  await updateState(state => {
    const draft = state.drafts.find(item => item.id === request.params.draftId);
    if (!draft) throw new Error("草稿不存在");
    resolveWeChatAttempt(draft, String(request.params.attemptId));
  });
  response.json({ ok: true });
}));

app.post(
  "/api/drafts/:draftId/wechat-sync",
  deliveryRoute(async (request, response) => {
    const state = await readState();
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const draft = state.drafts.find((entry) => entry.id === draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (!state.settings.wechat.appId || !state.settings.wechat.appSecretConfigured) {
      response.status(400).json({ error: "请先在自动化 → 平台连接中连接微信公众号" });
      return;
    }
    const result = await wechatDelivery.deliver(draftId, request.body?.updatedAt || draft.updatedAt);
    if (!result.draft) {
      response.status(409).json({ error: "同步完成，但本地草稿已被删除；请到公众号草稿箱确认" });
      return;
    }
    const database = await getLocalDatabase();
    database.recordFeedback({
      type: "synced",
      subjectType: "delivery",
      subjectId: draftId,
      payload: {
        channel: "wechat",
        mediaId: result.receipt.mediaId,
        operation: result.receipt.operation,
        contentHash: result.receipt.contentHash,
      },
    });
    database.recordWorkflowEvent({
      type: "delivery.synced",
      subjectType: "draft",
      subjectId: draftId,
      payload: {
        channel: "wechat",
        mediaId: result.receipt.mediaId,
        operation: result.receipt.operation,
        imageCount: result.receipt.imageCount,
      },
    });
    response.json(result);
  }),
);

app.get(
  "/api/drafts/:draftId/published-images/material-status",
  asyncRoute(async (request, response) => {
    const state = await readState();
    const draft = state.drafts.find((entry) => entry.id === request.params.draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const statuses = await Promise.all(draft.images.map(async (placement) => {
      const inspected = await inspectDraftImageFile(placement);
      const status = evaluatePublishedImagePromotion({
        draft,
        placement,
        existingMaterials: state.materials,
        fingerprint: inspected.fingerprint,
        localFileAvailable: inspected.available,
      });
      if (inspected.reason && !status.blockers.includes(inspected.reason)) {
        status.blockers.push(inspected.reason);
        status.status = "blocked";
        status.canSave = false;
        delete status.candidate;
      }
      return publicPublishedImagePromotionStatus(status);
    }));
    response.json({ statuses });
  }),
);

app.post(
  "/api/drafts/:draftId/images/:placementId/save-material",
  asyncRoute(async (request, response) => {
    const state = await readState();
    const draft = state.drafts.find((entry) => entry.id === request.params.draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const placement = draft.images.find((entry) => entry.id === request.params.placementId);
    if (!placement) {
      response.status(404).json({ error: "草稿图片不存在" });
      return;
    }
    const inspected = await inspectDraftImageFile(placement, true);
    const decision = evaluatePublishedImagePromotion({
      draft,
      placement,
      existingMaterials: state.materials,
      fingerprint: inspected.fingerprint,
      localFileAvailable: inspected.available,
    });
    if (inspected.reason && !decision.blockers.includes(inspected.reason)) {
      decision.blockers.push(inspected.reason);
      decision.status = "blocked";
      decision.canSave = false;
      delete decision.candidate;
    }
    if (!decision.canSave || !decision.candidate || !inspected.bytes || !inspected.contentType) {
      const publicStatus = publicPublishedImagePromotionStatus(decision);
      response.status(409).json({
        error: decision.status === "duplicate"
          ? "这张图片已经在素材库中，不会重复保存。"
          : decision.blockers.join("；") || "这张图片当前不能存入素材库。",
        status: publicStatus,
      });
      return;
    }
    const candidate = decision.candidate;
    try {
      const material = await saveMaterialBytes(
        inspected.bytes,
        inspected.contentType,
        {
          title: candidate.title,
          attribution: candidate.attribution,
          sourceUrl: candidate.sourceUrl,
          tags: candidate.entityTags,
          rights: candidate.rights,
          evidenceNote: candidate.evidence.note,
          evidencePath: candidate.evidence.path,
          licenseId: candidate.licenseId,
          licenseUrl: candidate.licenseUrl,
          modificationNote: candidate.modificationNote,
          allowedPlatforms: candidate.allowedPlatforms,
          expiresAt: candidate.expiresAt,
          entityTags: candidate.entityTags,
        },
        candidate.title || placement.caption || "已发布配图",
        placement.image.url,
        state.materials,
      );
      await storeNewMaterial(material);
      response.status(201).json({
        material,
        status: {
          ...publicPublishedImagePromotionStatus(decision),
          status: "saved",
          canSave: false,
          materialId: material.id,
        },
      });
    } catch (error) {
      if (!respondMaterialError(response, error)) throw error;
    }
  }),
);

app.get(
  "/api/publisher/status",
  asyncRoute(async (_request, response) => {
    const state = await readState();
    response.json(await publisherStatus(state.settings));
  }),
);

app.get(
  "/api/drafts/:draftId/publisher-preflight",
  deliveryRoute(async (request, response) => {
    const state = await readState();
    const draft = state.drafts.find((entry) => entry.id === request.params.draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const draftSnapshot = structuredClone(draft);
    response.json(await publisherPreflightFor(
      draftSnapshot,
      state.settings,
      publicationRevisionHash(draftSnapshot, "xiaoheihe"),
    ));
  }),
);

app.get(
  "/api/publisher/extension/bootstrap",
  asyncRoute(async (_request, response) => {
    response.json(extensionPublisherBridge.bootstrap());
  }),
);

app.post(
  "/api/publisher/extension/heartbeat",
  asyncRoute(async (request, response) => {
    const token = request.header("x-ai-news-extension-token");
    const clientId = typeof request.body?.clientId === "string" ? request.body.clientId : "";
    const version = typeof request.body?.version === "string" ? request.body.version : "";
    try {
      response.json(extensionPublisherBridge.heartbeat(token, clientId, version));
    } catch (error) {
      if (error instanceof UnsupportedExtensionVersionError) {
        response.status(409).json({
          ok: false,
          error: error.message,
          minimumVersion: MINIMUM_EXTENSION_VERSION,
        });
        return;
      }
      throw error;
    }
  }),
);

app.get(
  "/api/publisher/extension/jobs/next",
  asyncRoute(async (request, response) => {
    const token = request.header("x-ai-news-extension-token");
    const clientId = typeof request.query.clientId === "string" ? request.query.clientId : "";
    const job = extensionPublisherBridge.claim(token, clientId);
    if (!job) {
      response.status(204).end();
      return;
    }
    response.json(job);
  }),
);

app.post(
  "/api/publisher/extension/jobs/:jobId/result",
  asyncRoute(async (request, response) => {
    const token = request.header("x-ai-news-extension-token");
    const jobId = Array.isArray(request.params.jobId) ? request.params.jobId[0] : request.params.jobId;
    const clientId = typeof request.body?.clientId === "string" ? request.body.clientId : "";
    try {
      response.json(extensionPublisherBridge.complete(token, clientId, jobId, {
        pageUrl: typeof request.body?.pageUrl === "string" ? request.body.pageUrl : undefined,
        steps: Array.isArray(request.body?.steps) ? request.body.steps : [],
      }));
    } catch (error) {
      if (error instanceof ExtensionPublisherProtocolError) {
        response.status(error.status).json({ ok: false, error: error.message });
        return;
      }
      throw error;
    }
  }),
);

app.post(
  "/api/publisher/launch",
  asyncRoute(async (_request, response) => {
    const state = await readState();
    response.json(await openPublisher(state.settings));
  }),
);

const xiaoheiheDelivery = createXiaoheiheDelivery({
  deliveryDesk,
  connect: ensurePublisherConnected,
  preflight: publisherPreflightFor,
  fill: fillDraftInPublisher,
  record: (draftId, result, receipt) => updateState((current) => {
    current.publisherReceipts.unshift(receipt);
    current.publisherReceipts = current.publisherReceipts.slice(0, 100);
    const blocked = receipt.outcome === "blocked";
    const disconnected = blocked
      ? result.preflight?.blocking.some(issue => issue.code === "PREFLIGHT_TRANSPORT_DISCONNECTED")
      : receipt.checks.some(check => check.id === "transport" && !check.ok);
    if (disconnected) {
      appendWorkflowNotification(current, {
        type: "publisher-offline",
        severity: "error",
        title: blocked ? "发布助手离线" : "发布助手连接中断",
        message: blocked
          ? "当前无法填入小黑盒，请确认 Chrome 扩展已启用并重新连接。"
          : "填入过程中发布助手失去连接，请重新连接后重试。",
        dedupeKey: "publisher-offline",
        target: { page: "schedule", draftId },
      });
    }
    const target = current.drafts.find(entry => entry.id === draftId);
    if (!target) return;
    recordXiaoheiheFillAttempt(target, result, receipt, receipt.completedAt);
    const revision = publicationRevisionHash(target, "xiaoheihe");
    if (blocked || revision !== receipt.revisionHash) return { revision };
    target.updatedAt = new Date(Math.max(Date.now(), Date.parse(target.updatedAt) + 1)).toISOString();
    return { revision, updatedAt: target.updatedAt };
  }),
});

const batchDrivers = createDeliveryBatchDrivers({ wechat: wechatDelivery, xiaoheihe: xiaoheiheDelivery,
  publisherStatus: () => extensionPublisherBridge.status(), socialStatus: socialDeliveryServices.status,
  socialDeliver: socialDeliveryServices.deliver });
const openBatchPlatforms = async (platforms: DeliveryPlatform[]) => {
  const urls: string[] = platforms.map(id => deliveryPlatforms.find(item => item.id === id)!.url);
  if (platforms.includes("xiaoheihe") && !extensionPublisherBridge.status().ok) urls.unshift(`http://127.0.0.1:${port}/#drafts`);
  await openRegularChromeUrls(urls);
};
const deliveryBatchDesk = createDeliveryBatchDesk({ read: readState, update: updateState, drivers: batchDrivers, open: openBatchPlatforms,
  pending: () => readStateProjection(pendingDeliveryBatchJobs) });
registerDeliveryBatchRoutes(app, { desk: deliveryBatchDesk, read: readState, open: openBatchPlatforms });
app.get("/api/workflow/performance", asyncRoute(async (request, response) => {
  const days = Number(request.query.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) { response.status(400).json({ error: "统计窗口应为 1–365 天" }); return; }
  const urls = typeof request.query.url === "string" ? [request.query.url] : Array.isArray(request.query.url) ? request.query.url.filter((value): value is string => typeof value === "string") : [];
  const now = new Date().toISOString();
  const rework = readReworkObservations(await getLocalDatabase(), { days, now });
  response.json(await readStateProjection(state => buildWorkflowPerformance(state, { days, now, benchmarkUrls: urls, rework })));
}));

app.post(
  "/api/drafts/:draftId/fill",
  deliveryRoute(async (request, response) => {
    const state = await readState();
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const draft = state.drafts.find(entry => entry.id === draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (request.body?.updatedAt && request.body.updatedAt !== draft.updatedAt) throw new Error("草稿已在其他窗口变化，请刷新后重新填入");
    const result = await xiaoheiheDelivery.deliver(draft, state.settings);
    response.status(result.status).json(result.body);
  }),
);

app.post(
  "/api/drafts/:draftId/publish-confirmed",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const platform = request.body?.platform === "wechat" ? "wechat" : "xiaoheihe";
    const snapshotState = await readState();
    const snapshot = snapshotState.drafts.find((entry) => entry.id === draftId);
    if (!snapshot) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const expectedRevisionHash = publicationRevisionHash(snapshot, platform);
    const expectedInsertedIds = [...insertedMediaIds(snapshot)].sort();
    const actualImageFingerprints = Object.fromEntries(await Promise.all(
      expectedInsertedIds.map(async (placementId) => {
        const placement = snapshot.images.find((entry) => entry.id === placementId);
        if (!placement) return [placementId, undefined] as const;
        const inspected = await inspectDraftImageFile(placement);
        return [placementId, inspected.available ? inspected.fingerprint : undefined] as const;
      }),
    ));
    const result = await updateState((state) => {
      const draft = state.drafts.find((entry) => entry.id === draftId);
      if (!draft) return { status: 404 as const, error: "草稿不存在" };
      const currentInsertedIds = [...insertedMediaIds(draft)].sort();
      if (
        publicationRevisionHash(draft, platform) !== expectedRevisionHash
        || currentInsertedIds.length !== expectedInsertedIds.length
        || currentInsertedIds.some((placementId, index) => placementId !== expectedInsertedIds[index])
      ) {
        return { status: 409 as const, error: "草稿在图片核验后已发生变化，请重新确认发布" };
      }
      const alreadyCurrent = currentPublicationConfirmation(draft, platform);
      if (platform === "xiaoheihe" && !alreadyCurrent) {
        if (!draft.fillResult?.ok) {
          return { status: 409 as const, error: "请先成功填入小黑盒编辑器，再记录发布标签" };
        }
        const metadataReady = ["分区", "话题"].every(
          (name) => draft.fillResult?.steps.find((step) => step.name === name)?.ok === true,
        );
        if (!metadataReady) {
          return { status: 409 as const, error: "分区或标签尚未成功填入，不能保存到发布历史" };
        }
      }
      const confirmedAt = new Date().toISOString();
      let publication;
      try {
        publication = confirmDraftPublication(draft, platform, confirmedAt, {
          actualImageFingerprints,
        });
      } catch (error) {
        return {
          status: 409 as const,
          error: error instanceof Error ? error.message : "当前版本没有可确认的发布回执",
        };
      }
      if (publication.alreadyConfirmed) {
        return {
          status: 200 as const,
          platform,
          storyId: draft.provenance.storyId,
          receiptId: publication.confirmation.receiptId,
          confirmation: publication.confirmation,
          recentTopics: state.settings.recentTopics,
          recentCommunities: state.settings.recentCommunities,
          feedbackCount: state.candidateFeedback.length,
          alreadyConfirmed: true,
        };
      }
      if (platform === "xiaoheihe") {
        const topics = draft.fillResult?.topics ?? draft.topics;
        const community = draft.fillResult?.community ?? draft.community;
        state.settings.recentTopics = rememberRecentValues(state.settings.recentTopics, topics, 20);
        state.settings.recentCommunities = rememberRecentValues(
          state.settings.recentCommunities,
          [community],
          8,
        );
      }
      recordPublishedCandidateFeedback(state, draft.id, confirmedAt);
      reapplyPersonalizationToRuns(state);
      return {
        status: 200 as const,
        platform,
        storyId: draft.provenance.storyId,
        receiptId: publication.confirmation.receiptId,
        confirmation: publication.confirmation,
        recentTopics: state.settings.recentTopics,
        recentCommunities: state.settings.recentCommunities,
        feedbackCount: state.candidateFeedback.length,
        alreadyConfirmed: false,
      };
    });
    if ("error" in result) response.status(result.status).json({ error: result.error });
    else {
      const database = await getLocalDatabase();
      if (!result.alreadyConfirmed) {
        database.recordFeedback({
          type: "published",
          subjectType: "draft",
          subjectId: draftId,
          payload: { platform: result.platform, receiptId: result.receiptId, storyId: result.storyId },
        });
        database.recordWorkflowEvent({
          type: "delivery.published_confirmed",
          subjectType: "draft",
          subjectId: draftId,
          payload: { platform: result.platform, receiptId: result.receiptId, storyId: result.storyId },
        });
        const publishedDraft = (await readState()).drafts.find((draft) => draft.id === draftId);
        if (publishedDraft) recordPublishedWritingSignals(database, publishedDraft);
      }
      response.json(result);
    }
  }),
);

if (process.env.NODE_ENV === "production") {
  const distPath = process.env.AI_NEWS_DESK_DIST_ROOT || path.join(process.cwd(), "dist");
  await access(distPath);
  app.use(express.static(distPath));
  app.use((_request, response) => response.sendFile(path.join(distPath, "index.html")));
} else {
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
}

app.use(
  (error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
    console.error(error);
    response.status(500).json({ error: "服务器发生错误，请查看本机服务日志" });
  },
);

// Only the process that owns the HTTP port may prune or seed persisted state.
// Keep the previous initialization order, then recover interrupted runs before
// the scheduler is started by startOwnedServer.
const initializeOwnedWorkspace = async () => {
  const startupDatabase = await getLocalDatabase();
  const startupNow = Date.now();
  startupDatabase.pruneOperationalHistory({
    terminalJobsOlderThan: new Date(startupNow - 30 * 86_400_000).toISOString(),
    workflowEventsOlderThan: new Date(startupNow - 90 * 86_400_000).toISOString(),
    maxTerminalJobs: 1_000,
    maxWorkflowEvents: 5_000,
  });
  await pruneJobArtifacts(workflowJobsRoot, { maxAgeMs: 14 * 86_400_000, maxFiles: 200 });
  const optionalCatalog = await loadOptionalMaterialLibraryCatalog();
  if (optionalCatalog.warning) console.warn(optionalCatalog.warning);
  if (optionalCatalog.catalog) {
    const materialSeed = await updateState(async (state) => {
      const seeded = await seedMaterialLibrary({
        catalog: optionalCatalog.catalog,
        existingMaterials: state.materials,
        tombstonedAssetIds: state.materialSeedTombstones,
        // Brand cards are useful for search and manual review, but remain
        // `check-required`; only owned/licensed files can be selected as an
        // automatic article fallback.
        includeReviewRequired: true,
      });
      for (const material of seeded.updated) {
        const index = state.materials.findIndex((entry) => entry.id === material.id);
        if (index >= 0) state.materials[index] = material;
      }
      state.materials.unshift(...seeded.created);
      return seeded;
    });
    if (materialSeed.failed.length) {
      console.warn("Material library seed completed with failures", materialSeed.failed);
    }
  }
  await readTodayView();
  await recoverInterruptedRuns();
};

await startOwnedServer({
  listen: () => app.listen(port, "127.0.0.1"),
  recoverInterruptedRuns: initializeOwnedWorkspace,
  startScheduler,
});
void startSocialBridge().catch(() => undefined);
setInterval(() => { void deliveryBatchDesk.tick().catch(() => undefined); }, 5_000).unref();
const durableJobDesk = createJobDesk({
  database: await getLocalDatabase(),
  leaseMs: 30 * 60_000,
  concurrency: 2,
  canClaim: () => !isPortableArchiveImportActive(),
  handlers: {
    "collect-run": async (payload, context) => {
      const runId = payload && typeof payload === "object" && "runId" in payload
        ? String((payload as { runId: unknown }).runId)
        : "";
      if (!runId) throw new Error("任务缺少采集 Run ID");
      context.progress(0.03, "启动新闻采集");
      try {
        await executeCollection(runId, { signal: context.signal, progress: context.progress });
      } catch (error) {
        if (!context.signal.aborted && context.job.attempts < context.job.maxAttempts) {
          await updateState((state) => {
            const run = state.runs.find((entry) => entry.id === runId);
            if (!run || run.status === "cancelled") return;
            const timestamp = new Date().toISOString();
            run.status = "queued";
            run.stage = "等待自动重试";
            run.updatedAt = timestamp;
            run.logs.push({
              at: timestamp,
              stage: "等待自动重试",
              message: `第 ${context.job.attempts} 次执行失败，持久任务会按退避策略重试。`,
              level: "warning",
            });
          });
        }
        throw error;
      }
      context.progress(0.98, "整理采集结果");
      const run = (await readState()).runs.find((entry) => entry.id === runId);
      enqueueTodayTitleBackfill(await getLocalDatabase(), run);
      return { runId, status: run?.status, candidateCount: run?.candidates.length ?? 0 };
    },
    "backfill-today-titles": async (payload, context) => {
      context.progress(0.05, "补充今日中文标题");
      const result = await backfillTodayTitles(context.signal);
      if (result.failed) (await getLocalDatabase()).recordWorkflowEvent({
        type: "today-titles.failed", subjectType: "job", subjectId: context.job.id, payload: { ...result, collection: payload },
      });
      context.progress(0.98, "中文标题处理完成");
      return result;
    },
    "hydrate-story-assets": async (payload, context) => {
      const storyId = payload && typeof payload === "object" && "storyId" in payload
        ? String((payload as { storyId: unknown }).storyId)
        : "";
      const minimumImages = payload && typeof payload === "object" && "minimumImages" in payload
        ? Number((payload as { minimumImages: unknown }).minimumImages)
        : 2;
      if (!storyId) throw new Error("任务缺少 Story ID");
      context.progress(0.08, "读取来源图片");
      const scope = payload && typeof payload === "object" && "scope" in payload && payload.scope === "article" ? "article" : "preview";
      const result = await hydrateStoryAssets(storyId, Number.isFinite(minimumImages) ? minimumImages : 2, { scope, progress: context.progress, signal: context.signal });
      context.progress(0.96, "保存来源图片");
      return result;
    },
    "explain-story": async (payload, context) => {
      const storyId = payload && typeof payload === "object" && "storyId" in payload
        ? String((payload as { storyId: unknown }).storyId)
        : "";
      if (!storyId) throw new Error("任务缺少 Story ID");
      context.progress(0.08, "读取新闻正文");
      const story = await enrichStoryExplanation(storyId, context.signal);
      context.progress(0.96, "整理证据说明");
      return { storyId: story.id, explanationStatus: story.explanation.status };
    },
    "supplement-story-evidence": async (payload, context) => {
      const storyId = payload && typeof payload === "object" && "storyId" in payload
        ? String((payload as { storyId: unknown }).storyId)
        : "";
      if (!storyId) throw new Error("任务缺少 Story ID");
      context.progress(0.05, "准备补强独立来源");
      return storyEvidenceDesk.supplement(storyId, {
        progress: (progress, stage) => context.progress(progress, stage),
        signal: context.signal,
      });
    },
    "build-content-package": async (payload, context) => {
      const storyId = payload && typeof payload === "object" && "storyId" in payload
        ? String((payload as { storyId: unknown }).storyId)
        : "";
      const rawMode = payload && typeof payload === "object" && "mode" in payload
        ? (payload as { mode?: unknown }).mode
        : undefined;
      const minimumImages = payload && typeof payload === "object" && "minimumImages" in payload
        ? Number((payload as { minimumImages?: unknown }).minimumImages)
        : 2;
      const mode = typeof rawMode === "string" && draftableAssignmentModes.has(rawMode as Exclude<AssignmentMode, "watch" | "skip">)
        ? rawMode as Exclude<AssignmentMode, "watch" | "skip">
        : undefined;
      if (!storyId) throw new Error("任务缺少 Story ID");
      context.progress(0.03, "核对原文并准备文章资料");
      const result = await contentPackageDesk.buildAndSave(
        storyId,
        mode,
        (progress, stage) => context.progress(progress, stage),
        Number.isFinite(minimumImages) ? minimumImages : 2,
        undefined,
        { signal: context.signal },
      );
      context.progress(0.98, "素材包已保存，可开始成稿");
      return {
        packageId: result.contentPackage.id,
        status: result.contentPackage.status,
        reused: result.reused,
        visualResult: result.visualResult,
      };
    },
    "draft-from-package": async (payload, context) => {
      const packageId = payload && typeof payload === "object" && "packageId" in payload
        ? String((payload as { packageId: unknown }).packageId)
        : "";
      if (!packageId) throw new Error("任务缺少素材包 ID");
      context.progress(0.05, "准备生成草稿");
      const result = await createDraftFromPackage(packageId, (progress, stage) => context.progress(progress, stage), { signal: context.signal });
      context.progress(0.98, "完成草稿入库");
      return { draftId: result.draft.id, reused: result.reused, imageCount: result.draft.images.length };
    },
    "draft-from-intake-review": async (payload, context) => {
      const input = payload as { reviewId?: string };
      if (!input?.reviewId) throw new ClassifiedJobError("任务缺少导入复核 ID", "deterministic");
      return executeReviewGeneration(input.reviewId, context.progress, context.signal);
    },
    "draft-from-editorial-intake": async (payload, context) => {
      const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
      const runId = typeof input.runId === "string" ? input.runId : "";
      const candidateId = typeof input.candidateId === "string" ? input.candidateId : "";
      const intent = typeof input.intent === "string" && ["news", "source", "community"].includes(input.intent)
        ? input.intent as EditorialIntent
        : undefined;
      if (!runId || !candidateId) throw new Error("任务缺少候选来源标识");
      const result = await editorialIntakeDesk.createDraft(
        { runId, candidateId, intent, sourceMode: ["source", "translation", "curation"].includes(String(input.sourceMode)) ? input.sourceMode as "source" | "translation" | "curation" : undefined },
        (progress, stage) => context.progress(progress, stage),
        { signal: context.signal },
      );
      context.progress(0.99, "统一成稿链路已完成");
      return {
        draftId: result.draft.id,
        packageId: result.contentPackage.id,
        storyId: result.story.id,
        intent: result.contentPackage.intent,
        reused: result.reused,
        imageCount: result.draft.images.length,
      };
    },
  },
});
durableJobDesk.start();
console.log(`AI 新闻台已启动：http://127.0.0.1:${port}`);
