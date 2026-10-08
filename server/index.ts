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
  readRunArtifact,
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
import { registerDraftHttpRoutes1, registerDraftHttpRoutes2, registerDraftHttpRoutes3 } from "./draft-http-routes.js";
import { registerDeliveryHttpRoutes1, registerDeliveryHttpRoutes2, registerDeliveryHttpRoutes3, registerDeliveryHttpRoutes4 } from "./delivery-http-routes.js";
import { registerLearningHttpRoutes1, registerLearningHttpRoutes2, registerLearningHttpRoutes3, registerLearningHttpRoutes4, registerLearningHttpRoutes5, registerLearningHttpRoutes6 } from "./learning-http-routes.js";
import { registerWorkflowHttpRoutes1, registerWorkflowHttpRoutes2, registerWorkflowHttpRoutes3, registerWorkflowHttpRoutes4, registerWorkflowHttpRoutes5, registerWorkflowHttpRoutes6, registerWorkflowHttpRoutes7 } from "./workflow-http-routes.js";
import { registerDataHttpRoutes1 } from "./data-http-routes.js";
import { registerSettingsHttpRoutes1, registerSettingsHttpRoutes2, registerSettingsHttpRoutes3 } from "./settings-http-routes.js";
import { registerMediaHttpRoutes1, registerMediaHttpRoutes2, registerMediaHttpRoutes3, registerMediaHttpRoutes4 } from "./media-http-routes.js";
import { registerAggregationTitleTranslationRoutes } from "./title-translation-http-routes.js";

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
  get readArtifact() { return readRunArtifact; },
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

registerWorkflowHttpRoutes1(app, httpRouteRuntime);

registerDraftHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes1(app, httpRouteRuntime);
registerWorkflowHttpRoutes2(app, httpRouteRuntime);

registerSourceHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes2(app, httpRouteRuntime);
registerAggregationTitleTranslationRoutes(app, httpRouteRuntime);

const backfillTodayTitles = createTodayTitleBackfill({
  readView: readTodayView,
  enrich: enrichCandidateBriefings,
});
// Page fallback and collection jobs reuse the same bounded analysis operation.
registerStoryHttpRoutes3(app, httpRouteRuntime);

registerPackageHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes4(app, httpRouteRuntime);

registerLearningHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes5(app, httpRouteRuntime);

registerPackageHttpRoutes2(app, httpRouteRuntime);

registerWorkflowHttpRoutes3(app, httpRouteRuntime);

registerLearningHttpRoutes2(app, httpRouteRuntime);

registerWorkflowHttpRoutes4(app, httpRouteRuntime);

registerLearningHttpRoutes3(app, httpRouteRuntime);

registerDataHttpRoutes1(app, httpRouteRuntime);

// Lightweight identity probe for the local desktop launcher; never exposes credentials.
registerWorkflowHttpRoutes5(app, httpRouteRuntime);

registerStoryHttpRoutes6(app, httpRouteRuntime);

registerSourceHttpRoutes2(app, httpRouteRuntime);

registerSettingsHttpRoutes1(app, httpRouteRuntime);

registerDeliveryHttpRoutes1(app, httpRouteRuntime);

registerSettingsHttpRoutes2(app, httpRouteRuntime);

registerMediaHttpRoutes1(app, httpRouteRuntime);

registerSourceHttpRoutes3(app, httpRouteRuntime);

registerStoryHttpRoutes7(app, httpRouteRuntime);

registerWorkflowHttpRoutes6(app, httpRouteRuntime);

registerLearningHttpRoutes4(app, httpRouteRuntime);

registerWorkflowHttpRoutes7(app, httpRouteRuntime);

registerEditorialHttpRoutes1(app, httpRouteRuntime);







registerMediaHttpRoutes2(app, httpRouteRuntime);

registerLearningHttpRoutes5(app, httpRouteRuntime);
registerDraftHttpRoutes2(app, httpRouteRuntime);

registerSettingsHttpRoutes3(app, httpRouteRuntime);

registerEditorialHttpRoutes2(app, httpRouteRuntime);

registerDraftHttpRoutes3(app, httpRouteRuntime);

registerMediaHttpRoutes3(app, httpRouteRuntime);

registerDeliveryHttpRoutes2(app, httpRouteRuntime);

registerMediaHttpRoutes4(app, httpRouteRuntime);

registerDeliveryHttpRoutes3(app, httpRouteRuntime);

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
registerLearningHttpRoutes6(app, httpRouteRuntime);

registerDeliveryHttpRoutes4(app, httpRouteRuntime);

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
