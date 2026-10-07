import assert from "node:assert/strict";
import test from "node:test";
import type { Express, Request, Response, RequestHandler } from "express";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { createDeliveryBatchDesk, type DeliveryDriver } from "./delivery-batch-desk.js";
import { registerDeliveryBatchRoutes } from "./delivery-batch-routes.js";
import { deliveryPlatforms, type DeliveryPlatform, type DeliveryBatchView } from "./delivery-batch-types.js";

const fixture = () => {
  const state = createDefaultState(), draft = createBlankDraftInState(state);
  const drivers = {} as Record<DeliveryPlatform, DeliveryDriver>;
  for (const { id } of deliveryPlatforms) drivers[id] = {
    revision: () => "revision", inspect: async () => ({ ready: true, detail: "已连接" }),
    deliver: async () => ({ status: "verified", detail: "已核对" }), recover: async () => undefined,
  };
  const read = async () => structuredClone(state), open = async () => undefined;
  const desk = createDeliveryBatchDesk({ read, update: async mutate => mutate(state), drivers, open });
  const handlers = new Map<string, RequestHandler>();
  const app = { get: (url: string, handler: RequestHandler) => handlers.set(url, handler), post: () => undefined } as unknown as Express;
  registerDeliveryBatchRoutes(app, { desk, read, open });
  const get = <T = DeliveryBatchView>(url: string, draftId = draft.id) => {
    let finished = false, code = 200;
    const response = new Promise<{ code: number; body: T }>(resolve => {
      const result = { status: (status: number) => { code = status; return result; }, json: (body: T) => { finished = true; resolve({ code, body }); } };
      const handler = handlers.get(url); assert.ok(handler, `${url} must be registered`);
      handler({ params: { draftId } } as unknown as Request, result as unknown as Response, error => { throw error; });
    });
    return { response, finished: () => finished };
  };
  return { state, draft, drivers, desk, get };
};

test("delivery progress reads durable receipts without waiting for platform authentication", async () => {
  const f = fixture(); let release!: () => void, inspections = 0;
  const slow = new Promise<void>(resolve => { release = resolve; });
  f.drivers.zhihu.inspect = async () => { inspections++; await slow; return { ready: true, detail: "迟到的账号检测" }; };
  await f.desk.start(f.draft.id, ["wechat"], f.draft.updatedAt);
  await f.desk.tick();
  const reading = f.get("/api/drafts/:draftId/delivery-batches");
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    assert.equal(reading.finished(), true, "a slow unrelated platform must not hide a completed delivery");
    const { code, body } = await reading.response;
    assert.equal(code, 200); assert.equal(body.batches[0].targets[0].status, "verified");
    assert.equal(inspections, 0, "progress polling must not start another authentication read");
  } finally { release(); await reading.response; }
});

test("live account checks use their own endpoint and a failed platform does not hide other connections", async () => {
  const f = fixture();
  f.drivers.zhihu.inspect = async () => { throw new Error("auth offline"); };
  const { code, body } = await f.get<DeliveryBatchView["platforms"]>("/api/drafts/:draftId/delivery-connections").response;
  assert.equal(code, 200); assert.equal(body.length, 5);
  assert.equal(body.find(platform => platform.id === "wechat")?.ready, true);
  assert.equal(body.find(platform => platform.id === "zhihu")?.ready, false);
});

test("missing drafts return 404 from both progress and account endpoints", async () => {
  const f = fixture();
  for (const endpoint of ["delivery-batches", "delivery-connections"]) {
    assert.equal((await f.get(`/api/drafts/:draftId/${endpoint}`, "missing").response).code, 404);
  }
});
