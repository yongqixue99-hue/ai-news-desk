import type { ImageMaterial } from "./types";

export interface MaterialGovernanceView {
  status: "allowed" | "warning" | "blocked";
  label: string;
  detail: string;
  blockers: string[];
  warnings: string[];
}

const hasSourceUrl = (value: string | undefined) => {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const materialGovernanceView = (
  material: ImageMaterial,
  platform = "xiaoheihe",
  checkedAt = new Date().toISOString(),
): MaterialGovernanceView => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const expiry = material.expiresAt ? new Date(material.expiresAt).getTime() : undefined;
  const expired = material.rights === "expired"
    || (expiry !== undefined && Number.isFinite(expiry) && expiry <= new Date(checkedAt).getTime());
  const requiresAttribution = ["licensed", "official", "editorial-screenshot"].includes(material.rights);

  if (expired) blockers.push("授权已到期");
  if (material.rights === "check-required") blockers.push("版权状态待确认");
  if (material.expiresAt && !Number.isFinite(expiry)) blockers.push("授权到期时间无效");
  if (
    material.rights === "licensed"
    && !material.evidenceNote?.trim()
    && !material.evidencePath?.trim()
  ) blockers.push("缺少授权证据");
  if (
    material.rights === "editorial-screenshot"
    && !material.evidenceNote?.trim()
    && !material.evidencePath?.trim()
  ) blockers.push("缺少截图证据");
  if (requiresAttribution && (!material.attribution.trim() || /待补充|未知|unknown/i.test(material.attribution))) {
    blockers.push("缺少来源署名");
  }
  if (requiresAttribution && !hasSourceUrl(material.sourceUrl)) blockers.push("缺少来源 URL");
  if (
    !material.allowedPlatforms.includes("*")
    && !material.allowedPlatforms.map((item) => item.toLowerCase()).includes(platform.toLowerCase())
  ) blockers.push(platform === "xiaoheihe" ? "未授权用于小黑盒" : `未授权用于 ${platform}`);
  if (material.rights === "official") warnings.push("官方来源不等于转载授权，发布前仍需复核");
  if (material.rights === "editorial-screenshot") warnings.push("评论性截图应控制引用范围并保留来源");

  if (blockers.length) {
    return {
      status: "blocked",
      label: "暂不可发布",
      detail: blockers.join("；"),
      blockers,
      warnings,
    };
  }
  if (warnings.length) {
    return {
      status: "warning",
      label: "发布前复核",
      detail: warnings.join("；"),
      blockers,
      warnings,
    };
  }
  return {
    status: "allowed",
    label: "小黑盒可用",
    detail: "权限、来源和平台范围已记录",
    blockers,
    warnings,
  };
};
