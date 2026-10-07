import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { createDefaultState } from "./defaults.js";
import { learningHttpRouteRegistrars } from "./learning-http-routes.js";
import { inMemoryHttpRuntime, registeredHttpRoutes, withHttpRouteServer, type RouteSpec } from "./http-route-test-support.js";

test("learning HTTP registration preserves method/path order without reading runtime services", async () => {
 const state=createDefaultState(),original=structuredClone(state);
 const {runtime,touched}=inMemoryHttpRuntime(state),app=express();
 for(const register of learningHttpRouteRegistrars)register(app,runtime);
 const baseline=JSON.parse(await readFile("docs/architecture/http-route-baseline.json","utf8")) as Array<RouteSpec & {domain:string}>;
 assert.deepEqual(registeredHttpRoutes(app),baseline.filter(item=>item.domain==="learning").map(({method,path})=>({method,path})));
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});

test("learning routes preserve validation and responses without external services",async()=>{
 const state=createDefaultState();state.runs=[];state.drafts=[];state.notifications=[];
 const original=structuredClone(state),{runtime,touched}=inMemoryHttpRuntime(state),app=express();app.use(express.json());
 for(const register of learningHttpRouteRegistrars)register(app,runtime);
 await withHttpRouteServer(app,async origin=>{
  {
   const response=await fetch(origin+"/api/notifications/missing-example/read",{method:"PATCH",headers:{"content-type":"application/json"},body:"{}"});
   assert.equal(response.status,404);
   assert.deepEqual(await response.json(),{error:"通知不存在"});
  }
  {
   const response=await fetch(origin+"/api/notifications/read-all",{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
   assert.equal(response.status,200);
   assert.deepEqual(await response.json(),[]);
   assert.match(response.headers.get("content-type")??"",/^application\/json/u);
  }
 });
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});
