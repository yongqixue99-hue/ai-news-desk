import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import path from "node:path";
import express from "express";
import { createServer as createViteServer } from "vite";
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
  createPortableWorkflowArchive,
  createWorkflowBackup,
  storageUsageFor,
  verifyWorkflowBackup,
} from "./data-management.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import { assertDraftTransition } from "./draft-lifecycle.js";
import { importDraftImageFromUrl, saveUploadedDraftImage } from "./media.js";
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
  evaluatePublishedImagePromotion,
  inspectDraftImageFile,
  publicPublishedImagePromotionStatus,
} from "./published-materials.js";
import { extensionPublisherBridge } from "./publisher-extension.js";
import {
  completePublisherAttempt,
  createPublisherAttempt,
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
import { probeProviderConnection } from "./provider-health.js";
import { validateRemoteUrl } from "./remote-url.js";
import {
  applySourcePreset,
  batchUpdateSources,
  createSourcePreset,
  deleteSourcePreset,
} from "./source-management.js";
import { applySourceProbeResult, probeSource } from "./source-probe.js";
import { startScheduler } from "./scheduler.js";
import { startOwnedServer } from "./startup.js";
import {
  deleteProviderApiKey,
  deleteWeChatAppSecret,
  getWeChatAppSecret,
  setProviderApiKey,
  setWeChatAppSecret,
} from "./secrets.js";
import { importArticleSkill } from "./skill-registry.js";
import { createWeChatDraftDesk } from "./wechat-draft.js";
import { createWeChatHttpGateway } from "./wechat-http.js";
import { loadWeChatPlacementImage } from "./wechat-image.js";
import { createDeliveryDesk } from "./delivery-desk.js";
import { buildContentPackage } from "./package-desk.js";
import { buildTodayView, storyById } from "./story-desk.js";
import { enrichStoryExplanation } from "./story-explanation-service.js";
import { createDraftFromPackage } from "./draft-desk.js";
import { createJobDesk } from "./job-desk.js";
import { hydrateStoryAssets } from "./visual-desk.js";
import { hydrateStoryDiscussion } from "./community-intelligence.js";
import {
  confirmIntakeReview,
  createLinkIntakeReview,
  createScreenshotIntakeReview,
  listIntakeReviews,
} from "./intake-review-service.js";
import {
  getLocalDatabase,
  readState,
  replaceState,
  updateState,
  workflowMaterialsRoot,
  workflowMediaRoot,
  workflowRoot,
} from "./storage.js";
import { normalizeTopicIds } from "./topics.js";
import { sourceRoleFor } from "./source-routing.js";
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
import type { AssignmentMode, ContentPackage } from "./product-types.js";

const app = express();
const port = Number(process.env.AI_NEWS_DESK_PORT || 4317);
const deliveryDesk = createDeliveryDesk();

const defaultJsonBody = express.json({ limit: "2mb" });
app.use((request, response, next) => {
  // A complete state backup can grow beyond normal command payloads. Keep the
  // larger allowance isolated to the restore endpoint instead of raising the
  // body limit for every API call.
  if (request.path === "/api/data/restore") next();
  else defaultJsonBody(request, response, next);
});
app.use("/media", express.static(workflowMediaRoot, { fallthrough: false }));
app.use("/materials", express.static(workflowMaterialsRoot, { fallthrough: false }));

const asyncRoute =
  (handler: (request: express.Request, response: express.Response) => Promise<void>) =>
  (request: express.Request, response: express.Response, next: express.NextFunction) =>
    handler(request, response).catch(next);

const validDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const sourceKinds = new Set(["rss", "hackernews", "google_news", "zhihu", "last30days", "github"]);
const sourceRoles = new Set(["official", "verification", "research", "discovery", "community"]);
const draftableAssignmentModes = new Set<Exclude<AssignmentMode, "watch" | "skip">>([
  "brief",
  "synthesis",
  "community",
  "playbook",
  "curate",
]);
const storyEventTypes = new Set([
  "opened",
  "interested",
  "not_interested",
  "package_created",
  "drafted",
  "synced",
  "published",
]);

const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

const decodedHeader = (request: express.Request, name: string) => {
  const raw = request.get(name) || "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

const decodedHeaderList = (request: express.Request, name: string) =>
  decodedHeader(request, name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const storeNewMaterial = async (material: ImageMaterial) => {
  try {
    await updateState((state) => {
      assertUniqueMaterialFingerprint(material.fingerprint, state.materials);
      state.materials.unshift(material);
    });
  } catch (error) {
    // Only this request's just-created file is removed. A previously stored
    // material referenced by DuplicateMaterialError is never touched.
    await removeMaterialFile(material);
    throw error;
  }
};

const respondMaterialError = (response: express.Response, error: unknown) => {
  if (!(error instanceof DuplicateMaterialError)) return false;
  response.status(error.statusCode).json({
    error: error.message,
    code: error.code,
    duplicateId: error.duplicateId,
  });
  return true;
};

const publisherPreflightFor = async (draft: ArticleDraft, settings: Settings) => {
  const status = await publisherStatus(settings);
  const inserted = insertedMediaIds(draft);
  const captions = publisherImageCaptions(draft);
  const preflight = evaluatePublisherPreflight({
    runtime: publisherRuntimeFromStatus(status, {
      loggedIn: status.loggedIn,
      editorReady: status.editorReady,
      pageUrl: status.pageUrl,
    }),
    draft: {
      id: draft.id,
      contentFormat: draft.contentFormat,
      title: draft.title,
      bodyHtml: draft.contentFormat === "image-post"
        ? publisherImagePostBodyHtml(draft)
        : publisherBodyHtml(draft),
      community: draft.community,
      topics: draft.topics,
      images: draft.images
        .filter((placement) => inserted.has(placement.id))
        .map((placement) => ({
          id: placement.id,
          available: Boolean(placement.image.localPath || placement.image.publicPath),
          caption: captions.get(placement.id) || placement.caption || placement.image.caption,
        })),
    },
    minimumProtocolVersion: draft.contentFormat === "image-post" ? "0.1.17" : "0.1.14",
  });
  // Only media actually referenced by the article can block delivery. Drafts
  // may keep unused source images as a research tray, and those should not
  // force the editor to clear rights metadata before filling the article.
  const readiness = evaluateDraftReadiness({
    ...draft,
    images: draft.images.filter((placement) => inserted.has(placement.id)),
  }, "xiaoheihe");
  for (const blocker of readiness.blockers) {
    preflight.blocking.push({
      code: "PREFLIGHT_EDITORIAL_READINESS",
      capability: blocker.startsWith("图片：") ? "images" : "body",
      severity: "blocking",
      message: blocker,
      action: blocker.startsWith("图片：")
        ? "到图片面板补齐版权来源、授权状态和平台许可。"
        : "到资料面板核验事实或降低结论强度。",
    });
  }
  for (const warning of readiness.warnings) {
    preflight.warnings.push({
      code: "PREFLIGHT_EDITORIAL_WARNING",
      capability: "images",
      severity: "warning",
      message: warning,
    });
  }
  if (!readiness.ready) {
    preflight.canQueueFill = false;
    preflight.publishReady = false;
    preflight.summary = `有 ${readiness.blockers.length} 项事实或版权问题阻止填入`;
  }
  return preflight;
};

app.get(
  "/api/bootstrap",
  asyncRoute(async (_request, response) => {
    const state = await readState();
    // Revision snapshots are fetched only when the Versions drawer opens;
    // keeping them out of the initial payload prevents old article bodies from
    // slowing down every page load as the local archive grows.
    response.json({ ...state, draftRevisions: [], articleAgentThreads: [] });
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

app.get(
  "/api/today",
  asyncRoute(async (_request, response) => {
    const view = buildTodayView(await readState());
    const database = await getLocalDatabase();
    for (const story of [...view.mustReads, ...view.secondary].slice(0, 5)) {
      if (story.imageCount >= 2) continue;
      database.enqueueJob({
        type: "hydrate-story-assets",
        idempotencyKey: `hydrate-story-assets:${story.id}:${story.lastSeenAt}`,
        payload: { storyId: story.id, minimumImages: 2 },
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
    const story = storyById(await readState(), storyId);
    if (!story) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    const database = await getLocalDatabase();
    response.json({
      story,
      contentPackage: database.latestContentPackageForStory<ContentPackage>(storyId),
      feedback: database.listFeedback("story", storyId, 30),
    });
  }),
);

app.post(
  "/api/stories/:storyId/explanation",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const story = storyById(await readState(), storyId);
    if (!story) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    const force = request.body?.force === true;
    if (story.explanation.status === "ready" && !force) {
      response.json({ story, reused: true });
      return;
    }
    const database = await getLocalDatabase();
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
      const updated = storyById(await readState(), storyId);
      response.json({ job: queued.job, story: updated, reused: true });
      return;
    }
    response.status(202).json({ job: queued.job, story, reused: queued.reused });
  }),
);

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

app.post(
  "/api/stories/:storyId/packages",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const requestedMode = typeof request.body?.mode === "string" ? request.body.mode : undefined;
    if (requestedMode && !draftableAssignmentModes.has(requestedMode as Exclude<AssignmentMode, "watch" | "skip">)) {
      response.status(400).json({ error: "请选择可成稿的稿型" });
      return;
    }
    const [visualResult, discussionSamples] = await Promise.all([
      hydrateStoryAssets(storyId, 2),
      hydrateStoryDiscussion(storyId),
    ]);
    const contentPackage = buildContentPackage(await readState(), {
      storyId,
      mode: requestedMode as Exclude<AssignmentMode, "watch" | "skip"> | undefined,
      discussionSamples,
    });
    const database = await getLocalDatabase();
    database.recordWorkflowEvent({
      type: "story.assets_hydrated",
      subjectType: "story",
      subjectId: storyId,
      payload: visualResult,
    });
    const existing = database.getContentPackage<ContentPackage>(contentPackage.id);
    const saved = existing ?? database.saveContentPackage(contentPackage);
    if (!existing) {
      database.recordFeedback({
        type: "package_created",
        subjectType: "story",
        subjectId: storyId,
        payload: { packageId: saved.id, mode: saved.mode, status: saved.status },
      });
      database.recordWorkflowEvent({
        type: "package.created",
        subjectType: "package",
        subjectId: saved.id,
        payload: { storyId, mode: saved.mode, status: saved.status },
      });
    }
    response.status(existing ? 200 : 201).json({ contentPackage: saved, reused: Boolean(existing) });
  }),
);

app.get(
  "/api/packages/:packageId",
  asyncRoute(async (request, response) => {
    const contentPackage = (await getLocalDatabase()).getContentPackage<ContentPackage>(routeParam(request.params.packageId));
    if (!contentPackage) {
      response.status(404).json({ error: "素材包不存在" });
      return;
    }
    response.json(contentPackage);
  }),
);

app.post(
  "/api/packages/:packageId/draft",
  asyncRoute(async (request, response) => {
    const packageId = routeParam(request.params.packageId);
    const database = await getLocalDatabase();
    if (!database.getContentPackage<ContentPackage>(packageId)) {
      response.status(404).json({ error: "素材包不存在" });
      return;
    }
    const queued = database.enqueueJob({
      type: "draft-from-package",
      idempotencyKey: `draft-from-package:${packageId}`,
      payload: { packageId },
      maxAttempts: 3,
    });
    if (queued.job.status === "complete") {
      const result = queued.job.result as { draftId?: string; reused?: boolean } | undefined;
      const draft = result?.draftId ? (await readState()).drafts.find((entry) => entry.id === result.draftId) : undefined;
      if (draft) {
        response.json({ job: queued.job, draft, reused: Boolean(result?.reused) });
        return;
      }
    }
    response.status(202).json({ job: queued.job, reused: queued.reused });
  }),
);

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
    response.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
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
      writingMemories: writingMemoryView(database),
    });
  }),
);

