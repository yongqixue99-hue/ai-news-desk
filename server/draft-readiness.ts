import { evaluateMaterialPublishEligibility, normalizeGovernedMaterial } from "./material-governance.js";
import { inspectLocalImageFile } from "./image-readiness.js";
import type { ArticleDraft, DraftReadinessResult } from "./types.js";

export const evaluateDraftReadiness = (
  draft: ArticleDraft,
  platform = "xiaoheihe",
  checkedAt = new Date().toISOString(),
): DraftReadinessResult => {
  const factClaims = draft.factClaims ?? [];
  const weakClaims = factClaims.filter((claim) => ["excerpt-only", "inference", "unverified"].includes(claim.status));
  const factBlockers = [
    ...draft.uncertainties.map((item) => `待确认事实：${item}`),
    ...weakClaims.map((claim) => `证据不足：${claim.claim}`),
  ];
  const imageReviews = draft.images.map((placement) => {
    const material = normalizeGovernedMaterial({
      id: placement.id,
      title: placement.caption || placement.image.caption,
      attribution: placement.image.attribution,
      rights: placement.image.rights,
      sourceUrl: placement.image.sourceUrl,
      evidence: {
        note: placement.image.evidenceNote,
        // A local image file proves that bytes exist, not that publication
        // rights exist. Licensed/editorial media needs separate evidence.
        path: placement.image.evidencePath,
      },
      licenseId: placement.image.licenseId,
      licenseUrl: placement.image.licenseUrl,
      modificationNote: placement.image.modificationNote,
      allowedPlatforms: placement.image.allowedPlatforms
        ?? (placement.image.rights === "owned" ? ["*"] : []),
      expiresAt: placement.image.expiresAt,
      entityTags: placement.image.entityTags,
      fingerprint: placement.image.fingerprint || "",
      createdAt: checkedAt,
      localPath: placement.image.localPath,
      publicPath: placement.image.publicPath,
    });
    const decision = evaluateMaterialPublishEligibility(material, platform, checkedAt);
    const localFile = inspectLocalImageFile(placement.image);
    const blockers = [...new Set([
      ...(localFile.available ? [] : [localFile.reason || "图片本地文件不可用。"]),
      ...decision.blockers,
    ])];
    return {
      placementId: placement.id,
      eligible: localFile.available && decision.eligible,
      status: blockers.length ? "blocked" as const : decision.status,
      blockers,
      warnings: decision.warnings,
      effectiveRights: decision.effectiveRights,
    };
  });
  const blockers = [
    ...factBlockers,
    ...imageReviews.flatMap((review) => review.blockers.map((item) => `图片：${item}`)),
  ];
  const warnings = imageReviews.flatMap((review) => review.warnings);
  return {
    draftId: draft.id,
    checkedAt,
    platform,
    ready: blockers.length === 0,
    factBlockers,
    imageReviews,
    blockers,
    warnings,
  };
};
