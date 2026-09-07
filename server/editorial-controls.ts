import { assertMeteredProviderAllowed } from "./spending-policy.js";
import type { AiSettings, EditorialProfile, Settings, WorkflowState } from "./types.js";

/** User preferences organize prose; they never become factual evidence. */
export const editorialProfileForWriting = (state: Pick<WorkflowState, "settings" | "editorialSystem">): EditorialProfile | undefined => {
  if (state.settings.editorialProfileEnabled === false) return undefined;
  const profile = state.editorialSystem.profile;
  if (![profile.positioning, profile.audience, ...profile.goals, ...profile.voiceGuidelines, ...profile.redLines].some((value) => value.trim())) return undefined;
  return structuredClone(profile);
};

export interface CompletionAvailability {
  ready: boolean;
  reason: string;
  providerName?: string;
  model?: string;
}

/** Shared by the editor, strategy page and API, without making a paid probe. */
export const completionAvailability = (settings: Settings, aiSettings: AiSettings): CompletionAvailability => {
  const provider = aiSettings.providers.find((entry) => entry.id === aiSettings.completionProviderId);
  const meta = { providerName: provider?.name, model: provider?.inlineCompletionModel || provider?.model };
  if (settings.inlineCompletionEnabled === false) return { ...meta, ready: false, reason: "Tab 补全已关闭" };
  if (!provider || provider.kind !== "openai-compatible") return { ...meta, ready: false, reason: "请先在 AI 设置中选择一个 Tab 补全模型" };
  try { assertMeteredProviderAllowed({ settings }, provider); }
  catch (error) { return { ...meta, ready: false, reason: (error as Error).message }; }
  if (!provider.apiKeyConfigured) return { ...meta, ready: false, reason: `请先在 AI 设置中配置 ${provider.name} 的 API Key` };
  if (!meta.model?.trim()) return { ...meta, ready: false, reason: "请先在 AI 设置中填写补全模型名称" };
  return { ...meta, ready: true, reason: "配置就绪；有冻结素材包时可请求补全" };
};
