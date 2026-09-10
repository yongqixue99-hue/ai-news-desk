import type { LocalDatabase } from "./local-database.js";
import type { ContentPackage, SourceMaterialSnapshot, StoryView } from "./product-types.js";
import type { ExtractedPage } from "./types.js";
import { sourceSnapshotKey } from "./source-snapshot.js";

/** SourceDesk read model: no fetch, writes or model calls; frozen evidence wins. */
export function readStoredStorySources(story: StoryView, contentPackage: ContentPackage | undefined, database: Pick<LocalDatabase, "getSourceSnapshot">): SourceMaterialSnapshot[] {
  const materials = [...(contentPackage?.sourceEvidence ?? []), ...(contentPackage?.sourceMaterials ?? [])];
  const seen = new Set(materials.map(m => sourceSnapshotKey(m.url)));
  for (const signal of story.signals.slice(0, 12)) {
    const key = sourceSnapshotKey(signal.url);
    if (seen.has(key)) continue;
    const cached = database.getSourceSnapshot<ExtractedPage>(key);
    if (!cached || sourceSnapshotKey(cached.requestedUrl) !== key || typeof cached.page.text !== "string" || !cached.page.text.trim()) continue;
    // The stored canonical identity must still refer to the selected event.
    if (sourceSnapshotKey(cached.page.canonicalUrl || cached.page.url) !== key) continue;
    seen.add(key);
    materials.push({ signalId: signal.candidateId, sourceKind: signal.isCommunity ? "community-post" : "article", sourceLabel: signal.sourceName,
      url: signal.url, author: cached.page.author || signal.author, originalTitle: cached.page.title || signal.title,
      originalText: cached.page.text, originalLanguage: "mixed", basis: "full-source", capturedAt: cached.capturedAt, fromCache: true,
      truncated: Boolean(cached.page.textTruncated), extractionWarnings: cached.page.extractionWarnings, rightsNotice: "已保存的来源快照；公开使用仍需核对权利。" });
  }
  return materials.slice(0, 12).map(m => ({ ...m, originalText: m.originalText.slice(0, 30_000), truncated: m.truncated || m.originalText.length > 30_000 }));
}
