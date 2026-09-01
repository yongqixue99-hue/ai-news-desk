import type { DraftQualityDimension, DraftQualityWarning } from "./types.js";

const dimensionOrder: DraftQualityDimension[] = [
  "fact-safety",
  "content-completeness",
  "images-rights",
  "writing-quality",
];

const labels: Record<DraftQualityDimension, string> = {
  "fact-safety": "事实安全",
  "content-completeness": "内容完整",
  "images-rights": "图片与权利",
  "writing-quality": "表达质量",
};

export const buildDraftQualityView = (warnings: DraftQualityWarning[] = []) => {
  const dimensions = dimensionOrder.map((id) => {
    const issues = warnings.filter((warning) => warning.dimension === id);
    return {
      id,
      label: labels[id],
      count: issues.length,
      state: issues.length ? "warning" as const : "passed" as const,
      summary: issues.length ? `${issues.length} 项待完善` : "已通过",
      issues,
    };
  });
  const nextTab = warnings.some((warning) => warning.dimension === "images-rights")
    ? "images" as const
    : warnings.some((warning) => warning.dimension === "fact-safety")
      ? "sources" as const
      : "agent" as const;
  return {
    dimensions,
    warnings,
    nextTab,
    headline: warnings.length ? `草稿已保留，还有 ${warnings.length} 项可以完善` : "草稿质量检查已通过",
    detail: warnings[0]?.message ?? "事实、内容、图片和表达检查均无待处理警告。",
  };
};
