import type { ArticleDraft, DraftLayoutTheme } from "./types";

export const layoutThemeOptions: Array<{ id: DraftLayoutTheme; label: string }> = [
  { id: "news-clean", label: "新闻简洁" },
  { id: "mono-editorial", label: "黑白杂志" },
  { id: "tech-blue", label: "科技蓝" },
];

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

export const legacyBodyHtml = (draft: ArticleDraft) => {
  const placements = new Map<number, ArticleDraft["images"]>();
  for (const placement of draft.images) {
    if (placement.afterParagraph < 0) continue;
    const bucket = placements.get(placement.afterParagraph) ?? [];
    bucket.push(placement);
    placements.set(placement.afterParagraph, bucket);
  }
  const blocks: string[] = [];
  draft.paragraphs.forEach((paragraph, index) => {
    blocks.push(`<p>${escapeHtml(paragraph)}</p>`);
    for (const placement of placements.get(index) ?? []) {
      const src = placement.image.publicPath || placement.image.url;
      blocks.push(
        `<img src="${escapeHtml(src)}" alt="${escapeHtml(placement.caption)}" data-media-id="${escapeHtml(placement.id)}" data-caption="${escapeHtml(placement.caption)}" data-attribution="${escapeHtml(placement.image.attribution)}">`,
        `<p>图：${escapeHtml(placement.caption)}（来源：${escapeHtml(placement.image.attribution)}）</p>`,
      );
    }
  });
  if (draft.take.trim()) blocks.push(`<p>${escapeHtml(draft.take.trim())}</p>`);
  return blocks.join("");
};

export const bodyHtmlFor = (draft: ArticleDraft) => draft.bodyHtml?.trim() || legacyBodyHtml(draft);

export const textFromHtml = (html: string) => {
  const documentNode = new DOMParser().parseFromString(html, "text/html");
  return (documentNode.body.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
};

const themeTokens: Record<DraftLayoutTheme, {
  article: string;
  paragraph: string;
  heading: string;
  quote: string;
  link: string;
  image: string;
  caption: string;
}> = {
  "news-clean": {
    article: "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.86;color:#25282d;background:#ffffff;letter-spacing:.012em;",
    paragraph: "margin:0 0 1.15em;",
    heading: "margin:1.75em 0 .7em;font-size:1.28em;line-height:1.45;font-weight:750;color:#15171a;",
    quote: "margin:1.35em 0;padding:.35em 0 .35em 1em;border-left:3px solid #d84a3e;color:#62666d;",
    link: "color:#c83f35;text-decoration:underline;",
    image: "display:block;max-width:100%;height:auto;margin:1.4em auto .55em;border-radius:2px;",
    caption: "margin:.15em 0 1.5em;text-align:center;color:#858991;font-size:12px;line-height:1.6;",
  },
  "mono-editorial": {
    article: "font-family:Georgia,'Songti SC','Noto Serif CJK SC',serif;font-size:16px;line-height:1.92;color:#171717;background:#ffffff;letter-spacing:.02em;",
    paragraph: "margin:0 0 1.2em;",
    heading: "margin:1.9em 0 .75em;padding-bottom:.42em;border-bottom:2px solid #171717;font-size:1.3em;line-height:1.4;font-weight:700;color:#111111;",
    quote: "margin:1.45em 0;padding:.8em 1em;background:#f2f2f2;color:#404040;",
    link: "color:#111111;text-decoration:underline;text-decoration-thickness:1px;",
    image: "display:block;max-width:100%;height:auto;margin:1.55em auto .55em;filter:saturate(.88);",
    caption: "margin:.15em 0 1.6em;text-align:center;color:#707070;font-family:-apple-system,BlinkMacSystemFont,'PingFang SC',sans-serif;font-size:12px;line-height:1.6;",
  },
  "tech-blue": {
    article: "font-family:-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif;font-size:16px;line-height:1.84;color:#172033;background:#ffffff;letter-spacing:.012em;",
    paragraph: "margin:0 0 1.15em;",
    heading: "margin:1.8em 0 .75em;padding-left:.65em;border-left:4px solid #3156d3;font-size:1.28em;line-height:1.42;font-weight:750;color:#14265f;",
    quote: "margin:1.4em 0;padding:.75em 1em;border-radius:4px;background:#eef3ff;color:#344467;",
    link: "color:#3156d3;text-decoration:underline;",
    image: "display:block;max-width:100%;height:auto;margin:1.45em auto .55em;border:1px solid #dfe5f5;border-radius:4px;",
    caption: "margin:.15em 0 1.55em;text-align:center;color:#74809d;font-size:12px;line-height:1.6;",
  },
};

export const inlineThemeStyles = (html: string, theme: DraftLayoutTheme) => {
  const parsed = new DOMParser().parseFromString(`<article>${html}</article>`, "text/html");
  const article = parsed.querySelector("article")!;
  const tokens = themeTokens[theme];
  article.setAttribute("style", tokens.article);
  article.querySelectorAll("h1").forEach((node) => node.setAttribute("style", "margin:0 0 1.2em;font-size:1.55em;line-height:1.4;font-weight:800;color:inherit;"));
  article.querySelectorAll("p").forEach((node) => node.setAttribute("style", tokens.paragraph));
  article.querySelectorAll("h2,h3").forEach((node) => node.setAttribute("style", tokens.heading));
  article.querySelectorAll("blockquote").forEach((node) => node.setAttribute("style", tokens.quote));
  article.querySelectorAll("a").forEach((node) => node.setAttribute("style", tokens.link));
  article.querySelectorAll("img").forEach((node) => node.setAttribute("style", tokens.image));
  article.querySelectorAll("img + p").forEach((node) => node.setAttribute("style", tokens.caption));
  article.querySelectorAll("ul,ol").forEach((node) => node.setAttribute("style", "margin:0 0 1.2em;padding-left:1.6em;"));
  article.querySelectorAll("li").forEach((node) => node.setAttribute("style", "margin:.35em 0;"));
  article.querySelectorAll("pre").forEach((node) => node.setAttribute("style", "margin:1.3em 0;padding:1em;overflow:auto;background:#17191d;color:#f4f5f7;border-radius:4px;"));
  return article.outerHTML;
};

const blobAsDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

export const inlineLocalImages = async (html: string) => {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const images = [...parsed.querySelectorAll("img")];
  await Promise.all(images.map(async (image) => {
    const src = image.getAttribute("src");
    if (!src || src.startsWith("data:")) return;
    try {
      const response = await fetch(src);
      if (!response.ok) return;
      image.setAttribute("src", await blobAsDataUrl(await response.blob()));
    } catch {
      // Keep the original URL if a source image cannot be inlined.
    }
  }));
  return parsed.body.innerHTML;
};

export const copyRichHtml = async (html: string, plainText: string) => {
  const richHtml = await inlineLocalImages(html);
  if (navigator.clipboard && "ClipboardItem" in window) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([richHtml], { type: "text/html" }),
        "text/plain": new Blob([plainText], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch {
      // Some embedded browser contexts deny ClipboardItem even after a click.
      // Continue with the selection-based rich-text fallback below.
    }
  }
  const fallback = document.createElement("div");
  fallback.contentEditable = "true";
  fallback.style.position = "fixed";
  fallback.style.left = "-10000px";
  fallback.innerHTML = richHtml;
  document.body.append(fallback);
  const range = document.createRange();
  range.selectNodeContents(fallback);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  document.execCommand("copy");
  selection?.removeAllRanges();
  fallback.remove();
};
