import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute } from "./http-route-support.js";
import { readDraftReference } from "./draft-reference-reader.js";

export const registerDraftReferenceRoutes = (
  app: Express,
  runtime: Pick<HttpRouteRuntime, "readState">,
  read = readDraftReference,
) => {
  app.post("/api/drafts/:draftId/references/read", asyncRoute(async (request, response) => {
    if (!(await runtime.readState()).drafts.some(draft => draft.id === request.params.draftId)) { response.status(404).json({ error: "草稿不存在" }); return; }
    const url = request.body?.url;
    if (typeof url !== "string" || url.length > 4096) { response.status(400).json({ error: "请填写有效的网页链接" }); return; }
    try { response.json(await read(url)); }
    catch (error) { response.status(422).json({ error: error instanceof Error ? error.message : "原文读取失败" }); }
  }));
};
