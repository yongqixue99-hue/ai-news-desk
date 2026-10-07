import { queueEditorialDraft } from "./editorial-jobs.js";
import express from "express";
import { codexStatus, requestSelectedDraftGeneration } from "./generator.js";
import { createCommunityDraft, type CommunityDraftMode } from "./community-draft.js";
import { validateRemoteUrl } from "./remote-url.js";
import {
  confirmIntakeReview,
  executeReviewGeneration,
  createLinkIntakeReview,
  createManualXPostIntakeReview,
  createScreenshotIntakeReview,
  ensureIntakeContentPackageForDraft,
  listIntakeReviews,
} from "./intake-review-service.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, decodeHeader } from "./http-route-support.js";

export function registerEditorialHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
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
    if (!(["article", "source", "translation", "curation"] as CommunityDraftMode[]).includes(mode)) {
      response.status(400).json({ error: "社区入稿模式不正确" });
      return;
    }
    const runId = Array.isArray(request.params.runId) ? request.params.runId[0] : request.params.runId;
    const candidateId = Array.isArray(request.params.candidateId)
      ? request.params.candidateId[0]
      : request.params.candidateId;
    try {
      response.status(202).json(await queueEditorialDraft({ runId, candidateId, intent: mode === "article" ? "news" : "source", sourceMode: mode === "article" ? undefined : mode }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/^(?:关联来源|这条社区线索|社区讨论|社区入稿|生成正文|模型没有为)/u.test(message)) {
        response.status(422).json({ error: message.slice(0, 360) });
        return;
      }
      throw error;
    }
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
}

export function registerEditorialHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/intakes/x-post",
  asyncRoute(async (request, response) => {
    try {
      response.status(201).json({
        review: await createManualXPostIntakeReview({
          url: typeof request.body?.url === "string" ? request.body.url : "",
          text: typeof request.body?.text === "string" ? request.body.text : "",
          author: typeof request.body?.author === "string" ? request.body.author : undefined,
          title: typeof request.body?.title === "string" ? request.body.title : undefined,
        }),
      });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }),
);
}

export const editorialHttpRouteRegistrars = [registerEditorialHttpRoutes1, registerEditorialHttpRoutes2] as const;
