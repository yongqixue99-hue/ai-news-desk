import express from "express";
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
import { asyncRoute } from "./http-route-support.js";

export function registerDataHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/data/export",
  asyncRoute(async (_request, response) => {
    const backup = createWorkflowBackup(await runtime.readState());
    const date = backup.exportedAt.slice(0, 10);
    response.setHeader("content-disposition", `attachment; filename=ai-news-desk-${date}.json`);
    response.json(backup);
  }),
);

app.get(
  "/api/data/archive",
  asyncRoute(async (_request, response) => {
    const database = await runtime.getLocalDatabase();
    const archive = await createPortableWorkflowArchive({
      workflowRoot,
      database,
      state: await runtime.readState(),
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
      const confirmation = runtime.portableArchiveImportConfirmations.issue({
        archiveSha256: preview.archiveSha256,
        workspaceChecksum: checksumForState(await runtime.readState()),
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
          confirmArchive: async (archiveSha256) => runtime.portableArchiveImportConfirmations.claim(
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
    const database = await runtime.getLocalDatabase();
    await createPortableWorkflowArchive({
      workflowRoot,
      database,
      state: await runtime.readState(),
    });
    const restored = await runtime.replaceState(verified.state);
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
}

export const dataHttpRouteRegistrars = [registerDataHttpRoutes1] as const;
