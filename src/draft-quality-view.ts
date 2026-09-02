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

const completenessLabels = {
  event: "事件本身",
  mechanism: "机制与依据",
  impact: "影响或后果",
  limitations: "限制与未知",
} as const;

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
  const coverageWarning = warnings.find((warning) =>
    warning.dimension === "content-completeness" && warning.factCoverage);
  const priorityWarning = nextTab === "images"
    ? warnings.find((warning) => warning.dimension === "images-rights")
    : nextTab === "sources"
      ? warnings.find((warning) => warning.dimension === "fact-safety")
      : coverageWarning ?? warnings[0];
  const coverageDetail = coverageWarning?.factCoverage
    ? coverageWarning.factCoverage.legacyUnmapped
      ? "这篇旧稿没有逐段事实映射，不能安全自动补写；请用当前生成器重建后再检查。"
      : `正文已覆盖 ${coverageWarning.factCoverage.usedFactIds.length}/${coverageWarning.factCoverage.supportedFactCount} 条可用事实${coverageWarning.missingDimensions?.length
        ? `，还缺${coverageWarning.missingDimensions.map((dimension) => completenessLabels[dimension]).join("、")}`
        : ""}。可只用未覆盖事实生成一次精确补丁。`
    : undefined;
  return {
    dimensions,
    warnings,
    nextTab,
    actionKind: nextTab === "agent" && coverageWarning && !coverageWarning.factCoverage?.legacyUnmapped
      ? "quality-repair" as const
      : "navigate" as const,
    headline: warnings.length ? `草稿已保留，还有 ${warnings.length} 项可以完善` : "草稿质量检查已通过",
    detail: nextTab === "agent" && coverageDetail
      ? coverageDetail
      : priorityWarning?.message ?? "事实、内容、图片和表达检查均无待处理警告。",
  };
};
