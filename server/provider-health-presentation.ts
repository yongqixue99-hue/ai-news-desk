import type { AiProviderConfig, ProviderHealthErrorCategory, ProviderHealthResult } from "./types.js";

export interface ProviderHealthPresentation {
  tone: "neutral" | "success" | "warning" | "error";
  label: string;
  detail: string;
  stale: boolean;
}

const categoryLabels: Record<ProviderHealthErrorCategory, string> = {
  none: "连接正常",
  "not-configured": "尚未配置",
  auth: "认证失败",
  config: "配置异常",
  network: "网络异常",
  timeout: "连接超时",
  "rate-limit": "限流或额度不足",
  model: "模型异常",
  server: "厂商服务异常",
  "invalid-response": "响应不兼容",
  unknown: "检查失败",
};

export const providerHealthPresentation = (
  provider: AiProviderConfig,
  health: ProviderHealthResult | undefined,
): ProviderHealthPresentation => {
  if (!health) {
    return {
      tone: "neutral",
      label: "尚未测试",
      detail: "测试连接不会生成草稿。",
      stale: false,
    };
  }
  if (health.model !== provider.model.trim()) {
    return {
      tone: "warning",
      label: "配置已变更",
      detail: `上次测试的是 ${health.model || "未填写模型"}，请重新测试当前模型。`,
      stale: true,
    };
  }
  const tone = health.status === "healthy"
    ? "success"
    : health.status === "warning" ? "warning" : "error";
  return {
    tone,
    label: `${categoryLabels[health.errorCategory]} · ${health.latencyMs}ms`,
    detail: health.safeMessage,
    stale: false,
  };
};