app.patch(
  "/api/editorial-system/profile",
  asyncRoute(async (request, response) => {
    const patch = (request.body ?? {}) as Partial<EditorialProfile>;
    const view = await updateState((state) => {
      updateEditorialProfile(state, patch);
      return buildEditorialSystemView(state);
    });
    response.json({ ...view, writingMemories: writingMemoryView(await getLocalDatabase()) });
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
    response.json({ ...view, writingMemories: writingMemoryView(await getLocalDatabase()) });
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
    response.json(writingMemoryView(database));
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
    response.json(writingMemoryView(database));
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
    response.sendFile(archive.archivePath);
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

app.patch(
  "/api/settings",
  asyncRoute(async (request, response) => {
    const allowed = request.body as Partial<Settings>;
    const settings = await updateState((state) => {
      const next = {
        ...state.settings,
        ...allowed,
        // Publication history is write-protected and only changes through the
        // explicit "published successfully" confirmation endpoint.
        recentTopics: state.settings.recentTopics,
        recentCommunities: state.settings.recentCommunities,
      };
      next.windowHours = Math.max(1, Math.min(48, Number(next.windowHours) || 24));
      next.collectionTopics = normalizeTopicIds(next.collectionTopics);
      next.imageLimit = Math.max(0, Math.min(12, Number(next.imageLimit) || 0));
      next.autoGenerateCount = Math.max(1, Math.min(10, Number(next.autoGenerateCount) || 3));
      next.publisherMode = next.publisherMode === "cdp" ? "cdp" : "chrome-extension";
      next.personalizationEnabled = next.personalizationEnabled !== false;
      next.notificationsMuted = next.notificationsMuted !== false;
      state.settings = next;
      if (typeof allowed.personalizationEnabled === "boolean") reapplyPersonalizationToRuns(state);
      return next;
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
      const nextVisionModel = typeof body.visionModel === "string"
        ? body.visionModel.trim().slice(0, 120)
        : provider.visionModel;
      const nextBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().slice(0, 500) : provider.baseUrl;
      const connectionConfigurationChanged = nextModel !== provider.model
        || nextVisionModel !== provider.visionModel
        || nextBaseUrl !== provider.baseUrl
        || Boolean(keyHint)
        || Boolean(body.clearApiKey);
      provider.model = nextModel;
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
      return state.materials.splice(index, 1)[0];
    });
    if (!removed) {
      response.status(404).json({ error: "图片素材不存在" });
      return;
    }
    await removeMaterialFile(removed);
    response.status(204).end();
  }),
);

app.post(
  "/api/sources",
  asyncRoute(async (request, response) => {
    const body = request.body as Partial<SourceConfig>;
    if (!body.name?.trim() || !body.kind) {
      response.status(400).json({ error: "新闻源名称和类型不能为空" });
      return;
    }
    if (!sourceKinds.has(body.kind)) {
      response.status(400).json({ error: "不支持的新闻源类型" });
      return;
    }
    if (body.kind === "rss" && !body.url) {
      response.status(400).json({ error: "RSS 新闻源必须填写地址" });
      return;
    }
    for (const candidateUrl of [body.homepageUrl, body.url]) {
      if (!candidateUrl) continue;
      try {
        await validateRemoteUrl(candidateUrl.trim());
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const source: SourceConfig = {
      id: `source_${randomUUID().slice(0, 8)}`,
      name: body.name.trim(),
      kind: body.kind,
      homepageUrl: body.homepageUrl?.trim(),
      url: body.url?.trim(),
      query: body.query?.trim(),
      topicIds: normalizeTopicIds(body.topicIds),
      enabled: true,
      selected: true,
      category: body.category?.trim() || "ai-news",
      role: sourceRoles.has(body.role ?? "") ? body.role : undefined,
      discoveryOnly: Boolean(body.discoveryOnly),
      note: body.note?.trim(),
    };
    source.role ??= sourceRoleFor(source);
    await updateState((state) => state.sources.push(source));
    response.status(201).json(source);
  }),
);

app.patch(
  "/api/sources/batch",
  asyncRoute(async (request, response) => {
    const sourceIds: string[] = Array.isArray(request.body?.sourceIds)
      ? [...new Set<string>((request.body.sourceIds as unknown[]).filter((sourceId): sourceId is string =>
        typeof sourceId === "string" && sourceId.trim().length > 0))].slice(0, 200)
      : [];
    const patch = {
      ...(typeof request.body?.enabled === "boolean" ? { enabled: request.body.enabled } : {}),
      ...(typeof request.body?.selected === "boolean" ? { selected: request.body.selected } : {}),
    };
    if (!sourceIds.length) {
      response.status(400).json({ error: "请至少选择一个新闻源" });
      return;
    }
    if (patch.enabled === undefined && patch.selected === undefined) {
      response.status(400).json({ error: "批量操作必须指定启用状态或默认采集状态" });
      return;
    }
    const sources = await updateState((state) => batchUpdateSources(state, sourceIds, patch));
    response.json({ sources, updated: sources.length });
  }),
);

app.patch(
  "/api/sources/:sourceId",
  asyncRoute(async (request, response) => {
    const currentState = await readState();
    const existing = currentState.sources.find((entry) => entry.id === request.params.sourceId);
    if (!existing) {
      response.status(404).json({ error: "新闻源不存在" });
      return;
    }
    const body = request.body as Partial<SourceConfig>;
    const allowedKeys = [
      "name",
      "kind",
      "homepageUrl",
      "url",
      "query",
      "topicIds",
      "enabled",
      "selected",
      "category",
      "role",
      "discoveryOnly",
      "note",
    ] as const;
    const patch: Partial<SourceConfig> = {};
    for (const key of allowedKeys) {
      if (body[key] !== undefined) (patch[key] as unknown) = body[key];
    }
    const nextKind = patch.kind ?? existing.kind;
    if (!sourceKinds.has(nextKind)) {
      response.status(400).json({ error: "不支持的新闻源类型" });
      return;
    }
    const nextUrl = typeof patch.url === "string" ? patch.url.trim() : existing.url;
    if (nextKind === "rss" && !nextUrl && !existing.routes?.some((route) => route.url || route.query)) {
      response.status(400).json({ error: "RSS 新闻源必须填写地址" });
      return;
    }
    const nextHomepageUrl = typeof patch.homepageUrl === "string"
      ? patch.homepageUrl.trim()
      : existing.homepageUrl;
    for (const candidateUrl of [patch.url !== undefined ? nextUrl : undefined, patch.homepageUrl !== undefined ? nextHomepageUrl : undefined]) {
      if (!candidateUrl) continue;
      try {
        await validateRemoteUrl(candidateUrl);
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    if (patch.url !== undefined) patch.url = nextUrl;
    if (patch.homepageUrl !== undefined) patch.homepageUrl = nextHomepageUrl;
    if (typeof patch.name === "string") patch.name = patch.name.trim();
    if (typeof patch.query === "string") patch.query = patch.query.trim();
    if (patch.topicIds !== undefined) patch.topicIds = normalizeTopicIds(patch.topicIds);
    if (typeof patch.category === "string") patch.category = patch.category.trim();
    if (patch.role !== undefined && !sourceRoles.has(patch.role)) {
      response.status(400).json({ error: "不支持的来源分类" });
      return;
    }
    if (typeof patch.note === "string") patch.note = patch.note.trim();
    const source = await updateState((state) => {
      const target = state.sources.find((entry) => entry.id === request.params.sourceId);
      if (!target) return undefined;
      Object.assign(target, patch, { id: target.id });
      return target;
    });
    if (!source) response.status(404).json({ error: "新闻源不存在" });
    else response.json(source);
  }),
);

app.post(
  "/api/sources/:sourceId/test",
  asyncRoute(async (request, response) => {
    const current = await readState();
    const source = current.sources.find((entry) => entry.id === request.params.sourceId);
    if (!source) {
      response.status(404).json({ error: "新闻源不存在" });
      return;
    }
    const result = await probeSource(source);
    const updated = await updateState((state) => {
      const target = state.sources.find((entry) => entry.id === request.params.sourceId);
      return target ? applySourceProbeResult(target, result) : undefined;
    });
    if (!updated) response.status(404).json({ error: "新闻源已被删除" });
    else response.json({ source: updated, result });
  }),
);

app.delete(
  "/api/sources/:sourceId",
  asyncRoute(async (request, response) => {
    const removed = await updateState((state) => {
      const index = state.sources.findIndex((entry) => entry.id === request.params.sourceId);
      if (index < 0) return false;
      state.sources.splice(index, 1);
      state.sourcePresets = state.sourcePresets.flatMap((preset) => {
        const sourceIds = preset.sourceIds.filter((sourceId) => sourceId !== request.params.sourceId);
        return sourceIds.length ? [{ ...preset, sourceIds }] : [];
      });
      return true;
    });
    response.status(removed ? 204 : 404).end();
  }),
);

app.get(
  "/api/source-presets",
  asyncRoute(async (_request, response) => {
    response.json((await readState()).sourcePresets);
  }),
);

app.post(
  "/api/source-presets",
  asyncRoute(async (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name : "";
    const sourceIds = Array.isArray(request.body?.sourceIds)
      ? request.body.sourceIds.filter((sourceId: unknown): sourceId is string => typeof sourceId === "string").slice(0, 200)
      : [];
    try {
      const preset = await updateState((state) => createSourcePreset(state, { name, sourceIds }));
      response.status(201).json(preset);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }),
);

app.post(
  "/api/source-presets/:presetId/apply",
  asyncRoute(async (request, response) => {
    const presetId = Array.isArray(request.params.presetId)
      ? request.params.presetId[0]
      : request.params.presetId;
    try {
      const result = await updateState((state) => {
        applySourcePreset(state, presetId);
        const preset = state.sourcePresets.find((entry) => entry.id === presetId) as SourcePreset;
        return { preset, sources: state.sources };
      });
      response.json(result);
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }),
);

app.delete(
  "/api/source-presets/:presetId",
  asyncRoute(async (request, response) => {
    const presetId = Array.isArray(request.params.presetId)
      ? request.params.presetId[0]
      : request.params.presetId;
    const removed = await updateState((state) => deleteSourcePreset(state, presetId));
    response.status(removed ? 204 : 404).end();
  }),
);

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
      response.status(409).json({ error: "任务仍在运行，中文速读会在采集后自动生成" });
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

app.post(
  "/api/intakes/url",
  asyncRoute(async (request, response) => {
    const rawUrl = typeof request.body?.url === "string" ? request.body.url.trim() : "";
    if (!rawUrl) {
      response.status(400).json({ error: "请填写网页链接" });
      return;
    }
    try {
      const validated = await validateRemoteUrl(rawUrl);
      response.status(201).json({ review: await createLinkIntakeReview(validated.toString()) });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }),
);

app.post(
  "/api/intakes/screenshot",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "15mb" }),
  asyncRoute(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: "没有收到截图文件" });
      return;
    }
    const decodeHeader = (value: string | undefined, fallback: string) => {
      if (!value) return fallback;
      try {
        return decodeURIComponent(value).slice(0, 600);
      } catch {
        return fallback;
      }
    };
    const contentType = (request.get("content-type") || "").split(";")[0];
    const fileName = decodeHeader(request.get("x-file-name"), "网页截图");
    const note = decodeHeader(request.get("x-intake-note"), "");
    response.status(201).json({
      review: await createScreenshotIntakeReview(request.body, contentType, fileName, note || undefined),
    });
  }),
);

app.get(
  "/api/intakes/reviews",
  asyncRoute(async (_request, response) => {
    response.json(await listIntakeReviews());
  }),
);

app.post(
  "/api/intakes/reviews/:reviewId/confirm",
  asyncRoute(async (request, response) => {
    const reviewId = Array.isArray(request.params.reviewId) ? request.params.reviewId[0] : request.params.reviewId;
    response.status(202).json(await confirmIntakeReview(reviewId, {
      excludedTextBlockIds: Array.isArray(request.body?.excludedTextBlockIds) ? request.body.excludedTextBlockIds : [],
      includedNoiseBlockIds: Array.isArray(request.body?.includedNoiseBlockIds) ? request.body.includedNoiseBlockIds : [],
      includedImageIds: Array.isArray(request.body?.includedImageIds) ? request.body.includedImageIds : [],
      note: typeof request.body?.note === "string" ? request.body.note.slice(0, 600) : undefined,
    }));
  }),
);

app.post(
  "/api/runs/:runId/candidates/:candidateId/community-draft",
  asyncRoute(async (request, response) => {
    const mode = request.body?.mode as CommunityDraftMode;
    if (!(["source", "translation", "curation"] as CommunityDraftMode[]).includes(mode)) {
      response.status(400).json({ error: "社区入稿模式不正确" });
      return;
    }
    const runId = Array.isArray(request.params.runId) ? request.params.runId[0] : request.params.runId;
    const candidateId = Array.isArray(request.params.candidateId)
      ? request.params.candidateId[0]
      : request.params.candidateId;
    response.status(201).json(await createCommunityDraft(runId, candidateId, mode));
  }),
);

app.post(
  "/api/runs/:runId/generate",
  asyncRoute(async (request, response) => {
    const ids = Array.isArray(request.body?.candidateIds) ? request.body.candidateIds : undefined;
    const runId = Array.isArray(request.params.runId) ? request.params.runId[0] : request.params.runId;
    const result = await requestSelectedDraftGeneration(runId, ids);
    response.status(result.accepted ? 202 : 200).json(result);
  }),
);

const decodeHeader = (value: string | undefined, fallback = "") => {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  } catch {
    throw new Error("截图图文请求头编码无效");
  }
};

const parseScreenshotCropHeader = (value: string | undefined): ScreenshotCropRegion => {
  const parts = decodeHeader(value).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("图片裁区必须是 left,top,width,height");
  }
  return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] };
};

