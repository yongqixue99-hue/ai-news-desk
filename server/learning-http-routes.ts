import { writingPreferencePlan } from "./writing-preference-retrieval.js";
import { recordEditObservation } from "./edit-observation.js";
import { draftReworkChanges, readReworkObservations, summarizeReworkObservations } from "./draft-rework.js";
import { affectedDraftsForSourceChanges } from "./source-change-impact.js";
import {
  clearCandidateFeedback,
  recordCandidateFeedback,
  recordPublishedCandidateFeedback,
  restoreCandidateFeedback,
} from "./candidate-feedback.js";
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
import { buildWorkflowPerformance } from "./workflow-performance.js";
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
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, storyEventTypes, routeParam } from "./http-route-support.js";

export function registerLearningHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/stories/:storyId/events",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const type = typeof request.body?.type === "string" ? request.body.type : "";
    if (!storyEventTypes.has(type)) {
      response.status(400).json({ error: "不支持的 Story 行为事件" });
      return;
    }
    const currentStory = storyById(await runtime.readState(), storyId);
    if (!currentStory) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    if (type === "interested" || type === "not_interested") {
      await runtime.updateState((state) => {
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
    const database = await runtime.getLocalDatabase();
    const reason = typeof request.body?.reason === "string" ? request.body.reason.trim().slice(0, 500) : undefined;
    const payload = request.body?.payload && typeof request.body.payload === "object"
      ? request.body.payload as Record<string, unknown>
      : undefined;
    const event = database.recordFeedback({ type, subjectType: "story", subjectId: storyId, reason, payload });
    database.recordWorkflowEvent({ type: `story.${type}`, subjectType: "story", subjectId: storyId, payload });
    response.status(201).json({ event, story: storyById(await runtime.readState(), storyId) });
  }),
);

app.delete(
  "/api/stories/:storyId/feedback",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const restored = await runtime.updateState((state) => {
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
    const database = await runtime.getLocalDatabase();
    const event = database.recordFeedback({ type: "feedback_restored", subjectType: "story", subjectId: storyId });
    database.recordWorkflowEvent({ type: "story.feedback_restored", subjectType: "story", subjectId: storyId });
    response.json({ event, story: restored });
  }),
);
}

export function registerLearningHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/product/feedback",
  asyncRoute(async (request, response) => {
    const limit = Number(request.query.limit ?? 100);
    response.json((await runtime.getLocalDatabase()).listFeedback(undefined, undefined, Number.isFinite(limit) ? limit : 100));
  }),
);
}

export function registerLearningHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/editorial-system",
  asyncRoute(async (_request, response) => {
    const database = await runtime.getLocalDatabase();
    response.json({
      ...buildEditorialSystemView(await runtime.readState()),
      writingMemories: writingMemoryView(database, (await runtime.readState()).settings.writingMemoryEnabled),
    });
  }),
);

app.post("/api/editorial-memories/preview", asyncRoute(async (request,response) => {
  const state=await runtime.readState();
  const title=typeof request.body?.title === "string" ? request.body.title.slice(0,500) : "";
  const intent=["news","community","source"].includes(request.body?.intent) ? request.body.intent : "news";
  response.json(writingPreferencePlan(await runtime.getLocalDatabase(),{enabled:state.settings.writingMemoryEnabled,title,intent}));
}));

app.patch(
  "/api/editorial-system/profile",
  asyncRoute(async (request, response) => {
    const patch = (request.body ?? {}) as Partial<EditorialProfile>;
    const view = await runtime.updateState((state) => {
      updateEditorialProfile(state, patch);
      return buildEditorialSystemView(state);
    });
    response.json({ ...view, writingMemories: writingMemoryView(await runtime.getLocalDatabase(), (await runtime.readState()).settings.writingMemoryEnabled) });
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
    const view = await runtime.updateState((state) => {
      decideEditorialSuggestion(state, suggestionId, decision);
      return buildEditorialSystemView(state);
    });
    response.json({ ...view, writingMemories: writingMemoryView(await runtime.getLocalDatabase(), (await runtime.readState()).settings.writingMemoryEnabled) });
  }),
);

