import type { ArticleDraft } from "./types.js";
import type { ContentPackage } from "./product-types.js";
import { technicalAdaptationGuidelines } from "./technical-article.js";

const escapeHtml = (value: string) => value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;");
export const technicalSourceFragments = (contentPackage: ContentPackage) => (contentPackage.sourceMaterials?.[0]?.blocks ?? [])
  .filter(block => block.kind === "code" || block.kind === "table")
  .map((block, index) => ({ ...block, marker: `[[SOURCE_BLOCK_${index + 1}]]` }));

export const technicalDraftGuidelines = (contentPackage: ContentPackage) => contentPackage.technicalArticle ? [
  ...technicalAdaptationGuidelines(contentPackage.technicalArticle),
  "技术文章沿用原文章节与步骤。代码和对照表由系统按冻结原文插入，不要重写、改参数或重新排版。",
  "在 paragraphs 中适当位置用一个单独段落放对应 sourceFragments[].marker；每个标记最多出现一次，顺序沿用原文。不要将代码重新抄入普通段落。",
  contentPackage.technicalArticle.adaptation === "faithful" ? "忠实整理必须带入全部 sourceFragments 标记，不得漏掉教学步骤。" : "复杂文章以通俗导读为主，可只带入讲解所需的 sourceFragments 标记；未解释的专业细节引导读者回原文。",
] : [];

/** Only runs at initial generation. Existing edited articles are never rewritten. */
export const restoreTechnicalSourceBlocks = (draft: ArticleDraft, contentPackage: ContentPackage) => {
  if (!contentPackage.technicalArticle || contentPackage.intent !== "source") return;
  const fragments = technicalSourceFragments(contentPackage);
  const known = new Map(fragments.map(block => [block.marker, block]));
  const seen = new Set<string>();
  let lastIndex = -1;
  for (const paragraph of draft.paragraphs) {
    const matches = paragraph.match(/\[\[SOURCE_BLOCK_[^\]]+\]\]/gu) ?? [];
    for (const marker of matches) {
      const index = fragments.findIndex(block => block.marker === marker);
      if (!known.has(marker) || paragraph.trim() !== marker || seen.has(marker) || index <= lastIndex) throw new Error("技术原文块标记无效、重复或顺序不符，已停止保存");
      seen.add(marker);
      lastIndex = index;
    }
  }
  if (contentPackage.technicalArticle.adaptation === "faithful" && fragments.some(block => !seen.has(block.marker))) throw new Error("忠实整理遗漏原文代码或表格，已停止保存");
  for (const block of fragments.filter(fragment => seen.has(fragment.marker))) {
    const html = block.kind === "code" ? `<pre><code${block.language ? ` class="language-${escapeHtml(block.language)}"` : ""}>${escapeHtml(block.text)}</code></pre>`
      : `<table><tbody>${block.text.split("\n").map(row => `<tr>${row.split("\t").map(cell => `<td><p>${escapeHtml(cell)}</p></td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const placeholder = `<p>${block.marker}</p>`;
    if (!draft.bodyHtml?.includes(placeholder)) throw new Error("原文代码或表格的正文位置丢失，已停止保存");
    draft.bodyHtml = draft.bodyHtml.replace(placeholder, html);
    draft.paragraphs = draft.paragraphs.map(paragraph => paragraph.trim() === block.marker ? block.text : paragraph);
    draft.factClaims = draft.factClaims?.map(claim => claim.claim.trim() === block.marker ? { ...claim, claim: block.text } : claim);
  }
};
