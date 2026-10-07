import path from "node:path";
import { reapplyPersonalizationToRuns } from "./personalization.js";
import { probeProviderConnection } from "./provider-health.js";
import { officialPollInterval } from "./official-source-monitor.js";
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
import { importArticleSkill, readSkillInstructions } from "./skill-registry.js";
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
import { homeLayoutFor, parseHomeLayout } from "./home-layout.js";
import type { Express } from "express";
import type { HttpRouteRuntime } from "./http-route-runtime.js";
import { asyncRoute } from "./http-route-support.js";

export function registerSettingsHttpRoutes1(app: Express, runtime: HttpRouteRuntime): void {
app.patch(
  "/api/settings",
  asyncRoute(async (request, response) => {
    const allowed = request.body as Partial<Settings>;
    if (allowed.homeLayout !== undefined) {
      try { allowed.homeLayout = parseHomeLayout(allowed.homeLayout); }
      catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "栏目设置无效" }); return; }
    }
    if (allowed.spendingPolicy !== undefined
      && allowed.spendingPolicy !== "zero-cost"
      && allowed.spendingPolicy !== "allow-metered") {
      response.status(400).json({ error: "费用策略不正确" });
      return;
    }
    const settings = await runtime.updateState((state) => {
      const requestedSpendingPolicy = allowed.spendingPolicy;
      const next = {
        ...state.settings,
        ...allowed,
        // Publication history is write-protected and only changes through the
        // explicit "published successfully" confirmation endpoint.
        socialBridge: state.settings.socialBridge,
        recentTopics: state.settings.recentTopics,
        recentCommunities: state.settings.recentCommunities,
      };
      // Keep scheduled collection aligned with Today's 48-hour editorial
      // window so a late daily run cannot create an artificial blind spot.
      if (allowed.homeLayout !== undefined) next.homeLayout = parseHomeLayout(allowed.homeLayout);
      next.windowHours = 48;
      next.officialMonitorEnabled = next.officialMonitorEnabled !== false;
      next.officialMonitorIntervalMinutes = officialPollInterval(next.officialMonitorIntervalMinutes);
      next.lastOfficialPollAt = state.settings.lastOfficialPollAt;
      next.collectionTopics = normalizeTopicIds(next.collectionTopics);
      next.imageLimit = Math.max(0, Math.min(12, Number(next.imageLimit) || 0));
      next.autoGenerateCount = Math.max(1, Math.min(10, Number(next.autoGenerateCount) || 3));
      next.publisherMode = next.publisherMode === "cdp" ? "cdp" : "chrome-extension";
      next.personalizationEnabled = next.personalizationEnabled !== false;
      next.recommendationMode = next.recommendationMode === "balanced" ? "balanced" : "focused";
      for (const key of ["editorialProfileEnabled", "writingMemoryEnabled", "inlineCompletionEnabled"] as const) {
        next[key] = next[key] !== false;
      }
      next.notificationsMuted = next.notificationsMuted !== false;
      state.settings = next;
      if (requestedSpendingPolicy) applySpendingPolicy(state, requestedSpendingPolicy);
      if (typeof allowed.personalizationEnabled === "boolean") reapplyPersonalizationToRuns(state);
      return state.settings;
    });
    response.json(settings);
  }),
);
}

