import { contentHash } from "./draft-check-binding.js";
import { sourceSnapshotKey } from "./source-snapshot.js";
import type { LocalDatabase } from "./local-database.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft, ExtractedPage } from "./types.js";
export interface SourceChangeImpact { url: string; frozenAt: string; observedAt: string; frozenHash: string; observedHash: string; affectedFactIds: string[]; reason: string }
const comparable = (text: string) => text.replace(/\r\n?/gu,"\n").trim();
export const sourceChangesForPackage = (contentPackage: ContentPackage, database: Pick<LocalDatabase,"getSourceSnapshot">): SourceChangeImpact[] => [...(contentPackage.sourceEvidence ?? []), ...(contentPackage.sourceMaterials ?? [])].flatMap(source => {
  const snapshot = database.getSourceSnapshot<ExtractedPage>(sourceSnapshotKey(source.url));
  if (!snapshot || typeof snapshot.page.text !== "string" || Date.parse(snapshot.capturedAt) <= Date.parse(source.capturedAt)
    || sourceSnapshotKey(snapshot.requestedUrl) !== sourceSnapshotKey(source.url)) return [];
  const frozenHash = contentHash(comparable(source.originalText)), observedHash = contentHash(comparable(snapshot.page.text));
  if (frozenHash === observedHash) return [];
  const affectedFactIds = contentPackage.facts.filter(fact => fact.sourceSignalIds.includes(source.signalId) || fact.sourceUrls?.some(url => sourceSnapshotKey(url) === sourceSnapshotKey(source.url))).map(fact => fact.id);
  return [{ url: source.url, frozenAt: source.capturedAt, observedAt: snapshot.capturedAt, frozenHash, observedHash, affectedFactIds,
    reason: "新读取的来源文字与冻结快照不同，可能是内容更正、补充或读取范围变化；请核对受影响事实，正文不会被自动替换。" }];
});
export const affectedDraftsForSourceChanges = (drafts: ArticleDraft[], database: Pick<LocalDatabase,"getSourceSnapshot" | "getContentPackage">) => drafts.flatMap(draft => {
  const contentPackage = draft.provenance.contentPackageId ? database.getContentPackage<ContentPackage>(draft.provenance.contentPackageId) : undefined;
  const changes = contentPackage ? sourceChangesForPackage(contentPackage, database) : [];
  return changes.length ? [{ draftId: draft.id, title: draft.title, changes }] : [];
});
