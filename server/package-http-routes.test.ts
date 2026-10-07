import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { createDefaultState } from "./defaults.js";
import { packageHttpRouteRegistrars } from "./package-http-routes.js";
import { inMemoryHttpRuntime, registeredHttpRoutes, withHttpRouteServer, type RouteSpec } from "./http-route-test-support.js";

test("package HTTP registration preserves method/path order without reading runtime services", async () => {
 const state=createDefaultState(),original=structuredClone(state);
 const {runtime,touched}=inMemoryHttpRuntime(state),app=express();
 for(const register of packageHttpRouteRegistrars)register(app,runtime);
 const baseline=JSON.parse(await readFile("docs/architecture/http-route-baseline.json","utf8")) as Array<RouteSpec & {domain:string}>;
 assert.deepEqual(registeredHttpRoutes(app),baseline.filter(item=>item.domain==="package").map(({method,path})=>({method,path})));
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});

test("package routes preserve validation and responses without external services",async()=>{
 const state=createDefaultState();state.runs=[];state.drafts=[];state.notifications=[];
 const original=structuredClone(state),{runtime,touched}=inMemoryHttpRuntime(state),app=express();app.use(express.json());
 for(const register of packageHttpRouteRegistrars)register(app,runtime);
 await withHttpRouteServer(app,async origin=>{
  {
   const response=await fetch(origin+"/api/stories/missing-example/packages",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   assert.equal(response.status,404);
   assert.deepEqual(await response.json(),{error:"Story 不存在"});
  }
  {
   const response=await fetch(origin+"/api/stories/missing-example/packages",{method:"POST",headers:{"content-type":"application/json"},body:"{\"mode\": \"watch\"}"});
   assert.equal(response.status,400);
   assert.deepEqual(await response.json(),{error:"请选择可成稿的稿型"});
  }
 });
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});
