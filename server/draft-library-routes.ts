import type { Express } from "express";
import { createBlankDraftInState, draftTrashSummaries, restoreDraftFromTrashInState, restoreTrashedDraftsInState, trashDraftsInState } from "./draft-library.js";
import { readState, updateState } from "./storage.js";

export const registerDraftLibraryRoutes = (app: Express) => {
  app.post("/api/drafts", async (_request, response) => {
    response.status(201).json(await updateState(createBlankDraftInState));
  });
  app.get("/api/draft-trash", async (_request, response) => {
    response.json(draftTrashSummaries(await readState()));
  });
  app.post("/api/draft-trash", async (request, response) => {
    try {
      response.json(await updateState(state => trashDraftsInState(state, request.body?.drafts)));
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : "删除失败，请重试" });
    }
  });
  app.post("/api/draft-trash/:draftId/restore", async (request, response) => {
    try {
      response.json(await updateState(state => restoreDraftFromTrashInState(state, String(request.params.draftId))));
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : "恢复失败，请重试" });
    }
  });
  app.post("/api/draft-trash/restore", async (request, response) => {
    try {
      response.json(await updateState(state => restoreTrashedDraftsInState(state, request.body?.drafts)));
    } catch (error) {
      response.status(409).json({ error: error instanceof Error ? error.message : "恢复失败，请重试" });
    }
  });
};
