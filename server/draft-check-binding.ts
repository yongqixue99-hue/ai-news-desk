import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { normalizedDraftBodyHtml } from "./article-html.js";
import type { ArticleDraft, DraftFactClaim } from "./types.js";
import type { ContentPackage } from "./product-types.js";
export const contentHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export interface DraftCheckBinding { documentHash: string; packageId?: string; packageHash?: string; revisionId?: string }
export const bindDraftCheck = (draft: ArticleDraft, contentPackage?: ContentPackage): DraftCheckBinding => ({
  documentHash: contentHash({ title: draft.title, body: normalizedDraftBodyHtml(draft), take: draft.take, paragraphs: draft.paragraphs,
    facts: draft.factClaims, sources: draft.sources, uncertainties: draft.uncertainties, images: draft.images,
    sourceMaterial: draft.sourceMaterial, packageId: draft.provenance.contentPackageId }),
  packageId: contentPackage?.id ?? draft.provenance.contentPackageId, packageHash: contentPackage ? contentHash(contentPackage) : undefined, revisionId: draft.revisionId,
});
export const isDraftCheckCurrent = (binding: DraftCheckBinding, draft: ArticleDraft, contentPackage?: ContentPackage) => {
  const current = bindDraftCheck(draft, contentPackage);
  return binding.documentHash === current.documentHash && binding.packageId === current.packageId && binding.packageHash === current.packageHash;
};
const normalizedText = (value: string) => value.normalize("NFKC").replace(/\s+/gu," ").trim();
export const currentDraftParagraphs = (draft: ArticleDraft) => {
  if (!draft.bodyHtml?.trim()) return draft.paragraphs;
  const $ = cheerio.load(`<article>${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  const paragraphs: string[] = [];
  $("article").children().each((_index, element) => {
    const node = $(element);
    if (node.is("img,hr") || node.is("p") && node.prev().is("img") && node.text().startsWith("图：")) return;
    node.find("br").replaceWith("\n");
    let text = node.text();
    if (node.is("table")) text = node.find("tr").map((_i,row) => $(row).children("td,th").map((_j,cell) => $(cell).text()).get().join("\t")).get().join("\n");
    else if (node.is("ul,ol")) text = node.children("li").map((_i,item) => $(item).text()).get().join("\n");
    if (text.trim()) paragraphs.push(text);
  });
  if (draft.take.trim() && normalizedText(paragraphs.at(-1) ?? "") === normalizedText(draft.take)) paragraphs.pop();
  return paragraphs;
};
/** Only exact text correspondence retains an old factual endorsement. */
export const currentDocumentClaims = (draft: ArticleDraft): DraftFactClaim[] => currentDraftParagraphs(draft).map((text,index) => {
  const exact = draft.factClaims?.find(claim => normalizedText(claim.claim) === normalizedText(text));
  return exact ? { ...exact, claim: text } : { id: `unmapped_${contentHash(`${index}:${text}`).slice(0,16)}`, claim: text,
    status: "unverified", capturedAt: draft.updatedAt, note: "正文已变更，这个块尚未绑定当前冻结事实。" };
});
