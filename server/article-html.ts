import * as cheerio from "cheerio";
import sanitizeHtml from "sanitize-html";
import type { ArticleDraft } from "./types.js";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const safeSourceUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
};

const attributionHtml = (attribution: string, sourceUrl: string) => {
  const href = safeSourceUrl(sourceUrl);
  const label = escapeHtml(attribution || "来源待补充");
  return href
    ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer noopener">${label}</a>`
    : label;
};

const licenseDetailsHtml = (placement: ArticleDraft["images"][number]) => {
  if (placement.image.rights !== "licensed") return [];
  const licenseId = placement.image.licenseId?.trim();
  const licenseUrl = safeSourceUrl(placement.image.licenseUrl || "");
  const license = licenseId
    ? licenseUrl
      ? `<a href="${escapeHtml(licenseUrl)}" target="_blank" rel="noreferrer noopener">${escapeHtml(licenseId)}</a>`
      : escapeHtml(licenseId)
    : "许可信息待补充";
  return [
    `许可：${license}`,
    `修改：${escapeHtml(placement.image.modificationNote?.trim() || "修改说明待补充")}`,
  ];
};

const plainAttributionDetails = (placement: ArticleDraft["images"][number]) => {
  const sourceUrl = safeSourceUrl(placement.image.sourceUrl);
  const details = [
    `${escapeHtml(placement.image.attribution || "来源待补充")}${sourceUrl ? `（${escapeHtml(sourceUrl)}）` : ""}`,
  ];
  if (placement.image.rights === "licensed") {
    const licenseUrl = safeSourceUrl(placement.image.licenseUrl || "");
    details.push(`许可：${escapeHtml(placement.image.licenseId || "待补充")}${licenseUrl ? `（${escapeHtml(licenseUrl)}）` : ""}`);
    details.push(`修改：${escapeHtml(placement.image.modificationNote || "待补充")}`);
  }
  return details;
};

const figureCaptionHtml = (
  placement: ArticleDraft["images"][number],
  caption = placement.caption || placement.image.caption || "配图",
) => `<p>图：${escapeHtml(caption)}（${[
  `来源：${attributionHtml(placement.image.attribution, placement.image.sourceUrl)}`,
  ...licenseDetailsHtml(placement),
].join("；")}）</p>`;

const mustKeepVisibleAttribution = (placement: ArticleDraft["images"][number]) =>
  placement.image.rights !== "owned";

const xiaoheiheImageCaption = (value: string) => {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 30) return normalized;
  const preferred = normalized
    .replace(/^OpenAI\s*帮助中心示例[：:]?\s*/i, "")
    .replace(/[，。；：:][\s\S]*$/, "")
    .trim();
  return (preferred || normalized).slice(0, 30).trim();
};

const sanitizerOptions: sanitizeHtml.IOptions = {
  allowedTags: [
    "p",
    "h2",
    "h3",
    "blockquote",
    "ul",
    "ol",
    "li",
    "strong",
    "em",
    "s",
    "u",
    "br",
    "hr",
    "a",
    "img",
    "pre",
    "code",
    "table", "thead", "tbody", "tr", "th", "td",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel"],
    img: ["src", "alt", "title", "data-media-id", "data-caption", "data-attribution"],
    p: ["data-ai-news-image"],
    code: ["class"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: "a",
      attribs: { ...attribs, target: "_blank", rel: "noreferrer noopener" },
    }),
  },
};

export const sanitizeDraftHtml = (html: string) => sanitizeHtml(html, sanitizerOptions);

export const legacyDraftBodyHtml = (draft: ArticleDraft) => {
  const placements = new Map<number, typeof draft.images>();
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
        figureCaptionHtml(placement),
      );
    }
  });
  if (draft.take.trim()) blocks.push(`<p>${escapeHtml(draft.take.trim())}</p>`);
  return blocks.join("");
};

export const normalizedDraftBodyHtml = (draft: ArticleDraft) =>
  sanitizeDraftHtml(draft.bodyHtml?.trim() || legacyDraftBodyHtml(draft));

const parseEditedCaption = ($: ReturnType<typeof cheerio.load>, image: ReturnType<ReturnType<typeof cheerio.load>>) => {
  const captionParagraph = image.next("p").first();
  const captionText = captionParagraph.text().replace(/\s+/g, " ").trim();
  if (!captionText.startsWith("图：")) return undefined;
  const withoutPrefix = captionText.slice(2).trim();
  const withoutAttribution = withoutPrefix.replace(/（来源：[^）]*）\s*$/, "").trim();
  return withoutAttribution || undefined;
};

