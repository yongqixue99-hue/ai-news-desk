import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import express from "express";
import { createDefaultState } from "./defaults.js";
import { dataHttpRouteRegistrars } from "./data-http-routes.js";
import { inMemoryHttpRuntime, registeredHttpRoutes, withHttpRouteServer, type RouteSpec } from "./http-route-test-support.js";

test("data HTTP registration preserves method/path order without reading runtime services", async () => {
 const state=createDefaultState(),original=structuredClone(state);
 const {runtime,touched}=inMemoryHttpRuntime(state),app=express();
 for(const register of dataHttpRouteRegistrars)register(app,runtime);
 const baseline=JSON.parse(await readFile("docs/architecture/http-route-baseline.json","utf8")) as Array<RouteSpec & {domain:string}>;
 assert.deepEqual(registeredHttpRoutes(app),baseline.filter(item=>item.domain==="data").map(({method,path})=>({method,path})));
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});

test("data routes preserve validation and responses without external services",async()=>{
 const state=createDefaultState();state.runs=[];state.drafts=[];state.notifications=[];
 const original=structuredClone(state),{runtime,touched}=inMemoryHttpRuntime(state),app=express();app.use(express.json());
 for(const register of dataHttpRouteRegistrars)register(app,runtime);
 await withHttpRouteServer(app,async origin=>{
  {
   const response=await fetch(origin+"/api/data/export",{method:"GET"});
   assert.equal(response.status,200);
   const backup=await response.json();assert.deepEqual(backup.state,state);assert.match(backup.checksum,/^[a-f0-9]{64}$/u);assert.match(response.headers.get("content-disposition")??"",/^attachment; filename=ai-news-desk-\d{4}-\d{2}-\d{2}\.json$/u);
  }
 });
 assert.deepEqual(touched,[]);assert.deepEqual(state,original);
});