app.patch(
  "/api/editorial-memories/:memoryId",
  asyncRoute(async (request, response) => {
    if (typeof request.body?.enabled !== "boolean") {
      response.status(400).json({ error: "enabled 必须是布尔值" });
      return;
    }
    const database = await runtime.getLocalDatabase();
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
    response.json(writingMemoryView(database, (await runtime.readState()).settings.writingMemoryEnabled));
  }),
);

app.delete(
  "/api/editorial-memories/:memoryId",
  asyncRoute(async (request, response) => {
    const database = await runtime.getLocalDatabase();
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
    response.json(writingMemoryView(database, (await runtime.readState()).settings.writingMemoryEnabled));
  }),
);

app.patch(
  "/api/notifications/:notificationId/read",
  asyncRoute(async (request, response) => {
    const notificationId = Array.isArray(request.params.notificationId)
      ? request.params.notificationId[0]
      : request.params.notificationId;
    const result = await runtime.updateState((state) => ({
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
    const notifications = await runtime.updateState((state) => {
      markAllWorkflowNotificationsRead(state);
      return state.notifications;
    });
    response.json(notifications);
  }),
);
}

export function registerLearningHttpRoutes4(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/runs/:runId/candidates/:candidateId/feedback",
  asyncRoute(async (request, response) => {
    const kind = request.body?.kind as CandidateFeedbackKind;
    if (!(["interested", "not_interested"] as CandidateFeedbackKind[]).includes(kind)) {
      response.status(400).json({ error: "候选反馈类型不正确" });
      return;
    }
    const result = await runtime.updateState((state) => {
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
    const result = await runtime.updateState((state) => {
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
    const result = await runtime.updateState((state) => {
      const cleared = clearCandidateFeedback(state);
      reapplyPersonalizationToRuns(state);
      return { cleared, feedbackCount: state.candidateFeedback.length };
    });
    response.json(result);
  }),
);
}

export function registerLearningHttpRoutes5(app: Express, runtime: HttpRouteRuntime): void {
app.post("/api/drafts/:draftId/edit-observation", asyncRoute(async (request,response)=>{
  const draft=(await runtime.readState()).drafts.find(draft=>draft.id===routeParam(request.params.draftId));
  if(!draft){response.status(404).json({error:"草稿不存在"});return;}
  response.json(recordEditObservation(await runtime.getLocalDatabase(),draft,request.body));
}));

app.get("/api/drafts/:draftId/rework", asyncRoute(async (request, response) => {
  const draft = (await runtime.readState()).drafts.find(item => item.id === routeParam(request.params.draftId));
  if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
  const observations = readReworkObservations(await runtime.getLocalDatabase(), { draftId: draft.id });
  response.json({ changes: draftReworkChanges(draft), observations: summarizeReworkObservations(observations), window: observations.window });
}));

app.get("/api/source-changes", asyncRoute(async (_request, response) => {
  response.json(affectedDraftsForSourceChanges((await runtime.readState()).drafts, await runtime.getLocalDatabase()));
}));
}

export function registerLearningHttpRoutes6(app: Express, runtime: HttpRouteRuntime): void {
app.get("/api/workflow/performance", asyncRoute(async (request, response) => {
  const days = Number(request.query.days ?? 30);
  if (!Number.isInteger(days) || days < 1 || days > 365) { response.status(400).json({ error: "统计窗口应为 1–365 天" }); return; }
  const urls = typeof request.query.url === "string" ? [request.query.url] : Array.isArray(request.query.url) ? request.query.url.filter((value): value is string => typeof value === "string") : [];
  const now = new Date().toISOString();
  const rework = readReworkObservations(await runtime.getLocalDatabase(), { days, now });
  response.json(await runtime.readStateProjection(state => buildWorkflowPerformance(state, { days, now, benchmarkUrls: urls, rework })));
}));
}

export const learningHttpRouteRegistrars = [registerLearningHttpRoutes1, registerLearningHttpRoutes2, registerLearningHttpRoutes3, registerLearningHttpRoutes4, registerLearningHttpRoutes5, registerLearningHttpRoutes6] as const;
