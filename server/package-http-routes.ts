import { queueEditorialDraft } from "./editorial-jobs.js";
import { createHash, randomUUID } from "node:crypto";
import { buildHomeNews, storyById, retainStoryForWriting } from "./story-desk.js";
import {
  createDraftFromPackage,
  createHumanDraftFromPackage,
  editorialGeneratorRevision,
} from "./draft-desk.js";
import { editorialIntakeDesk } from "./editorial-intake.js";
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
import type { AssignmentMode, ContentPackage, EditorialIntent } from "./product-types.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, draftableAssignmentModes, routeParam } from "./http-route-support.js";

export function registerPackageHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/editorial-intakes/:runId/:candidateId",
  asyncRoute(async (request, response) => {
    const runId = routeParam(request.params.runId);
    const candidateId = routeParam(request.params.candidateId);
    try {
      const result = await editorialIntakeDesk.open({ runId, candidateId });
      const database = await runtime.getLocalDatabase();
      response.json({
        ...result,
        contentPackage: database.latestContentPackageForStory<ContentPackage>(result.story.id),
        feedback: database.listFeedback("story", result.story.id, 30),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      response.status(/不存在|找不到|尚未归入/u.test(message) ? 404 : 422).json({ error: message.slice(0, 360) });
    }
  }),
);

app.post(
  "/api/editorial-intakes/:runId/:candidateId/draft",
  asyncRoute(async (request, response) => {
    const runId = routeParam(request.params.runId);
    const candidateId = routeParam(request.params.candidateId);
    const rawIntent = request.body?.intent;
    const intent = typeof rawIntent === "string" && ["news", "source", "community"].includes(rawIntent)
      ? rawIntent as EditorialIntent
      : undefined;
    const opened = await editorialIntakeDesk.open({ runId, candidateId });
    const resolvedIntent = intent ?? opened.intake.recommendedIntent;
    const candidate = (await runtime.readState()).runs.find((run) => run.id === runId)
      ?.candidates.find((entry) => entry.id === candidateId);
    if (!candidate) {
      response.status(404).json({ error: "候选不存在" });
      return;
    }
    const database = await runtime.getLocalDatabase();
    const queued = await queueEditorialDraft({ runId, candidateId, intent: resolvedIntent });
    if (queued.job.status === "complete") {
      const result = queued.job.result as { draftId?: string; packageId?: string; reused?: boolean } | undefined;
      const draft = result?.draftId ? (await runtime.readState()).drafts.find((entry) => entry.id === result.draftId) : undefined;
      const contentPackage = result?.packageId ? database.getContentPackage<ContentPackage>(result.packageId) : undefined;
      if (draft && contentPackage) {
        response.json({ job: queued.job, draft, contentPackage, intake: opened.intake, reused: Boolean(result?.reused) });
        return;
      }
    }
    response.status(202).json({ job: queued.job, intake: opened.intake, reused: queued.reused });
  }),
);
}

export function registerPackageHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/stories/:storyId/packages",
  asyncRoute(async (request, response) => {
    const storyId = routeParam(request.params.storyId);
    const requestedMode = typeof request.body?.mode === "string" ? request.body.mode : undefined;
    if (requestedMode && !draftableAssignmentModes.has(requestedMode as Exclude<AssignmentMode, "watch" | "skip">)) {
      response.status(400).json({ error: "请选择可成稿的稿型" });
      return;
    }
    const story = storyById(await runtime.readState(), storyId);
    if (!story) {
      response.status(404).json({ error: "Story 不存在" });
      return;
    }
    if (!story.assignment.canDraft) {
      response.status(409).json({
        error: story.assignment.blockers[0] || "这条事件还不满足素材包建立条件",
      });
      return;
    }
    const mode = requestedMode as Exclude<AssignmentMode, "watch" | "skip"> | undefined;
    const force = request.body?.force === true;
    await runtime.updateState((state) => retainStoryForWriting(state, storyId));
    const database = await runtime.getLocalDatabase();
    const assetRevision = createHash("sha256")
      .update(JSON.stringify(story.images.map((image) => [
        image.id,
        image.localPath,
        image.fingerprint,
        image.rights,
        image.editorialPriority,
      ])))
      .digest("hex")
      .slice(0, 16);
    const queued = database.enqueueJob({
      type: "build-content-package",
      idempotencyKey: force
        ? `build-content-package:refresh:${storyId}:${randomUUID()}`
        : `build-content-package:${storyId}:${mode ?? story.assignment.mode}:${story.lastSeenAt}:${assetRevision}`,
      payload: { storyId, storyTitle: story.title, mode, minimumImages: force ? 4 : 2 },
      maxAttempts: 2,
    });
    if (queued.job.status === "complete") {
      const packageId = (queued.job.result as { packageId?: string } | undefined)?.packageId;
      const contentPackage = packageId ? database.getContentPackage<ContentPackage>(packageId) : undefined;
      if (contentPackage) {
        response.json({ job: queued.job, contentPackage, reused: true });
        return;
      }
    }
    response.status(202).json({ job: queued.job, reused: queued.reused });
  }),
);

app.get(
  "/api/packages/:packageId",
  asyncRoute(async (request, response) => {
    const contentPackage = (await runtime.getLocalDatabase()).getContentPackage<ContentPackage>(routeParam(request.params.packageId));
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
    const database = await runtime.getLocalDatabase();
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
      const draft = result?.draftId ? (await runtime.readState()).drafts.find((entry) => entry.id === result.draftId) : undefined;
      if (draft) {
        response.json({ job: queued.job, draft, reused: Boolean(result?.reused) });
        return;
      }
    }
    response.status(202).json({ job: queued.job, reused: queued.reused });
  }),
);

app.post(
  "/api/packages/:packageId/human-draft",
  asyncRoute(async (request, response) => {
    const packageId = routeParam(request.params.packageId);
    const result = await createHumanDraftFromPackage(packageId);
    response.status(result.reused ? 200 : 201).json(result);
  }),
);
}

export const packageHttpRouteRegistrars = [registerPackageHttpRoutes1, registerPackageHttpRoutes2] as const;
