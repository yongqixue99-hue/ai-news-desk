import * as cheerio from "cheerio";

export const deliveryText = (value: string | undefined) => (value || "").replace(/\s+/gu, " ").trim();
const blocks = "p,h1,h2,h3,h4,h5,h6,li,pre,td,th,div,section,blockquote";

/** Readable structure and evidence links matter; platform fonts and wrappers do not. */
export const deliveryContent = (html: string) => {
  const $ = cheerio.load(html || "");
  $("script,style,noscript").remove();
  $("br").replaceWith("\n");
  const paragraphs = $(blocks).filter((_index, element) => !$(element).find(blocks).length)
    .map((_index, element) => deliveryText($(element).text())).get().filter(Boolean);
  const text = deliveryText($.root().text());
  return {
    text,
    blocks: paragraphs.length ? paragraphs : text ? [text] : [],
    links: $("a[href]").map((_index, element) => ({
      text: deliveryText($(element).text()), href: ($(element).attr("href") || "").trim(),
    })).get(),
    images: $("img").map((_index, element) => ($(element).attr("src") || "").replace(/^http:/u, "https:")).get(),
  };
};
