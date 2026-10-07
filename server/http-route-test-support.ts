import type { Express } from "express";
import { once } from "node:events";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import type { WorkflowState } from "./types.js";

export type RouteSpec = { method: string; path: string };
export const registeredHttpRoutes = (app: Express): RouteSpec[] => {
 const layers = app.router.stack as Array<{ route?: { path: string; stack: Array<{ method?: string }> } }>;
 return layers.flatMap(layer => layer.route ? [...new Set(layer.route.stack.flatMap(handler => handler.method ? [handler.method] : []))].map(method => ({ method, path: layer.route!.path })) : []);
};

export const inMemoryHttpRuntime = (state: WorkflowState) => {
 const touched: string[] = [];
 const unavailable = (name: string): never => { touched.push(name); throw new Error("Unexpected external service: " + name); };
 const runtime: HttpRouteRuntime = {
  readState: async () => structuredClone(state),
  readStateProjection: async select => structuredClone(select(state)),
  updateState: async mutate => await mutate(state),
  replaceState: async next => { Object.assign(state, structuredClone(next)); return structuredClone(state); },
  getLocalDatabase: async () => unavailable("database"),
  get deliveryDesk() { return unavailable("deliveryDesk"); },
  get zhihuHotlist() { return unavailable("zhihuHotlist"); },
  get wechatDelivery() { return unavailable("wechatDelivery"); },
  get portableArchiveImportConfirmations() { return unavailable("portableArchiveImportConfirmations"); },
  get backfillTodayTitles() { return unavailable("backfillTodayTitles"); },
  get xiaoheiheDelivery() { return unavailable("xiaoheiheDelivery"); },
 };
 return { runtime, touched };
};

export async function withHttpRouteServer(app: Express, verify: (origin: string) => Promise<void>) {
 const server = app.listen(0, "127.0.0.1");
 await once(server, "listening");
 try {
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing temporary HTTP address");
  await verify("http://127.0.0.1:" + address.port);
 } finally {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
 }
}

