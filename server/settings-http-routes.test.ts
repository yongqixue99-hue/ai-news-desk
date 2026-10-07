import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { createDefaultState } from "./defaults.js";
import { settingsHttpRouteRegistrars } from "./settings-http-routes.js";
import { inMemoryHttpRuntime, registeredHttpRoutes, withHttpRouteServer, type RouteSpec } from "./http-route-test-support.js";

test("settings HTTP registration preserves method/path order without reading runtime services", async () => {
 const state=createDefaultState(),original=structuredClone(state);
 const {runtime,touched}=inMemoryHttpRuntime(state),app=express();
 for(const register of settingsHttpRouteRegistrars)register(app,runtime);
 const baseline=JSON.parse(await readFile("docs/architecture/http-route-baseline.json","utf8")) as Array<RouteSpec & {domain:string}>;
 assert.deepEqual(registeredHttpRoutes(app),baseline.filter(item=>item.domain==="settings").map(({method,path})=>({method,path})));
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});

test("settings routes preserve validation and responses without external services",async()=>{
 const state=createDefaultState();state.runs=[];state.drafts=[];state.notifications=[];
 const original=structuredClone(state),{runtime,touched}=inMemoryHttpRuntime(state),app=express();app.use(express.json());
 for(const register of settingsHttpRouteRegistrars)register(app,runtime);
 await withHttpRouteServer(app,async origin=>{
  {
   const response=await fetch(origin+"/api/ai/providers/missing-example",{method:"PATCH",headers:{"content-type":"application/json"},body:"{}"});
   assert.equal(response.status,404);
   assert.deepEqual(await response.json(),{error:"AI 厂商不存在"});
  }
  {
   const response=await fetch(origin+"/api/ai/providers/missing-example/test",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   assert.equal(response.status,404);
   assert.deepEqual(await response.json(),{error:"AI 厂商不存在"});
  }
 });
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});
