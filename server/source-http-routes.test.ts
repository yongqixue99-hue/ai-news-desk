import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { createDefaultState } from "./defaults.js";
import { sourceHttpRouteRegistrars } from "./source-http-routes.js";
import { inMemoryHttpRuntime, registeredHttpRoutes, withHttpRouteServer, type RouteSpec } from "./http-route-test-support.js";

test("source HTTP registration preserves method/path order without reading runtime services", async () => {
 const state=createDefaultState(), original=structuredClone(state);
 const {runtime,touched}=inMemoryHttpRuntime(state),app=express();
 for(const register of sourceHttpRouteRegistrars)register(app,runtime);
 const baseline=JSON.parse(await readFile("docs/architecture/http-route-baseline.json","utf8")) as Array<RouteSpec & {domain:string}>;
 assert.deepEqual(registeredHttpRoutes(app),baseline.filter(item=>item.domain==="source").map(({method,path})=>({method,path})));
 assert.deepEqual(touched,[]);
 assert.deepEqual(state,original);
});

test("source routes retain validation and read responses without touching a database or account",async()=>{
 const state=createDefaultState(),original=structuredClone(state);
 const {runtime,touched}=inMemoryHttpRuntime(state),app=express();app.use(express.json());
 for(const register of sourceHttpRouteRegistrars)register(app,runtime);
 await withHttpRouteServer(app,async origin=>{
  const unknown=await fetch(origin+"/api/topic-feeds/not-a-platform");
  assert.equal(unknown.status,404);assert.deepEqual(await unknown.json(),{error:"未知选题分类"});
  const presets=await fetch(origin+"/api/source-presets");
  assert.equal(presets.status,200);assert.deepEqual(await presets.json(),state.sourcePresets);
  const missing=await fetch(origin+"/api/source-presets/missing-example",{method:"DELETE"});
  assert.equal(missing.status,404);
 });
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});

