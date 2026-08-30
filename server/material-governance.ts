import { createHash } from "node:crypto";

export type MaterialRightsStatus =
  | "owned"
  | "licensed"
  | "official"
  | "editorial-screenshot"
  | "check-required"
  | "expired";

export interface MaterialRightsEvidence {
  note?: string;
  path?: string;
}

export interface GovernedMaterial {
  id: string;
  title: string;
  attribution: string;
  rights: MaterialRightsStatus;
  sourceUrl?: string;
  evidence: MaterialRightsEvidence;
  licenseId?: string;
  licenseUrl?: string;
  modificationNote?: string;
  allowedPlatforms: string[];
  expiresAt?: string;
  entityTags: string[];
  fingerprint: string;
  createdAt: string;
  fileName?: string;
  localPath?: string;
  publicPath?: string;
}

export interface MaterialGovernanceInput {
  id: string;
  title: string;
  attribution?: string;
  rights?: MaterialRightsStatus | string;
  sourceUrl?: string;
  evidence?: MaterialRightsEvidence;
  licenseId?: string;
  licenseUrl?: string;
  modificationNote?: string;
  allowedPlatforms?: string[];
  expiresAt?: string;
  entityTags?: string[];
  fingerprint: string;
  createdAt: string;
  fileName?: string;
  localPath?: string;
  publicPath?: string;
}

const rightsStatuses = new Set<MaterialRightsStatus>([
  "owned",
  "licensed",
  "official",
  "editorial-screenshot",
  "check-required",
  "expired",
]);

const trimmed = (value: string | undefined) => value?.trim() || undefined;

const uniqueNormalized = (
  values: string[] | undefined,
  normalizer: (value: string) => string,
  limit: number,
) => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values || []) {
    const value = raw.trim();
    const identity = normalizer(value);
    if (!value || !identity || seen.has(identity)) continue;
    seen.add(identity);
    result.push(value);
    if (result.length >= limit) break;
  }
  return result;
};

export const normalizeGovernedMaterial = (
  input: MaterialGovernanceInput,
): GovernedMaterial => {
  const rawRights = input.rights?.trim();
  const requestedRights = (rawRights === "commentary-screenshot"
    ? "editorial-screenshot"
    : rawRights) as MaterialRightsStatus | undefined;
  return {
    id: input.id.trim(),
    title: input.title.trim() || "未命名素材",
    attribution: input.attribution?.trim() || "来源待补充",
    rights: requestedRights && rightsStatuses.has(requestedRights)
      ? requestedRights
      : "check-required",
    sourceUrl: trimmed(input.sourceUrl),
    evidence: {
      note: trimmed(input.evidence?.note),
      path: trimmed(input.evidence?.path),
    },
    licenseId: trimmed(input.licenseId),
    licenseUrl: trimmed(input.licenseUrl),
    modificationNote: trimmed(input.modificationNote),
    allowedPlatforms: uniqueNormalized(
      input.allowedPlatforms,
      (value) => value.toLowerCase(),
      20,
    ).map((value) => value.toLowerCase()),
    expiresAt: trimmed(input.expiresAt),
    entityTags: uniqueNormalized(input.entityTags, (value) => value.toLocaleLowerCase(), 24),
    fingerprint: normalizedFingerprint(input.fingerprint),
    createdAt: input.createdAt,
    fileName: trimmed(input.fileName),
    localPath: trimmed(input.localPath),
    publicPath: trimmed(input.publicPath),
  };
};

export const fingerprintSha256 = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

const normalizedFingerprint = (value: string) => value.trim().toLowerCase();

export const findDuplicateMaterial = (
  fingerprint: string,
  materials: readonly Pick<GovernedMaterial, "id" | "fingerprint">[],
) => {
  const normalized = normalizedFingerprint(fingerprint);
  if (!/^[a-f0-9]{64}$/.test(normalized)) return undefined;
  return materials.find((material) => normalizedFingerprint(material.fingerprint) === normalized);
};

export interface MaterialPublishEligibility {
  eligible: boolean;
  status: "allowed" | "warning" | "blocked";
  effectiveRights: MaterialRightsStatus;
  platform: string;
  blockers: string[];
  warnings: string[];
}

const normalizedPlatform = (value: string) => value.trim().toLowerCase();

