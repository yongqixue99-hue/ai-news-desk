import type { ArticleDraft } from "./types.js";
import { legacyDraftBodyHtml, sanitizeDraftHtml } from "./article-html.js";
import * as cheerio from "cheerio";
export interface ArticleBlockFormat {
  paragraphIndex: number;
  kind: "paragraph" | "heading" | "list" | "ordered-list" | "table" | "code" | "quote";
  language?: string;
}
export const articleBlockSchema = { type: "array", maxItems: 200, items: { type: "object", additionalProperties: false,
  required: ["paragraphIndex", "kind"], properties: { paragraphIndex: { type: "integer", minimum: 0 },
    kind: { type: "string", enum: ["paragraph", "heading", "list", "ordered-list", "table", "code", "quote"] }, language: { type: "string", maxLength: 40 } } } };
const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export const renderArticleBlock = (text: string, block?: ArticleBlockFormat) => {
  const content = escape(text);
  switch (block?.kind) {
    case "heading": return `<h2>${content}</h2>`;
    case "quote": return `<blockquote><p>${content}</p></blockquote>`;
    case "code": return `<pre><code${block.language && /^[a-z0-9_+-]+$/iu.test(block.language) ? ` class="language-${escape(block.language)}"` : ""}>${content}</code></pre>`;
    case "list": case "ordered-list": {
      const tag = block.kind === "list" ? "ul" : "ol";
      return `<${tag}>${text.split("\n").filter(line => line.trim()).map(line => `<li><p>${escape(line)}</p></li>`).join("")}</${tag}>`;
    }
    case "table": {
      const rows = text.split("\n").map(row => row.split("\t"));
      if (rows.length < 2 || rows[0]!.length < 2 || rows.some(row => row.length !== rows[0]!.length)) throw new Error("表格需保留完整表头与等宽 TSV 行；不能静默丢弃单元格");
      return `<table><tbody>${rows.map((row, index) => `<tr>${row.map(cell => `<${index ? "td" : "th"}><p>${escape(cell)}</p></${index ? "td" : "th"}>`).join("")}</tr>`).join("")}</tbody></table>`;
    }
    default: return `<p>${content}</p>`;
  }
};
export const structuredDraftBodyHtml = (draft: ArticleDraft, formats: ArticleBlockFormat[] = []) => {
  const byIndex = new Map(formats.map(block => [block.paragraphIndex, block]));
  const $ = cheerio.load(`<article>${legacyDraftBodyHtml(draft)}</article>`, null, false);
  // Replace only body text nodes, leaving every governed image and attribution intact.
  let index = 0;
  $("article").children("p").each((_i, element) => {
    if ($(element).prev().is("img")) return;
    if (index >= draft.paragraphs.length) return;
    const current = index++;
    $(element).replaceWith(renderArticleBlock(draft.paragraphs[current]!, byIndex.get(current)));
  });
  return sanitizeDraftHtml($("article").html() ?? "");
};