const parseImagePostLinesHeader = (value: string | undefined) => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeHeader(value, "[]"));
  } catch {
    throw new Error("图文正文必须是 JSON 字符串数组");
  }
  if (!Array.isArray(parsed) || parsed.some((line) => typeof line !== "string")) {
    throw new Error("图文正文必须是 JSON 字符串数组");
  }
  return parsed;
};

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

app.patch(
  "/api/drafts/:draftId",
  asyncRoute(async (request, response) => {
    const result = await updateState((state) => {
      const target = state.drafts.find((entry) => entry.id === request.params.draftId);
      if (!target) return undefined;
      const body = request.body as Partial<ArticleDraft> & { _saveMode?: DraftSaveMode };
      const before = snapshotDraft(target);
      const saveMode: DraftSaveMode = body._saveMode === "auto" ? "auto" : "manual";
      if (body.status !== undefined) assertDraftTransition(target, body.status);
      for (const key of ["title", "paragraphs", "take", "sources", "factClaims", "uncertainties", "images", "community", "topics", "status", "contentFormat", "layoutTheme"] as const) {
        if (body[key] !== undefined) (target[key] as unknown) = body[key];
      }
      if (body.bodyHtml !== undefined) target.bodyHtml = sanitizeDraftHtml(body.bodyHtml);
      target.updatedAt = new Date().toISOString();
      appendDraftRevision(state, target, saveMode);
      return { draft: target, before, after: snapshotDraft(target), saveMode };
    });
    if (!result) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    recordDraftEdit(await getLocalDatabase(), {
      draftId: result.draft.id,
      before: result.before,
      after: result.after,
      saveMode: result.saveMode,
    });
    response.json(result.draft);
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

app.post(
  "/api/drafts/:draftId/wechat-sync",
  asyncRoute(async (request, response) => {
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
      response.status(400).json({ error: "请先在定时任务页连接微信公众号" });
      return;
    }
    const result = await deliveryDesk.sync({ draftId, channel: "wechat" }, async () => {
      const latestState = await readState();
      const latestDraft = latestState.drafts.find((entry) => entry.id === draftId);
      if (!latestDraft) throw new Error("同步开始前本地草稿已被删除");
      const author = typeof request.body?.author === "string"
        ? request.body.author.trim()
        : latestState.settings.wechat.defaultAuthor;
      const digest = typeof request.body?.digest === "string"
        ? request.body.digest.trim()
        : Array.from(latestDraft.take.trim()).slice(0, 120).join("");
      const requestedSourceUrl = typeof request.body?.contentSourceUrl === "string"
        ? request.body.contentSourceUrl.trim()
        : latestDraft.provenance.originalUrl;
      const contentSourceUrl = /^https?:\/\//i.test(requestedSourceUrl) ? requestedSourceUrl : undefined;
      const gateway = createWeChatHttpGateway({
        appId: latestState.settings.wechat.appId,
        appSecret: await getWeChatAppSecret(),
      });
      const receipt = await createWeChatDraftDesk({
        gateway,
        loadImage: loadWeChatPlacementImage,
      }).syncDraft({
        draft: latestDraft,
        author,
        digest,
        contentSourceUrl,
        previousReceipt: latestDraft.wechatDraft,
      });
      const updatedDraft = await updateState((current) => {
        const target = current.drafts.find((entry) => entry.id === draftId);
        if (!target) return undefined;
        target.wechatDraft = receipt;
        return target;
      });
      return { receipt, draft: updatedDraft };
    });
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
  asyncRoute(async (request, response) => {
    const state = await readState();
    const draft = state.drafts.find((entry) => entry.id === request.params.draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    response.json(await publisherPreflightFor(draft, state.settings));
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
    response.json(extensionPublisherBridge.heartbeat(token, clientId, version));
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
    response.json(extensionPublisherBridge.complete(token, clientId, jobId, {
      pageUrl: typeof request.body?.pageUrl === "string" ? request.body.pageUrl : undefined,
      steps: Array.isArray(request.body?.steps) ? request.body.steps : [],
    }));
  }),
);

app.post(
  "/api/publisher/launch",
  asyncRoute(async (_request, response) => {
    const state = await readState();
    response.json(await openPublisher(state.settings));
  }),
);

app.post(
  "/api/drafts/:draftId/fill",
  asyncRoute(async (request, response) => {
    const state = await readState();
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const draft = state.drafts.find((entry) => entry.id === draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    const preflight = await publisherPreflightFor(draft, state.settings);
    const attempt = createPublisherAttempt(preflight);
    if (!preflight.canQueueFill) {
      const receipt = completePublisherAttempt(attempt, { steps: [] });
      await updateState((current) => {
        current.publisherReceipts.unshift(receipt);
        current.publisherReceipts = current.publisherReceipts.slice(0, 100);
        const target = current.drafts.find((entry) => entry.id === draftId);
        if (target) target.publisherReceipt = receipt;
        if (preflight.blocking.some((issue) => issue.code === "PREFLIGHT_TRANSPORT_DISCONNECTED")) {
          appendWorkflowNotification(current, {
            type: "publisher-offline",
            severity: "error",
            title: "发布助手离线",
            message: "当前无法填入小黑盒，请确认 Chrome 扩展已启用并重新连接。",
            dedupeKey: "publisher-offline",
            target: { page: "schedule", draftId },
          });
        }
      });
      response.status(409).json({ error: preflight.summary, preflight, receipt });
      return;
    }
    const result = await fillDraftInPublisher(draftId, state.settings);
    const receipt = completePublisherAttempt(attempt, {
      pageUrl: result.pageUrl,
      diagnosticScreenshot: result.diagnosticScreenshot,
      steps: result.steps,
      completedAt: result.at,
    });
    const enriched = { ...result, ok: receipt.outcome === "filled", preflight, receipt };
    await updateState((current) => {
      current.publisherReceipts.unshift(receipt);
      current.publisherReceipts = current.publisherReceipts.slice(0, 100);
      if (receipt.checks.some((check) => check.id === "transport" && !check.ok)) {
        appendWorkflowNotification(current, {
          type: "publisher-offline",
          severity: "error",
          title: "发布助手连接中断",
          message: "填入过程中发布助手失去连接，请重新连接后重试。",
          dedupeKey: "publisher-offline",
          target: { page: "schedule", draftId },
        });
      }
      const target = current.drafts.find((entry) => entry.id === draftId);
      if (!target) return;
      target.fillResult = enriched;
      target.publisherReceipt = receipt;
      target.status = enriched.ok ? "filled" : "editing";
      if (enriched.ok) {
        // A new platform fill is a new revision. Any earlier manual publication
        // confirmation must not authorize images from this newer receipt.
        delete target.publicationConfirmedAt;
        delete target.publicationReceiptId;
      }
      target.updatedAt = new Date().toISOString();
    });
    response.json(enriched);
  }),
);

app.post(
  "/api/drafts/:draftId/publish-confirmed",
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const platform = request.body?.platform === "wechat" ? "wechat" : "xiaoheihe";
    const result = await updateState((state) => {
      const draft = state.drafts.find((entry) => entry.id === draftId);
      if (!draft) return { status: 404 as const, error: "草稿不存在" };
      if (draft.status === "published" && draft.publicationConfirmedAt) {
        return {
          status: 200 as const,
          platform,
          storyId: draft.provenance.storyId,
          receiptId: draft.publicationReceiptId,
          recentTopics: state.settings.recentTopics,
          recentCommunities: state.settings.recentCommunities,
          feedbackCount: state.candidateFeedback.length,
          alreadyConfirmed: true,
        };
      }
      if (platform === "wechat") {
        if (!draft.wechatDraft) {
          return { status: 409 as const, error: "请先同步到微信公众号草稿箱" };
        }
        if (draft.wechatDraft.localDraftUpdatedAt !== draft.updatedAt) {
          return { status: 409 as const, error: "本地正文在上次同步后有修改，请先更新公众号草稿" };
        }
      } else {
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
      draft.publicationConfirmedAt = confirmedAt;
      draft.publicationReceiptId = platform === "wechat"
        ? draft.wechatDraft?.mediaId
        : draft.publisherReceipt?.outcome === "filled"
          ? draft.publisherReceipt.attemptId
          : undefined;
      draft.status = "published";
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
        receiptId: draft.publicationReceiptId,
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
  const distPath = path.join(process.cwd(), "dist");
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
    response.status(500).json({ error: error.message || "服务器发生错误" });
  },
);

// Warm the title-token index before the HTTP port becomes visible. With a
// few hundred historical signals this keeps the very first Today request,
// not only subsequent requests, inside the personal-product latency budget.
buildTodayView(await readState());

await startOwnedServer({
  listen: () => app.listen(port, "127.0.0.1"),
  recoverInterruptedRuns,
  startScheduler,
});
const durableJobDesk = createJobDesk({
  database: await getLocalDatabase(),
  leaseMs: 30 * 60_000,
  concurrency: 2,
  handlers: {
    "collect-run": async (payload, context) => {
      const runId = payload && typeof payload === "object" && "runId" in payload
        ? String((payload as { runId: unknown }).runId)
        : "";
      if (!runId) throw new Error("任务缺少采集 Run ID");
      context.progress(0.03);
      try {
        await executeCollection(runId);
      } catch (error) {
        if (context.job.attempts < context.job.maxAttempts) {
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
      context.progress(0.98);
      const run = (await readState()).runs.find((entry) => entry.id === runId);
      return { runId, status: run?.status, candidateCount: run?.candidates.length ?? 0 };
    },
    "hydrate-story-assets": async (payload, context) => {
      const storyId = payload && typeof payload === "object" && "storyId" in payload
        ? String((payload as { storyId: unknown }).storyId)
        : "";
      const minimumImages = payload && typeof payload === "object" && "minimumImages" in payload
        ? Number((payload as { minimumImages: unknown }).minimumImages)
        : 2;
      if (!storyId) throw new Error("任务缺少 Story ID");
      context.progress(0.08);
      const result = await hydrateStoryAssets(storyId, Number.isFinite(minimumImages) ? minimumImages : 2);
      context.progress(0.96);
      return result;
    },
    "explain-story": async (payload, context) => {
      const storyId = payload && typeof payload === "object" && "storyId" in payload
        ? String((payload as { storyId: unknown }).storyId)
        : "";
      if (!storyId) throw new Error("任务缺少 Story ID");
      context.progress(0.08);
      const story = await enrichStoryExplanation(storyId);
      context.progress(0.96);
      return { storyId: story.id, explanationStatus: story.explanation.status };
    },
    "draft-from-package": async (payload, context) => {
      const packageId = payload && typeof payload === "object" && "packageId" in payload
        ? String((payload as { packageId: unknown }).packageId)
        : "";
      if (!packageId) throw new Error("任务缺少素材包 ID");
      context.progress(0.08);
      const result = await createDraftFromPackage(packageId);
      context.progress(0.96);
      return { draftId: result.draft.id, reused: result.reused, imageCount: result.draft.images.length };
    },
  },
});
durableJobDesk.start();
console.log(`AI 新闻台已启动：http://127.0.0.1:${port}`);
