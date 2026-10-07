import type { Express, RequestHandler } from "express";
import type { createDeliveryBatchDesk } from "./delivery-batch-desk.js";
import { selectedDeliveryPlatforms, type DeliveryPlatform } from "./delivery-batch-types.js";
import type { WorkflowState } from "./types.js";

const route = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  void Promise.resolve(handler(request, response, next)).catch(error => response.status(400).json({ error: error instanceof Error ? error.message : "交付未完成" }));
};

export const registerDeliveryBatchRoutes = (app: Express, dependencies: {
  desk: ReturnType<typeof createDeliveryBatchDesk>;
  read: () => Promise<WorkflowState>;
  open: (platforms: DeliveryPlatform[], state: WorkflowState) => Promise<void>;
}) => {
  app.get("/api/drafts/:draftId/delivery-batches", route(async (request, response) => {
    const view = await dependencies.desk.view(String(request.params.draftId));
    if (!view) { response.status(404).json({ error: "草稿不存在" }); return; }
    response.json(view);
  }));
  app.get("/api/drafts/:draftId/delivery-connections", route(async (request, response) => {
    const platforms = await dependencies.desk.connections(String(request.params.draftId));
    if (!platforms) { response.status(404).json({ error: "草稿不存在" }); return; }
    response.json(platforms);
  }));
  app.post("/api/drafts/:draftId/delivery-batches", route(async (request, response) => {
    const result = await dependencies.desk.start(String(request.params.draftId), request.body?.platforms, String(request.body?.updatedAt ?? ""), typeof request.body?.retryOf === "string" ? request.body.retryOf : undefined, request.body?.accountBindings);
    response.json(result);
    void dependencies.desk.tick().catch(() => undefined);
  }));
  app.post("/api/drafts/:draftId/delivery-batches/:batchId/cancel", route(async (request, response) => {
    response.json(await dependencies.desk.cancel(String(request.params.draftId), String(request.params.batchId)));
  }));
  app.post("/api/delivery/batch/open", route(async (request, response) => {
    await dependencies.open(selectedDeliveryPlatforms(request.body?.platforms), await dependencies.read());
    response.json({ detail: "已打开所选平台，直接复用 Chrome 中的登录状态" });
  }));
};