export function registerSettingsHttpRoutes2(app: Express, runtime: HttpRouteRuntime): void {
app.patch(
  "/api/ai/providers/:providerId",
  asyncRoute(async (request, response) => {
    const providerId = Array.isArray(request.params.providerId)
      ? request.params.providerId[0]
      : request.params.providerId;
    const current = await runtime.readState();
    const existing = current.aiSettings.providers.find((provider) => provider.id === providerId);
    if (!existing) {
      response.status(404).json({ error: "AI 厂商不存在" });
      return;
    }
    const body = request.body as Partial<AiProviderConfig> & {
      apiKey?: string;
      clearApiKey?: boolean;
      active?: boolean;
    };
    if (body.active) assertMeteredProviderAllowed(current, existing);
    let keyHint: string | undefined;
    if (typeof body.apiKey === "string" && body.apiKey.trim()) {
      keyHint = await setProviderApiKey(providerId, body.apiKey);
    } else if (body.clearApiKey && existing.kind !== "codex-cli") {
      await deleteProviderApiKey(providerId);
    }
    const aiSettings = await runtime.updateState((state) => {
      const provider = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("AI 厂商不存在");
      const nextModel = typeof body.model === "string" ? body.model.trim().slice(0, 120) : provider.model;
      const nextInlineCompletionModel = typeof body.inlineCompletionModel === "string"
        ? body.inlineCompletionModel.trim().slice(0, 120)
        : provider.inlineCompletionModel;
      const nextVisionModel = typeof body.visionModel === "string"
        ? body.visionModel.trim().slice(0, 120)
        : provider.visionModel;
      const nextBaseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim().slice(0, 500) : provider.baseUrl;
      const connectionConfigurationChanged = nextModel !== provider.model
        || nextInlineCompletionModel !== provider.inlineCompletionModel
        || nextVisionModel !== provider.visionModel
        || nextBaseUrl !== provider.baseUrl
        || Boolean(keyHint)
        || Boolean(body.clearApiKey);
      provider.model = nextModel;
      provider.inlineCompletionModel = nextInlineCompletionModel;
      provider.visionModel = nextVisionModel;
      provider.baseUrl = nextBaseUrl;
      if (keyHint) {
        provider.apiKeyConfigured = true;
        provider.apiKeyHint = keyHint;
      }
      if (body.clearApiKey && provider.kind !== "codex-cli") {
        provider.apiKeyConfigured = false;
        provider.apiKeyHint = undefined;
        if (state.aiSettings.activeProviderId === provider.id) state.aiSettings.activeProviderId = "codex-cli";
        if (state.aiSettings.analysisProviderId === provider.id) state.aiSettings.analysisProviderId = "codex-cli";
        if (state.aiSettings.optimizationProviderId === provider.id) state.aiSettings.optimizationProviderId = "codex-cli";
      }
      if (body.active) {
        if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
          throw new Error("请先配置这个厂商的 API Key");
        }
        if (!provider.model) throw new Error("请先填写模型名称");
        if (provider.kind === "openai-compatible" && !provider.baseUrl) throw new Error("请先填写 API Base URL");
        state.aiSettings.activeProviderId = provider.id;
      }
      if (connectionConfigurationChanged) delete state.aiSettings.latestProviderHealth[provider.id];
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

app.post(
  "/api/ai/providers/:providerId/test",
  asyncRoute(async (request, response) => {
    const providerId = Array.isArray(request.params.providerId)
      ? request.params.providerId[0]
      : request.params.providerId;
    const current = await runtime.readState();
    const provider = current.aiSettings.providers.find((entry) => entry.id === providerId);
    if (!provider) {
      response.status(404).json({ error: "AI 厂商不存在" });
      return;
    }

    assertMeteredProviderAllowed(current, provider);

    const result = await probeProviderConnection(provider);
    const aiSettings = await runtime.updateState((state) => {
      const target = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!target) return undefined;
      state.aiSettings.latestProviderHealth[providerId] = result;
      return state.aiSettings;
    });
    if (!aiSettings) response.status(404).json({ error: "AI 厂商已被删除" });
    else response.json({ result, aiSettings });
  }),
);

app.patch(
  "/api/ai/agent-roles",
  asyncRoute(async (request, response) => {
    const role = request.body?.role as ArticleAgentRole;
    const providerId = typeof request.body?.providerId === "string" ? request.body.providerId : "";
    if (!(["analysis", "optimization"] as string[]).includes(role) || !providerId) {
      response.status(400).json({ error: "文章 Agent 角色或模型不正确" });
      return;
    }
    const aiSettings = await runtime.updateState((state) => {
      const provider = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("AI 厂商不存在");
      assertMeteredProviderAllowed(state, provider);
      if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
        throw new Error("请先配置这个厂商的 API Key");
      }
      if (!provider.model) throw new Error("请先填写模型名称");
      if (provider.kind === "openai-compatible" && !provider.baseUrl) {
        throw new Error("请先填写 API Base URL");
      }
      if (role === "analysis") state.aiSettings.analysisProviderId = providerId;
      else state.aiSettings.optimizationProviderId = providerId;
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

app.patch(
  "/api/ai/writing-review",
  asyncRoute(async (request, response) => {
    const mode = request.body?.mode;
    if (!["auto", "minimal", "voice", "off"].includes(mode)) {
      response.status(400).json({ error: "写作审校模式不正确" });
      return;
    }
    const aiSettings = await runtime.updateState((state) => {
      state.aiSettings.writingReviewMode = mode;
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);

app.patch(
  "/api/ai/skills/:skillId",
  asyncRoute(async (request, response) => {
    const skills = await runtime.updateState((state) => {
      const skill = state.aiSettings.skills.find((entry) => entry.id === request.params.skillId);
      if (!skill) return undefined;
      if (request.body.enabled !== undefined) skill.enabled = Boolean(request.body.enabled);
      return state.aiSettings.skills;
    });
    if (!skills) response.status(404).json({ error: "Skill 不存在" });
    else response.json(skills);
  }),
);

app.post(
  "/api/ai/skills/import",
  asyncRoute(async (request, response) => {
    const rawPath = typeof request.body?.path === "string" ? request.body.path.trim() : "";
    if (!rawPath) {
      response.status(400).json({ error: "请填写 Skill 文件夹或 SKILL.md 路径" });
      return;
    }
    const imported = await importArticleSkill(rawPath);
    const skills = await runtime.updateState((state) => {
      const index = state.aiSettings.skills.findIndex((skill) => skill.id === imported.id);
      if (index >= 0) state.aiSettings.skills[index] = { ...imported, enabled: state.aiSettings.skills[index].enabled };
      else state.aiSettings.skills.push(imported);
      return state.aiSettings.skills;
    });
    response.status(201).json(skills);
  }),
);
}

export function registerSettingsHttpRoutes3(app: Express, runtime: HttpRouteRuntime): void {
app.patch(
  "/api/ai/completion-provider",
  asyncRoute(async (request, response) => {
    const providerId = typeof request.body?.providerId === "string" ? request.body.providerId : "";
    if (!providerId) {
      response.status(400).json({ error: "补全模型不正确" });
      return;
    }
    const aiSettings = await runtime.updateState((state) => {
      const provider = state.aiSettings.providers.find((entry) => entry.id === providerId);
      if (!provider) throw new Error("AI 厂商不存在");
      assertMeteredProviderAllowed(state, provider);
      if (provider.kind !== "openai-compatible") {
        throw new Error("Tab 补全需要低延迟 API；本机 Codex 登录适合长任务，不用于逐字补全");
      }
      if (!provider.apiKeyConfigured) throw new Error(`请先配置 ${provider.name} 的 API Key`);
      if (!(provider.inlineCompletionModel || provider.model).trim()) throw new Error("请先填写补全模型名称");
      if (!provider.baseUrl) throw new Error("请先填写 API Base URL");
      state.aiSettings.completionProviderId = provider.id;
      return state.aiSettings;
    });
    response.json(aiSettings);
  }),
);
}

export const settingsHttpRouteRegistrars = [registerSettingsHttpRoutes1, registerSettingsHttpRoutes2, registerSettingsHttpRoutes3] as const;
