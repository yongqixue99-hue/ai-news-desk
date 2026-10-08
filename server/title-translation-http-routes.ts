import type { Express } from "express";
import type { LocalDatabase } from "./local-database.js";
import type { WorkflowState } from "./types.js";
import { buildAggregationView } from "./aggregation-desk.js";
import { createAggregationTitleTranslationDesk, TitleTranslationError, type TitleTranslationDependencies } from "./aggregation-title-translations.js";
import { generateAggregationTitles } from "./title-translation-provider.js";
import { assertMeteredProviderAllowed } from "./spending-policy.js";
import { asyncRoute } from "./http-route-support.js";

interface Runtime {
  readState: () => Promise<WorkflowState>;
  getLocalDatabase: () => Promise<Pick<LocalDatabase, "getTitleTranslations" | "saveTitleTranslations">>;
}
export function registerAggregationTitleTranslationRoutes(app: Express, runtime: Runtime, generate: TitleTranslationDependencies["generate"] = generateAggregationTitles) {
  const desk = createAggregationTitleTranslationDesk({
    readView: async () => buildAggregationView(await runtime.readState()),
    readCache: async keys => (await runtime.getLocalDatabase()).getTitleTranslations(keys),
    writeCache: async records => { (await runtime.getLocalDatabase()).saveTitleTranslations(records); },
    provider: async () => {
      const state = await runtime.readState();
      const provider = state.aiSettings.providers.find(item => item.id === state.aiSettings.analysisProviderId)
        ?? state.aiSettings.providers.find(item => item.id === state.aiSettings.activeProviderId) ?? state.aiSettings.providers[0];
      if (!provider) throw new TitleTranslationError("请先配置分析模型", 409);
      try { assertMeteredProviderAllowed(state, provider); } catch (error) { throw new TitleTranslationError(error instanceof Error ? error.message : "当前费用设置阻止模型调用", 409); }
      return provider;
    }, generate,
  });
  app.get("/api/aggregations/title-translations", asyncRoute(async (_request, response) => {
    try { response.json(await desk.cached()); }
    catch { response.status(503).json({ error: "标题缓存暂不可读，原始列表仍可使用" }); }
  }));
  app.post("/api/aggregations/title-translations", asyncRoute(async (request, response) => {
    try {
      if (!request.body || typeof request.body !== "object" || Array.isArray(request.body) || Object.keys(request.body).join(",") !== "items") throw new TitleTranslationError("标题翻译请求格式不正确");
      response.json(await desk.translate(request.body.items));
    } catch (error) {
      response.status(error instanceof TitleTranslationError ? error.status : 502).json({ error: error instanceof Error ? error.message : "翻译未完成，可继续阅读原题" });
    }
  }));
}
