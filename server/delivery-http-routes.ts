import { primaryDeliveryStatus, wechatPreflight, resolveWeChatAttempt } from "./primary-delivery.js";
import { reviewDraftQuality, bindReviewedParagraph } from "./draft-quality-review.js";
import {
  insertedMediaIds,
  publisherImagePostBodyHtml,
  publisherBodyHtml,
  publisherImageCaptions,
  sanitizeDraftHtml,
} from "./article-html.js";
import {
  clearCandidateFeedback,
  recordCandidateFeedback,
  recordPublishedCandidateFeedback,
  restoreCandidateFeedback,
} from "./candidate-feedback.js";
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
import { fillDraftInPublisher, openPublisher, publisherStatus } from "./publishing.js";
import { rememberRecentValues } from "./publishing-memory.js";
import { reapplyPersonalizationToRuns } from "./personalization.js";
import {
  recordDraftEdit,
  recordPublishedWritingSignals,
  writingMemoryView,
} from "./learning-desk.js";
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
import { createWeChatDraftDesk } from "./wechat-draft.js";
import { createWeChatHttpGateway } from "./wechat-http.js";
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
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, deliveryRoute, publisherPreflightFor } from "./http-route-support.js";

export function registerDeliveryHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
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
    const current = await runtime.readState();
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
    const settings = await runtime.updateState((state) => {
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
    const state = await runtime.readState();
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
}

export function registerDeliveryHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.get("/api/drafts/:draftId/delivery-status", asyncRoute(async (request, response) => {
  const state = await runtime.readState();
  const draft = state.drafts.find(item => item.id === request.params.draftId);
  if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
  const quality = reviewDraftQuality(draft, await runtime.getLocalDatabase());
  response.json({ ...primaryDeliveryStatus(draft, state.settings.wechat.appId),
    xiaoheiheNextCompanion: state.settings.xiaoheiheNextCompanion ?? "Steam",
    wechatPreflight: wechatPreflight(draft, state.settings.wechat, quality.blockers) });
}));

app.post("/api/drafts/:draftId/wechat-attempts/:attemptId/resolve", deliveryRoute(async (request, response) => {
  if (request.body?.resolution !== "not-received" || request.body?.confirmed !== true) throw new Error("请先在公众号草稿箱确认本次未收到");
  if (runtime.deliveryDesk.isBusy(String(request.params.draftId), "wechat")) throw new Error("发送仍在进行，请等待结果后核对");
  await runtime.updateState(state => {
    const draft = state.drafts.find(item => item.id === request.params.draftId);
    if (!draft) throw new Error("草稿不存在");
    resolveWeChatAttempt(draft, String(request.params.attemptId));
  });
  response.json({ ok: true });
}));

app.post(
  "/api/drafts/:draftId/wechat-sync",
  deliveryRoute(async (request, response) => {
    const state = await runtime.readState();
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
    const result = await runtime.wechatDelivery.deliver(draftId, request.body?.updatedAt || draft.updatedAt);
    if (!result.draft) {
      response.status(409).json({ error: "同步完成，但本地草稿已被删除；请到公众号草稿箱确认" });
      return;
    }
    const database = await runtime.getLocalDatabase();
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
}

export function registerDeliveryHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/publisher/status",
  asyncRoute(async (_request, response) => {
    const state = await runtime.readState();
    response.json(await publisherStatus(state.settings));
  }),
);

app.get(
  "/api/drafts/:draftId/publisher-preflight",
  deliveryRoute(async (request, response) => {
    const state = await runtime.readState();
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
    const state = await runtime.readState();
    response.json(await openPublisher(state.settings));
  }),
);
}

export function registerDeliveryHttpRoutes4(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/drafts/:draftId/fill",
  deliveryRoute(async (request, response) => {
    const state = await runtime.readState();
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const draft = state.drafts.find(entry => entry.id === draftId);
    if (!draft) {
      response.status(404).json({ error: "草稿不存在" });
      return;
    }
    if (request.body?.updatedAt && request.body.updatedAt !== draft.updatedAt) throw new Error("草稿已在其他窗口变化，请刷新后重新填入");
    const result = await runtime.xiaoheiheDelivery.deliver(draft, state.settings);
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
    const snapshotState = await runtime.readState();
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
    const result = await runtime.updateState((state) => {
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
      const database = await runtime.getLocalDatabase();
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
        const publishedDraft = (await runtime.readState()).drafts.find((draft) => draft.id === draftId);
        if (publishedDraft) recordPublishedWritingSignals(database, publishedDraft);
      }
      response.json(result);
    }
  }),
);
}

export const deliveryHttpRouteRegistrars = [registerDeliveryHttpRoutes1, registerDeliveryHttpRoutes2, registerDeliveryHttpRoutes3, registerDeliveryHttpRoutes4] as const;
