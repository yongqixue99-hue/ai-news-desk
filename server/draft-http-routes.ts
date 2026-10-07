import { normalizeXiaoheiheOptions, reserveXiaoheiheDefaults, xiaoheiheSelection } from "./xiaoheihe-publishing.js";
import { normalizeWeChatMetadata } from "./wechat-metadata.js";
import { normalizeSocialMetadata } from "./social-metadata.js";
import { writingPreferencePlan } from "./writing-preference-retrieval.js";
import { reviewDraftQuality, bindReviewedParagraph } from "./draft-quality-review.js";
import { confirmDraftInState } from "./draft-confirmation.js";
import { buildDraftOverview } from "./draft-overview.js";
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
import { appendDraftRevision, restoreDraftRevision, revisionsForDraft, snapshotDraft } from "./draft-revisions.js";
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
import { normalizeLegacyUserUpload } from "./user-provided-media.js";
import {
  recordDraftEdit,
  recordPublishedWritingSignals,
  writingMemoryView,
} from "./learning-desk.js";
import { completionAvailability, editorialProfileForWriting } from "./editorial-controls.js";
import { normalizePublisherTopics } from "./xiaoheihe-format.js";
import {
  buildInlineCompletionPrompt,
  isStableInlineCompletionPreview,
  prepareInlineCompletion,
} from "./inline-completion.js";
import { runInlineCompletionProvider, streamInlineCompletionProvider } from "./provider-runtime.js";
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
import type { AssignmentMode, ContentPackage, EditorialIntent } from "./product-types.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, routeParam } from "./http-route-support.js";

export function registerDraftHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/drafts/overview",
  asyncRoute(async (_request, response) => {
    response.json(buildDraftOverview((await runtime.readState()).drafts));
  }),
);
}

export function registerDraftHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.get("/api/drafts/:draftId/quality-check", asyncRoute(async (request, response) => {
  const draft = (await runtime.readState()).drafts.find(item => item.id === routeParam(request.params.draftId));
  if (!draft) { response.status(404).json({error:"草稿不存在"}); return; }
  response.json(reviewDraftQuality(draft, await runtime.getLocalDatabase()));
}));

app.post("/api/drafts/:draftId/review-fact", asyncRoute(async (request, response) => {
  const database = await runtime.getLocalDatabase();
  const draft = await runtime.updateState(state => {
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
  const database = await runtime.getLocalDatabase();
  const draft = await runtime.updateState(state => {
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
  const draft = (await runtime.readState()).drafts.find((entry) => entry.id === routeParam(request.params.draftId));
  if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
  response.json(draft);
}));

app.post("/api/drafts/:draftId/confirm", asyncRoute(async (request, response) => {
  const database = await runtime.getLocalDatabase();
  const result = await runtime.updateState((state) => {
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
    const database = await runtime.getLocalDatabase();
    const result = await runtime.updateState((state) => {
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
}

export function registerDraftHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
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
    const state = await runtime.readState();
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
      ? (await runtime.getLocalDatabase()).getContentPackage<ContentPackage>(packageId)
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
      const preferencePlan = writingPreferencePlan(await runtime.getLocalDatabase(), { enabled: state.settings.writingMemoryEnabled, title: draft.title, topics: draft.topics, intent: contentPackage.intent, mode: contentPackage.mode });
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
    const state = await runtime.readState();
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
    const result = await runtime.updateState((state) => {
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
}

export const draftHttpRouteRegistrars = [registerDraftHttpRoutes1, registerDraftHttpRoutes2, registerDraftHttpRoutes3] as const;
