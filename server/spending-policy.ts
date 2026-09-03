import type { AiProviderConfig, AiSettings, Settings, SourceConfig } from "./types.js";

export type SpendingPolicy = Settings["spendingPolicy"];

type SpendingPolicyState = {
  settings: Pick<Settings, "spendingPolicy">;
  aiSettings: Pick<
    AiSettings,
    "activeProviderId" | "completionProviderId" | "analysisProviderId" | "optimizationProviderId" | "providers"
  >;
  sources: Array<Pick<SourceConfig, "id" | "kind" | "enabled" | "selected">>;
};

export const meteredAutomationAllowed = (state: Pick<SpendingPolicyState, "settings">) =>
  state.settings.spendingPolicy === "allow-metered";

const isGeminiProvider = (provider: Pick<AiProviderConfig, "id" | "name">) =>
  provider.id === "gemini" || /gemini/iu.test(provider.name);

export const assertMeteredProviderAllowed = (
  state: Pick<SpendingPolicyState, "settings">,
  provider: Pick<AiProviderConfig, "id" | "kind" | "name">,
) => {
  if (!isGeminiProvider(provider) || meteredAutomationAllowed(state)) return;
  throw new Error(`X / Gemini 零新增支出模式已阻止 ${provider.name} 的 API 调用；请改用 Gemini 网页协作，或明确开启 X / Gemini API`);
};

export const assertMeteredSourceAllowed = (
  state: Pick<SpendingPolicyState, "settings">,
  source: Pick<SourceConfig, "kind" | "name">,
) => {
  if (source.kind !== "x" || meteredAutomationAllowed(state)) return;
  throw new Error(`X / Gemini 零新增支出模式已阻止 ${source.name} 的 X API 调用；请改用 X 列表通知和手动粘贴原帖`);
};

/**
 * Applies the user-owned spending boundary in one state transition. Entering
 * zero-cost mode is deliberately narrow: it disables X and Gemini API calls,
 * while preserving DeepSeek, Qwen and other provider choices.
 */
export const applySpendingPolicy = (
  state: SpendingPolicyState,
  policy: SpendingPolicy,
): { disabledXSourceCount: number; completionDisabled: boolean } => {
  if (policy === "allow-metered") {
    state.settings.spendingPolicy = policy;
    return { disabledXSourceCount: 0, completionDisabled: false };
  }

  const codex = state.aiSettings.providers.find((provider) => provider.kind === "codex-cli");
  if (!codex) throw new Error("X / Gemini 零新增支出模式需要本机 Codex 作为 Gemini 的安全回退，但当前配置中没有 Codex Provider");
  const providerById = (providerId: string) => state.aiSettings.providers.find((provider) => provider.id === providerId);
  const completionDisabled = Boolean(
    state.aiSettings.completionProviderId
    && isGeminiProvider(providerById(state.aiSettings.completionProviderId) ?? { id: state.aiSettings.completionProviderId, name: state.aiSettings.completionProviderId }),
  );
  let disabledXSourceCount = 0;
  for (const source of state.sources) {
    if (source.kind !== "x" || (!source.enabled && !source.selected)) continue;
    source.enabled = false;
    source.selected = false;
    disabledXSourceCount += 1;
  }
  state.settings.spendingPolicy = "zero-cost";
  if (isGeminiProvider(providerById(state.aiSettings.activeProviderId) ?? { id: state.aiSettings.activeProviderId, name: state.aiSettings.activeProviderId })) {
    state.aiSettings.activeProviderId = codex.id;
  }
  if (isGeminiProvider(providerById(state.aiSettings.analysisProviderId) ?? { id: state.aiSettings.analysisProviderId, name: state.aiSettings.analysisProviderId })) {
    state.aiSettings.analysisProviderId = codex.id;
  }
  if (isGeminiProvider(providerById(state.aiSettings.optimizationProviderId) ?? { id: state.aiSettings.optimizationProviderId, name: state.aiSettings.optimizationProviderId })) {
    state.aiSettings.optimizationProviderId = codex.id;
  }
  if (completionDisabled) state.aiSettings.completionProviderId = "";
  return { disabledXSourceCount, completionDisabled };
};
