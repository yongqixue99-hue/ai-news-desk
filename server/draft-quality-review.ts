import { bindDraftCheck, currentDocumentClaims, currentDraftParagraphs, isDraftCheckCurrent } from "./draft-check-binding.js";
import { sourceChangesForPackage } from "./source-change-impact.js";
import { evaluateDraftPackageQuality, reconcileDraftFactEvidence } from "./editorial-quality-desk.js";
import { draftVisualFindings } from "./draft-visual-check.js";
import type { LocalDatabase } from "./local-database.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft } from "./types.js";
type Store = Pick<LocalDatabase,"getContentPackage" | "getSourceSnapshot">;
export const reviewDraftQuality = (draft: ArticleDraft, store: Store) => {
  const contentPackage = draft.provenance.contentPackageId ? store.getContentPackage<ContentPackage>(draft.provenance.contentPackageId) : undefined;
  const binding = bindDraftCheck(draft, contentPackage);
  const report = contentPackage ? evaluateDraftPackageQuality({ draft, contentPackage }) : undefined;
  const changes = contentPackage ? sourceChangesForPackage(contentPackage, store).map(change => ({ ...change,
    reviewed: Boolean(draft.sourceChangeReviews?.some(review => review.url === change.url && review.observedHash === change.observedHash && review.packageHash === binding.packageHash && review.documentHash === binding.documentHash)) })) : [];
  const blockers = [...(report?.blockers.map(issue => issue.message) ?? []),
    ...(draft.provenance.contentPackageId && !contentPackage ? ["冻结素材包无法读取，请恢复对应素材包后核验。"] : []),
    ...changes.filter(change => !change.reviewed).map(change => `来源已变化：${change.url}。请核对后记录决定，或从更新后的素材重新成稿。`),
    ...draftVisualFindings(draft).map(issue => issue.message)];
  return { binding, checkedAt: new Date().toISOString(), ready: !blockers.length, blockers: [...new Set(blockers)],
    warnings: report?.warnings.map(issue => issue.message) ?? ["旧稿没有冻结素材包，无法补做包内事实关系校验。"],
    changes, unmapped: currentDocumentClaims(draft).flatMap((claim,index) => claim.id.startsWith("unmapped_") ? [{ index, text: claim.claim }] : []),
    facts: contentPackage?.facts ?? [], visualFindings: draftVisualFindings(draft) };
};
export const bindReviewedParagraph = (draft: ArticleDraft, store: Store, expected: ReturnType<typeof bindDraftCheck>, index: number, factIds: string[]) => {
  const contentPackage = draft.provenance.contentPackageId ? store.getContentPackage<ContentPackage>(draft.provenance.contentPackageId) : undefined;
  if (!contentPackage || !isDraftCheckCurrent(expected, draft, contentPackage)) throw new Error("正文或冻结素材已变化，请重新检查后绑定");
  const paragraphs = currentDraftParagraphs(draft);
  if (!Number.isInteger(index) || index < 0 || index >= paragraphs.length || !factIds.length || factIds.some(id => !contentPackage.facts.some(fact => fact.id === id))) throw new Error("请选择当前正文块和素材包内的事实");
  const claims = currentDocumentClaims(draft);
  const claim = { ...claims[index]!, id: `reviewed_${index}_${expected.documentHash.slice(0,12)}`, factIds: [...new Set(factIds)], claim: paragraphs[index]!, status: "unverified" as const };
  const [reviewed] = reconcileDraftFactEvidence(contentPackage, [claim]);
  if (!reviewed || reviewed.status === "unverified" || reviewed.status === "excerpt-only") throw new Error("所选事实仍不足以支持本段的数字、对象或条件，请先修改正文或核对材料");
  claims[index] = { ...reviewed, note: "用户已针对当前正文重新核对并选择冻结事实；规则校验不代替完整语义审阅。" };
  draft.paragraphs = paragraphs; draft.factClaims = claims;
};
