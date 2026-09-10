import * as cheerio from "cheerio";
import { insertedMediaIds, normalizedDraftBodyHtml } from "./article-html.js";
import { auditVisualContext } from "./visual-context.js";
import type { ArticleDraft } from "./types.js";
export const draftVisualFindings = (draft: ArticleDraft) => {
  const inserted = insertedMediaIds(draft);
  const $ = cheerio.load(`<article>${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  return draft.images.filter(placement => inserted.has(placement.id)).flatMap(placement => {
    const element = $("img[data-media-id]").filter((_i, element) => $(element).attr("data-media-id") === placement.id).first();
    const caption = element.next("p").text().replace(/^图：/u,"").replace(/（来源：[\s\S]*$/u,"").trim() || placement.caption;
    const paragraph = element.length ? element.prevAll("p,h2,h3,blockquote,ul,ol,table,pre").first().text() : draft.paragraphs[placement.afterParagraph] ?? "";
    return auditVisualContext(placement.image, paragraph, caption).map(issue => ({ ...issue, placementId: placement.id, message: `${placement.caption}：${issue.message}` }));
  });
};
