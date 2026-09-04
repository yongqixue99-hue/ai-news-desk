import { createHash } from "node:crypto";
import { assertEvidenceReadyForDraft, normalizeEvidenceSelection } from "./intake-review.js";
import type { ContentPackage, EvidenceClaim } from "./product-types.js";
import type { IntakeReviewRecord } from "./types.js";

const sourceUrlFor = (record: IntakeReviewRecord) => record.bundle.source.canonicalUrl
  || record.bundle.source.publicPath
  || record.bundle.source.requestedUrl
  || record.bundle.source.assetPath
  || `intake:${record.id}`;

/**
 * Freeze a user-confirmed link or screenshot review into the same evidence
 * boundary used by Story-based drafts. This keeps inline writing assistance
 * available without allowing it to reach beyond the reviewed intake text.
 */
export const buildIntakeContentPackage = (record: IntakeReviewRecord): ContentPackage => {
  const normalized = assertEvidenceReadyForDraft(
    normalizeEvidenceSelection(record.bundle, record.selection ?? {}),
  );
  const sourceSignalId = `intake:${record.id}`;
  const sourceUrl = sourceUrlFor(record);
  const facts: EvidenceClaim[] = normalized.textBlocks.map((block) => ({
    id: `claim_${createHash("sha1")
      .update(`${record.id}:${block.id}:${block.text}`)
      .digest("hex")
      .slice(0, 12)}`,
    text: block.text,
    status: "supported",
    sourceSignalIds: [sourceSignalId],
    sourceUrls: [sourceUrl],
    note: "用户已在导入证据复核中保留并确认这段文字。",
  }));
  const fingerprint = createHash("sha256")
    .update(JSON.stringify({
      reviewId: record.id,
      evidenceBundleId: normalized.evidenceBundleId,
      sourceUrl,
      facts: facts.map((fact) => ({ id: fact.id, text: fact.text })),
    }))
    .digest("hex")
    .slice(0, 18);

  return {
    id: `package_intake_${fingerprint}`,
    storyId: `story_${record.id}`,
    mode: "brief",
    intent: "news",
    intakeReason: "用户确认导入证据后生成基础稿",
    title: normalized.title,
    createdAt: normalized.review.confirmedAt || normalized.capturedAt,
    facts,
    communityFocus: [],
    discussionSamples: [],
    sourceSignalIds: [sourceSignalId],
    sources: [{
      signalId: sourceSignalId,
      label: normalized.source.label,
      url: sourceUrl,
      role: "discovery",
      basis: "full-source",
      publishedAt: normalized.capturedAt,
      isCommunity: false,
    }],
    imageIds: [],
    assets: [],
    uncertainties: [...normalized.warnings],
    suggestedAngles: ["只围绕用户确认的导入证据续写，不添加素材包外数字、实体或结论"],
    communityEvidenceLabel: "没有社区讨论样本",
    status: "ready",
    blockers: [],
  };
};