/** Rebuild mandatory source/license text immediately before platform sync. */
export const bodyHtmlWithRequiredImageAttribution = (draft: ArticleDraft) => {
  const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
  const $ = cheerio.load(`<article id="article-root">${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  $("#article-root img[data-media-id]").each((_index, element) => {
    const image = $(element);
    const placement = placements.get(image.attr("data-media-id") || "");
    if (!placement || !mustKeepVisibleAttribution(placement)) return;
    const captionParagraph = image.next("p").first();
    const editedCaption = parseEditedCaption($, image);
    const visible = figureCaptionHtml(
      placement,
      editedCaption || image.attr("data-caption")?.trim() || placement.caption,
    );
    if (editedCaption) captionParagraph.replaceWith(visible);
    else image.after(visible);
  });
  return sanitizeDraftHtml($("#article-root").html() ?? "");
};

export const publisherImageCaptions = (draft: ArticleDraft) => {
  const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
  const $ = cheerio.load(`<article id="article-root">${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  const captions = new Map<string, string>();
  $("#article-root img[data-media-id]").each((_index, element) => {
    const image = $(element);
    const mediaId = image.attr("data-media-id") ?? "";
    const placement = placements.get(mediaId);
    if (!placement) return;
    const caption = parseEditedCaption($, image)
      || image.attr("data-caption")?.trim()
      || placement.caption.trim()
      || placement.image.caption.trim()
      || "配图";
    captions.set(mediaId, xiaoheiheImageCaption(caption));
  });
  return captions;
};

export const publisherBodyHtml = (draft: ArticleDraft) => {
  const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
  const captions = publisherImageCaptions(draft);
  const $ = cheerio.load(`<article id="article-root">${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  $("#article-root img[data-media-id]").each((_index, element) => {
    const image = $(element);
    const mediaId = image.attr("data-media-id") ?? "";
    const placement = placements.get(mediaId);
    if (!placement) {
      image.remove();
      return;
    }
    const captionParagraph = image.next("p").first();
    const editedCaption = parseEditedCaption($, image);
    if (editedCaption && !mustKeepVisibleAttribution(placement)) {
      // Xiaoheihe has a native description field under each uploaded image.
      // The extension fills that field from the image payload, so keeping this
      // generated caption paragraph would show the same caption twice.
      captionParagraph.remove();
    } else if (mustKeepVisibleAttribution(placement)) {
      const visibleAttribution = figureCaptionHtml(
        placement,
        editedCaption
          || image.attr("data-caption")?.trim()
          || placement.caption,
      );
      if (editedCaption) captionParagraph.replaceWith(visibleAttribution);
      else image.after(visibleAttribution);
    }
    const caption = captions.get(mediaId) || placement.caption;
    image.replaceWith(
      `<p data-ai-news-image="${escapeHtml(mediaId)}">【待上传配图：${escapeHtml(caption)}｜定位码 AIIMG:${escapeHtml(mediaId)}】</p>`,
    );
  });
  // Remote images that are not in the local media library would not survive a
  // cross-site fill reliably, so keep an explicit text marker instead.
  $("#article-root img").each((_index, element) => {
    const image = $(element);
    const alt = image.attr("alt") || "配图";
    image.replaceWith(`<p>【图片待手动补充：${escapeHtml(alt)}】</p>`);
  });
  return sanitizeDraftHtml($("#article-root").html() ?? "");
};

/**
 * Xiaoheihe's image-post editor has a separate image uploader. Keep the user's
 * short copy and mandatory non-owned-image attribution in the text field;
 * article upload markers and duplicate owned-image captions belong to the
 * article editor and would otherwise leak into the post as visible text.
 */
export const publisherImagePostBodyHtml = (draft: ArticleDraft) => {
  const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
  const $ = cheerio.load(`<article id="article-root">${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  const captions = publisherImageCaptions(draft);
  const visibleAttributions: string[] = [];
  $("#article-root img").each((_index, element) => {
    const image = $(element);
    const placement = placements.get(image.attr("data-media-id") || "");
    const caption = image.next("p").first();
    if (caption.text().replace(/\s+/g, " ").trim().startsWith("图：")) caption.remove();
    image.remove();
  });
  for (const id of insertedMediaIds(draft)) {
    const placement = placements.get(id);
    if (placement && mustKeepVisibleAttribution(placement)) {
      visibleAttributions.push(
        `图片来源：${escapeHtml(captions.get(placement.id) || placement.caption || placement.image.caption || "配图")}｜${[
          ...plainAttributionDetails(placement),
        ].join("；")}`,
      );
    }
  }
  $("#article-root [data-ai-news-image]").remove();
  if (visibleAttributions.length) {
    $("#article-root").append(visibleAttributions.map((entry) => `<p>${entry}</p>`).join(""));
  }
  return sanitizeDraftHtml($("#article-root").html() ?? "");
};

export const insertedMediaIds = (draft: ArticleDraft) => {
  if (draft.contentFormat === "image-post" && draft.imagePostImageIds) return new Set(draft.imagePostImageIds);
  const $ = cheerio.load(`<article>${normalizedDraftBodyHtml(draft)}</article>`, null, false);
  return new Set(
    $("img[data-media-id]")
      .map((_index, element) => $(element).attr("data-media-id") || "")
      .get()
      .filter(Boolean),
  );
};
