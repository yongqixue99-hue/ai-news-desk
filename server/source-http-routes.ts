import { createHash, randomUUID } from "node:crypto";
import { validateRemoteUrl } from "./remote-url.js";
import {
  applySourcePreset,
  batchUpdateSources,
  createSourcePreset,
  deleteSourcePreset,
} from "./source-management.js";
import { applySourceProbeResult, probeSource } from "./source-probe.js";
import {
  deleteProviderApiKey,
  deleteXBearerToken,
  deleteWeChatAppSecret,
  getXBearerToken,
  getWeChatAppSecret,
  setProviderApiKey,
  setXBearerToken,
  setWeChatAppSecret,
} from "./secrets.js";
import { readXCredentialStatus } from "./x-credentials.js";
import { accountsForXSource } from "./x-official.js";
import {
  getLocalDatabase,
  readState,
  readStateProjection,
  replaceState,
  runStorageExclusive,
  updateState,
  workflowMaterialsRoot,
  workflowJobsRoot,
  workflowMediaRoot,
  workflowRoot,
} from "./storage.js";
import { normalizeTopicIds } from "./topics.js";
import { sourceRoleFor } from "./source-routing.js";
import { buildFocusedNewsSearchRequest, buildTopicFeed, communityPlatforms, createZhihuHotlist, retainZhihuTopic } from "./source-desk.js";
import {
  applySpendingPolicy,
  assertMeteredProviderAllowed,
  assertMeteredSourceAllowed,
} from "./spending-policy.js";
import type {
  AiProviderConfig,
  ArticleAgentDraftInput,
  ArticleAgentRole,
  ArticleDraft,
  CandidateFeedbackKind,
  CollectionRequest,
  DraftSaveMode,
  EditorialProfile,
  ImageMaterial,
  Settings,
  SourceConfig,
  SourcePreset,
} from "./types.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute, sourceKinds, sourceRoles } from "./http-route-support.js";

export function registerSourceHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/topic-feeds/:platform",
  asyncRoute(async (request, response) => {
    const platform = communityPlatforms.find((value) => value === request.params.platform);
    if (!platform) { response.status(404).json({ error: "未知选题分类" }); return; }
    response.json(buildTopicFeed(await runtime.readState(), platform, platform === "zhihu" ? await runtime.zhihuHotlist.read() : undefined));
  }),
);

app.post(
  "/api/topic-feeds/zhihu/refresh",
  asyncRoute(async (_request, response) => {
    const hot = await runtime.zhihuHotlist.refresh();
    response.json(buildTopicFeed(await runtime.readState(), "zhihu", hot));
  }),
);

app.post(
  "/api/topic-feeds/zhihu/:questionId/select",
  asyncRoute(async (request, response) => {
    const snapshot = await runtime.zhihuHotlist.read();
    const item = snapshot.items.find((entry) => entry.id === request.params.questionId);
    if (!item || !snapshot.capturedAt) { response.status(404).json({ error: "该选题不在已读取榜单中，请重新读取榜单。" }); return; }
    const capturedAt = snapshot.capturedAt;
    const ref = await runtime.updateState((state) => retainZhihuTopic(state, item, capturedAt));
    response.json(ref);
  }),
);
}

export function registerSourceHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.get(
  "/api/x/status",
  asyncRoute(async (_request, response) => {
    response.json(await readXCredentialStatus({ getBearerToken: getXBearerToken }));
  }),
);

app.put(
  "/api/x/token",
  asyncRoute(async (request, response) => {
    const bearerToken = typeof request.body?.bearerToken === "string"
      ? request.body.bearerToken.trim()
      : "";
    if (bearerToken.length < 16) {
      response.status(400).json({ error: "X API Bearer Token 格式不正确" });
      return;
    }
    const hint = await setXBearerToken(bearerToken);
    response.json({ configured: true, hint });
  }),
);

app.delete(
  "/api/x/token",
  asyncRoute(async (_request, response) => {
    await deleteXBearerToken();
    response.json({ configured: false });
  }),
);
}

