import type { Express } from "express";
import { buildCommunityView } from "./community-view.js";
import { readStateProjection } from "./storage.js";

export const registerCommunityRoutes = (app: Express) => {
  app.get("/api/community", async (_request, response, next) => {
    try { response.json(await readStateProjection((state, readArtifact) => buildCommunityView(state, undefined, readArtifact))); }
    catch (error) { next(error); }
  });
};
