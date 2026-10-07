import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import express from "express";
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
import { asyncRoute, decodedHeader, decodedHeaderList, storeNewMaterial, respondMaterialError, decodeHeader, parseScreenshotCropHeader, parseImagePostLinesHeader } from "./http-route-support.js";

export function registerMediaHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/materials",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "10mb" }),
  asyncRoute(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) {
      response.status(400).json({ error: "没有收到图片文件" });
      return;
    }
    try {
      const state = await runtime.readState();
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
      const state = await runtime.readState();
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
    const removed = await runtime.updateState((state) => {
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
}

export function registerMediaHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/image-posts/from-screenshot",
  express.raw({ type: ["image/png", "image/jpeg", "image/webp"], limit: "10mb" }),
  asyncRoute(async (request, response) => {
    if (!Buffer.isBuffer(request.body)) throw new Error("没有收到截图文件");
    const state = await runtime.readState();
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
    await runtime.updateState((current) => {
      current.drafts.unshift(draft);
    });
    response.status(201).json(draft);
  }),
);
}

export function registerMediaHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/drafts/:draftId/media",
  express.raw({ type: ["image/jpeg", "image/png", "image/webp", "image/gif"], limit: "10mb" }),
  asyncRoute(async (request, response) => {
    const draftId = Array.isArray(request.params.draftId)
      ? request.params.draftId[0]
      : request.params.draftId;
    const state = await runtime.readState();
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
    const state = await runtime.readState();
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
    const state = await runtime.readState();
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
}

export function registerMediaHttpRoutes4(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/drafts/:draftId/published-images/material-status",
  asyncRoute(async (request, response) => {
    const state = await runtime.readState();
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
    const state = await runtime.readState();
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
}

export const mediaHttpRouteRegistrars = [registerMediaHttpRoutes1, registerMediaHttpRoutes2, registerMediaHttpRoutes3, registerMediaHttpRoutes4] as const;