const hasTraceableSourceUrl = (value: string | undefined) => {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export const evaluateMaterialPublishEligibility = (
  material: GovernedMaterial,
  platform: string,
  now = new Date().toISOString(),
): MaterialPublishEligibility => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const nowTime = new Date(now).getTime();
  const expiryTime = material.expiresAt ? new Date(material.expiresAt).getTime() : undefined;
  const effectiveRights: MaterialRightsStatus = material.rights === "expired"
    || (expiryTime !== undefined && Number.isFinite(expiryTime) && expiryTime <= nowTime)
    ? "expired"
    : material.rights;
  const platformId = normalizedPlatform(platform);
  const allowedPlatforms = material.allowedPlatforms.map(normalizedPlatform);

  if (effectiveRights === "expired") blockers.push("图片使用权限已到期，请重新取得授权证据。");
  if (effectiveRights === "check-required") blockers.push("图片版权状态待确认，不能进入发布流程。");
  if (material.expiresAt && (expiryTime === undefined || !Number.isFinite(expiryTime))) {
    blockers.push("素材的授权到期时间无效，请重新填写。");
  }
  if (
    effectiveRights === "licensed"
    && !material.evidence.note?.trim()
    && !material.evidence.path?.trim()
  ) {
    blockers.push("授权素材缺少授权证据说明或证据文件路径。");
  }
  const claimsCreativeCommons = effectiveRights === "licensed" && /(?:creative commons|\bcc[- ]?by)/iu.test([
    material.licenseId,
    material.attribution,
    material.evidence.note,
  ].filter(Boolean).join(" "));
  if (claimsCreativeCommons && (!material.licenseId?.trim() || !hasTraceableSourceUrl(material.licenseUrl))) {
    blockers.push("Creative Commons 素材缺少机器可读的许可标识或许可条款 URL。");
  }
  if (claimsCreativeCommons && !material.modificationNote?.trim()) {
    blockers.push("Creative Commons 素材缺少修改说明（未修改也需要明确记录）。");
  }
  if (
    effectiveRights === "editorial-screenshot"
    && !material.evidence.note?.trim()
    && !material.evidence.path?.trim()
  ) {
    blockers.push("编辑性截图缺少原始截图证据说明或文件路径。");
  }
  if (
    ["licensed", "official", "editorial-screenshot"].includes(effectiveRights)
    && (!material.attribution.trim() || /待补充|unknown|未知/i.test(material.attribution))
  ) {
    blockers.push("非自有素材缺少明确的作者署名或来源标注。");
  }
  if (
    ["licensed", "official", "editorial-screenshot"].includes(effectiveRights)
    && !hasTraceableSourceUrl(material.sourceUrl)
  ) {
    blockers.push("素材缺少可追溯的 HTTP/HTTPS 来源 URL。");
  }
  if (effectiveRights === "official") {
    warnings.push("官方发布图片不等于已取得转载授权，请按来源条款人工复核。");
  }
  if (effectiveRights === "editorial-screenshot") {
    warnings.push("编辑性截图仅应用于讲解或评论语境，并保留来源与必要引用范围。");
  }
  if (!platformId) blockers.push("没有指定目标发布平台。");
  if (!allowedPlatforms.includes("*") && !allowedPlatforms.includes(platformId)) {
    blockers.push(`素材未获准用于 ${platform || "当前平台"}。`);
  }

  return {
    eligible: blockers.length === 0,
    status: blockers.length ? "blocked" : warnings.length ? "warning" : "allowed",
    effectiveRights,
    platform,
    blockers,
    warnings,
  };
};

export interface MaterialPublicationReceipt {
  status: "success" | "failed" | "partial";
  platform: string;
  receiptId: string;
  publishedAt: string;
  usedImageIds: string[];
  publishedUrl?: string;
}

export interface PublishedMaterialCandidate extends GovernedMaterial {
  promotion: {
    sourceImageId: string;
    platform: string;
    receiptId: string;
    publishedAt: string;
    publishedUrl?: string;
  };
}

export interface PublishedMaterialDecision {
  eligible: boolean;
  status: "ready" | "duplicate" | "blocked";
  blockers: string[];
  warnings: string[];
  duplicateOf?: string;
  candidate?: PublishedMaterialCandidate;
}

export interface PublishedMaterialCandidateInput {
  image: GovernedMaterial;
  publication: MaterialPublicationReceipt;
  existingMaterials: readonly GovernedMaterial[];
  targetMaterialId?: string;
}

export const preparePublishedMaterialCandidate = (
  input: PublishedMaterialCandidateInput,
): PublishedMaterialDecision => {
  const blockers: string[] = [];
  if (input.publication.status !== "success") {
    blockers.push("只有确认发布成功的图片才能转入素材库。");
  }
  if (!input.publication.usedImageIds.includes(input.image.id)) {
    blockers.push("发布回执没有记录这张图片被实际使用。");
  }
  if (blockers.length) {
    return { eligible: false, status: "blocked", blockers, warnings: [] };
  }

  const rightsDecision = evaluateMaterialPublishEligibility(
    input.image,
    input.publication.platform,
    input.publication.publishedAt,
  );
  blockers.push(...rightsDecision.blockers);
  if (!input.image.localPath?.trim()) {
    blockers.push("图片没有可供素材库接管的本地文件路径。");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.image.fingerprint.trim())) {
    blockers.push("图片缺少有效的 SHA-256 指纹，无法安全去重入库。");
  }
  if (blockers.length) {
    return {
      eligible: false,
      status: "blocked",
      blockers,
      warnings: rightsDecision.warnings,
    };
  }

  const duplicate = findDuplicateMaterial(input.image.fingerprint, input.existingMaterials);
  if (duplicate) {
    return {
      eligible: false,
      status: "duplicate",
      blockers: [],
      warnings: rightsDecision.warnings,
      duplicateOf: duplicate.id,
    };
  }

  return {
    eligible: true,
    status: "ready",
    blockers: [],
    warnings: rightsDecision.warnings,
    candidate: {
      ...input.image,
      id: input.targetMaterialId?.trim() || input.image.id,
      createdAt: input.publication.publishedAt,
      promotion: {
        sourceImageId: input.image.id,
        platform: input.publication.platform,
        receiptId: input.publication.receiptId,
        publishedAt: input.publication.publishedAt,
        publishedUrl: input.publication.publishedUrl,
      },
    },
  };
};
