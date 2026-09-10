import type { ArticleDraft } from "./types.js";

/** Portable revision identity shared by proposal capture and the editor. */
export const draftDocumentKey = (draft: Pick<ArticleDraft, "title" | "bodyHtml" | "paragraphs" | "take" | "provenance"> & Partial<Pick<ArticleDraft, "factClaims" | "sources" | "images" | "uncertainties" | "sourceMaterial">>) => JSON.stringify({
  title: draft.title, bodyHtml: draft.bodyHtml ?? "", paragraphs: draft.paragraphs, take: draft.take,
  facts: draft.factClaims, sources: draft.sources, images: draft.images, uncertainties: draft.uncertainties, sourceMaterial: draft.sourceMaterial,
  packageId: draft.provenance.contentPackageId ?? "",
});
