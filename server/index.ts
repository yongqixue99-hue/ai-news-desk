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
import { registerDraftHttpRoutes1, registerDraftHttpRoutes2, registerDraftHttpRoutes3 } from "./draft-http-routes.js";
import { registerDeliveryHttpRoutes1, registerDeliveryHttpRoutes2, registerDeliveryHttpRoutes3, registerDeliveryHttpRoutes4 } from "./delivery-http-routes.js";
import { registerLearningHttpRoutes1, registerLearningHttpRoutes2, registerLearningHttpRoutes3, registerLearningHttpRoutes4, registerLearningHttpRoutes5, registerLearningHttpRoutes6 } from "./learning-http-routes.js";
import { registerWorkflowHttpRoutes1, registerWorkflowHttpRoutes2, registerWorkflowHttpRoutes3, registerWorkflowHttpRoutes4, registerWorkflowHttpRoutes5, registerWorkflowHttpRoutes6, registerWorkflowHttpRoutes7 } from "./workflow-http-routes.js";

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

registerWorkflowHttpRoutes1(app, httpRouteRuntime);

registerDraftHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes1(app, httpRouteRuntime);
registerWorkflowHttpRoutes2(app, httpRouteRuntime);

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

registerLearningHttpRoutes1(app, httpRouteRuntime);

registerStoryHttpRoutes5(app, httpRouteRuntime);

registerPackageHttpRoutes2(app, httpRouteRuntime);

registerWorkflowHttpRoutes3(app, httpRouteRuntime);

registerLearningHttpRoutes2(app, httpRouteRuntime);

registerWorkflowHttpRoutes4(app, httpRouteRuntime);

registerLearningHttpRoutes3(app, httpRouteRuntime);

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
registerWorkflowHttpRoutes5(app, httpRouteRuntime);

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

registerDeliveryHttpRoutes1(app, httpRouteRuntime);

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

registerWorkflowHttpRoutes6(app, httpRouteRuntime);

registerLearningHttpRoutes4(app, httpRouteRuntime);

registerWorkflowHttpRoutes7(app, httpRouteRuntime);

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

registerLearningHttpRoutes5(app, httpRouteRuntime);
registerDraftHttpRoutes2(app, httpRouteRuntime);

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

registerDraftHttpRoutes3(app, httpRouteRuntime);

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

registerDeliveryHttpRoutes2(app, httpRouteRuntime);

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
