import { inspectXiaoheiheCover } from "./xiaoheihe-cover.js";
import { normalizeXiaoheiheOptions, reserveXiaoheiheDefaults, xiaoheiheSelection } from "./xiaoheihe-publishing.js";
import { reviewDraftQuality, bindReviewedParagraph } from "./draft-quality-review.js";
import express from "express";
import {
  insertedMediaIds,
  publisherImagePostBodyHtml,
  publisherBodyHtml,
  publisherImageCaptions,
  sanitizeDraftHtml,
} from "./article-html.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
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
import type { AssignmentMode, ContentPackage, EditorialIntent } from "./product-types.js";

export const asyncRoute =
  (handler: (request: express.Request, response: express.Response) => Promise<void>) =>
  (request: express.Request, response: express.Response, next: express.NextFunction) =>
    handler(request, response).catch(next);

export const deliveryRoute = (handler: (request: express.Request, response: express.Response) => Promise<void>) =>
  asyncRoute(async (request, response) => {
    try { await handler(request, response); }
    catch (error) {
      const detail = error instanceof Error ? error.message : "发送未完成，请检查连接后重试";
      response.status(error instanceof PublicationRevisionConflictError ? 409 : 400).json({ error: detail });
    }
  });

export const validDateInput = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

export const sourceKinds = new Set(["rss", "hackernews", "google_news", "zhihu", "last30days", "github", "x", "documentation"]);

export const sourceRoles = new Set(["official", "verification", "research", "discovery", "community"]);

export const draftableAssignmentModes = new Set<Exclude<AssignmentMode, "watch" | "skip">>([
  "brief",
  "synthesis",
  "community",
  "playbook",
  "curate",
]);

export const storyEventTypes = new Set([
  "opened",
  "interested",
  "not_interested",
  "package_created",
  "drafted",
  "synced",
  "published",
]);

export const routeParam = (value: string | string[]) => Array.isArray(value) ? value[0] : value;

export const decodedHeader = (request: express.Request, name: string) => {
  const raw = request.get(name) || "";
  if (!raw) return "";
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

export const decodedHeaderList = (request: express.Request, name: string) =>
  decodedHeader(request, name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const storeNewMaterial = async (material: ImageMaterial) => {
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

export const respondMaterialError = (response: express.Response, error: unknown) => {
  if (!(error instanceof DuplicateMaterialError)) return false;
  response.status(error.statusCode).json({
    error: error.message,
    code: error.code,
    duplicateId: error.duplicateId,
  });
  return true;
};

export const publisherPreflightFor = async (
  draft: ArticleDraft,
  settings: Settings,
  expectedRevisionHash = publicationRevisionHash(draft, "xiaoheihe"),
) => {
  const status = await publisherStatus(settings);
  const inserted = insertedMediaIds(draft);
  const captions = publisherImageCaptions(draft);
  const placementsById = new Map(draft.images.map((placement) => [placement.id, placement]));
  const inspectedImages = await Promise.all([...inserted].map(async (placementId) => {
    const placement = placementsById.get(placementId);
    if (!placement) return { id: placementId, available: false, caption: "" };
    const inspected = await inspectDraftImageFile(placement);
    const fingerprintMatches = Boolean(
      inspected.fingerprint
      && placement.image.fingerprint
      && inspected.fingerprint === placement.image.fingerprint,
    );
    return {
      id: placement.id,
      available: inspected.available && fingerprintMatches,
      caption: captions.get(placement.id) ?? (placement.caption || placement.image.caption),
      captionRequired: placement.image.rights !== "user-provided",
    };
  }));
  const selection = draft.xiaoheiheOptions ? xiaoheiheSelection(draft) : undefined;
  const coverId = selection?.options.creationPlan !== "none" ? selection?.options.coverPlacementId : undefined;
  const cover = coverId ? placementsById.get(coverId) : undefined;
  const inspectedCover = cover ? await inspectXiaoheiheCover(cover) : undefined;
  const preflight = evaluatePublisherPreflight({
    expectedRevisionHash,
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
      community: selection?.communities.join(" · ") ?? draft.community,
      topics: selection?.topics ?? draft.topics,
      xiaoheiheOptions: selection?.options,
      coverProblem: inspectedCover?.reason,
      coverAvailable: Boolean(inspectedCover?.available && inspectedCover.fingerprint && inspectedCover.fingerprint === cover?.image.fingerprint),
      images: inspectedImages,
    },
    minimumProtocolVersion: MINIMUM_EXTENSION_VERSION,
  });
  // Only media actually referenced by the article can block delivery. Drafts
  // may keep unused source images as a research tray, and those should not
  // force the editor to clear rights metadata before filling the article.
  const readiness = evaluateDraftReadiness({
    ...draft,
    images: draft.images.filter((placement) => inserted.has(placement.id) || placement.id === coverId),
  }, "xiaoheihe");
  const quality = reviewDraftQuality(draft, await getLocalDatabase());
  readiness.factBlockers.push(...quality.blockers);
  readiness.blockers.push(...quality.blockers); readiness.ready = readiness.blockers.length === 0;
  readiness.binding = quality.binding;
  return appendEditorialReadiness(preflight, readiness);
};

export const decodeHeader = (value: string | undefined, fallback = "") => {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  } catch {
    throw new Error("截图图文请求头编码无效");
  }
};

export const parseScreenshotCropHeader = (value: string | undefined): ScreenshotCropRegion => {
  const parts = decodeHeader(value).split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("图片裁区必须是 left,top,width,height");
  }
  return { left: parts[0], top: parts[1], width: parts[2], height: parts[3] };
};

export const parseImagePostLinesHeader = (value: string | undefined) => {
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