export function registerSourceHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.post(
  "/api/sources",
  asyncRoute(async (request, response) => {
    const body = request.body as Partial<SourceConfig>;
    if (!body.name?.trim() || !body.kind) {
      response.status(400).json({ error: "新闻源名称和类型不能为空" });
      return;
    }
    if (!sourceKinds.has(body.kind)) {
      response.status(400).json({ error: "不支持的新闻源类型" });
      return;
    }
    const spendingState = await runtime.readState();
    assertMeteredSourceAllowed(spendingState, { kind: body.kind, name: body.name.trim() });
    if (body.kind === "rss" && !body.url) {
      response.status(400).json({ error: "RSS 新闻源必须填写地址" });
      return;
    }
    if (body.kind === "x" && !accountsForXSource(body).length) {
      response.status(400).json({ error: "X 官方来源必须填写至少一个有效账号，例如 OpenAI" });
      return;
    }
    for (const candidateUrl of [body.homepageUrl, body.url]) {
      if (!candidateUrl) continue;
      try {
        await validateRemoteUrl(candidateUrl.trim());
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    const source: SourceConfig = {
      id: `source_${randomUUID().slice(0, 8)}`,
      name: body.name.trim(),
      kind: body.kind,
      homepageUrl: body.homepageUrl?.trim() || (body.kind === "x" ? "https://x.com/" : undefined),
      url: body.url?.trim(),
      query: body.query?.trim(),
      topicIds: normalizeTopicIds(body.topicIds),
      enabled: true,
      selected: true,
      category: body.category?.trim() || "ai-news",
      role: body.kind === "x" ? "official" : sourceRoles.has(body.role ?? "") ? body.role : undefined,
      discoveryOnly: body.kind === "x" ? false : Boolean(body.discoveryOnly),
      note: body.note?.trim(),
    };
    source.role ??= sourceRoleFor(source);
    await runtime.updateState((state) => state.sources.push(source));
    response.status(201).json(source);
  }),
);

app.patch(
  "/api/sources/batch",
  asyncRoute(async (request, response) => {
    const sourceIds: string[] = Array.isArray(request.body?.sourceIds)
      ? [...new Set<string>((request.body.sourceIds as unknown[]).filter((sourceId): sourceId is string =>
        typeof sourceId === "string" && sourceId.trim().length > 0))].slice(0, 200)
      : [];
    const patch = {
      ...(typeof request.body?.enabled === "boolean" ? { enabled: request.body.enabled } : {}),
      ...(typeof request.body?.selected === "boolean" ? { selected: request.body.selected } : {}),
    };
    if (!sourceIds.length) {
      response.status(400).json({ error: "请至少选择一个新闻源" });
      return;
    }
    if (patch.enabled === undefined && patch.selected === undefined) {
      response.status(400).json({ error: "批量操作必须指定启用状态或默认采集状态" });
      return;
    }
    const spendingState = await runtime.readState();
    if (patch.enabled === true || patch.selected === true) {
      for (const source of spendingState.sources.filter((entry) => sourceIds.includes(entry.id))) {
        assertMeteredSourceAllowed(spendingState, source);
      }
    }
    const sources = await runtime.updateState((state) => batchUpdateSources(state, sourceIds, patch));
    response.json({ sources, updated: sources.length });
  }),
);

app.patch(
  "/api/sources/:sourceId",
  asyncRoute(async (request, response) => {
    const currentState = await runtime.readState();
    const existing = currentState.sources.find((entry) => entry.id === request.params.sourceId);
    if (!existing) {
      response.status(404).json({ error: "新闻源不存在" });
      return;
    }
    const body = request.body as Partial<SourceConfig>;
    const allowedKeys = [
      "name",
      "kind",
      "homepageUrl",
      "url",
      "query",
      "topicIds",
      "enabled",
      "selected",
      "category",
      "role",
      "discoveryOnly",
      "note",
    ] as const;
    const patch: Partial<SourceConfig> = {};
    for (const key of allowedKeys) {
      if (body[key] !== undefined) (patch[key] as unknown) = body[key];
    }
    const nextKind = patch.kind ?? existing.kind;
    if (!sourceKinds.has(nextKind)) {
      response.status(400).json({ error: "不支持的新闻源类型" });
      return;
    }
    const nextUrl = typeof patch.url === "string" ? patch.url.trim() : existing.url;
    if (nextKind === "rss" && !nextUrl && !existing.routes?.some((route) => route.url || route.query)) {
      response.status(400).json({ error: "RSS 新闻源必须填写地址" });
      return;
    }
    const nextQuery = typeof patch.query === "string" ? patch.query.trim() : existing.query;
    if (nextKind === "x" && !accountsForXSource({ query: nextQuery }).length) {
      response.status(400).json({ error: "X 官方来源必须填写至少一个有效账号，例如 OpenAI" });
      return;
    }
    const nextHomepageUrl = typeof patch.homepageUrl === "string"
      ? patch.homepageUrl.trim()
      : existing.homepageUrl;
    for (const candidateUrl of [patch.url !== undefined ? nextUrl : undefined, patch.homepageUrl !== undefined ? nextHomepageUrl : undefined]) {
      if (!candidateUrl) continue;
      try {
        await validateRemoteUrl(candidateUrl);
      } catch (error) {
        response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
        return;
      }
    }
    if (patch.url !== undefined) patch.url = nextUrl;
    if (patch.homepageUrl !== undefined) patch.homepageUrl = nextHomepageUrl;
    if (typeof patch.name === "string") patch.name = patch.name.trim();
    if (typeof patch.query === "string") patch.query = patch.query.trim();
    if (patch.topicIds !== undefined) patch.topicIds = normalizeTopicIds(patch.topicIds);
    if (typeof patch.category === "string") patch.category = patch.category.trim();
    if (patch.role !== undefined && !sourceRoles.has(patch.role)) {
      response.status(400).json({ error: "不支持的来源分类" });
      return;
    }
    if (nextKind === "x") {
      if (patch.enabled === true || patch.selected === true) {
        assertMeteredSourceAllowed(currentState, { kind: nextKind, name: existing.name });
      }
      patch.role = "official";
      patch.discoveryOnly = false;
      if (!nextHomepageUrl) patch.homepageUrl = "https://x.com/";
    }
    if (typeof patch.note === "string") patch.note = patch.note.trim();
    const source = await runtime.updateState((state) => {
      const target = state.sources.find((entry) => entry.id === request.params.sourceId);
      if (!target) return undefined;
      Object.assign(target, patch, { id: target.id });
      return target;
    });
    if (!source) response.status(404).json({ error: "新闻源不存在" });
    else response.json(source);
  }),
);

app.post(
  "/api/sources/:sourceId/test",
  asyncRoute(async (request, response) => {
    const current = await runtime.readState();
    const source = current.sources.find((entry) => entry.id === request.params.sourceId);
    if (!source) {
      response.status(404).json({ error: "新闻源不存在" });
      return;
    }
    assertMeteredSourceAllowed(current, source);
    const result = await probeSource(source);
    const updated = await runtime.updateState((state) => {
      const target = state.sources.find((entry) => entry.id === request.params.sourceId);
      return target ? applySourceProbeResult(target, result) : undefined;
    });
    if (!updated) response.status(404).json({ error: "新闻源已被删除" });
    else response.json({ source: updated, result });
  }),
);

app.delete(
  "/api/sources/:sourceId",
  asyncRoute(async (request, response) => {
    const removed = await runtime.updateState((state) => {
      const index = state.sources.findIndex((entry) => entry.id === request.params.sourceId);
      if (index < 0) return false;
      state.sources.splice(index, 1);
      state.sourcePresets = state.sourcePresets.flatMap((preset) => {
        const sourceIds = preset.sourceIds.filter((sourceId) => sourceId !== request.params.sourceId);
        return sourceIds.length ? [{ ...preset, sourceIds }] : [];
      });
      return true;
    });
    response.status(removed ? 204 : 404).end();
  }),
);

app.get(
  "/api/source-presets",
  asyncRoute(async (_request, response) => {
    response.json((await runtime.readState()).sourcePresets);
  }),
);

app.post(
  "/api/source-presets",
  asyncRoute(async (request, response) => {
    const name = typeof request.body?.name === "string" ? request.body.name : "";
    const sourceIds = Array.isArray(request.body?.sourceIds)
      ? request.body.sourceIds.filter((sourceId: unknown): sourceId is string => typeof sourceId === "string").slice(0, 200)
      : [];
    try {
      const preset = await runtime.updateState((state) => createSourcePreset(state, { name, sourceIds }));
      response.status(201).json(preset);
    } catch (error) {
      response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }),
);

app.post(
  "/api/source-presets/:presetId/apply",
  asyncRoute(async (request, response) => {
    const presetId = Array.isArray(request.params.presetId)
      ? request.params.presetId[0]
      : request.params.presetId;
    try {
      const result = await runtime.updateState((state) => {
        applySourcePreset(state, presetId);
        const preset = state.sourcePresets.find((entry) => entry.id === presetId) as SourcePreset;
        return { preset, sources: state.sources };
      });
      response.json(result);
    } catch (error) {
      response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
    }
  }),
);

app.delete(
  "/api/source-presets/:presetId",
  asyncRoute(async (request, response) => {
    const presetId = Array.isArray(request.params.presetId)
      ? request.params.presetId[0]
      : request.params.presetId;
    const removed = await runtime.updateState((state) => deleteSourcePreset(state, presetId));
    response.status(removed ? 204 : 404).end();
  }),
);
}

export const sourceHttpRouteRegistrars = [registerSourceHttpRoutes1, registerSourceHttpRoutes2, registerSourceHttpRoutes3] as const;
