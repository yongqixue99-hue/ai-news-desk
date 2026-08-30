import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import { normalizedDraftBodyHtml } from "./article-html.js";
import type {
  ArticleDraft,
  DraftImagePlacement,
  WeChatConnectionResult,
  WeChatDraftSyncReceipt,
} from "./types.js";
export type { WeChatConnectionResult, WeChatDraftSyncReceipt } from "./types.js";

export interface WeChatImageAsset {
  bytes: Uint8Array;
  fileName: string;
  contentType: "image/jpeg" | "image/png";
}

export interface WeChatDraftArticlePayload {
  title: string;
  author?: string;
  digest?: string;
  content: string;
  content_source_url?: string;
  thumb_media_id: string;
  need_open_comment: 0 | 1;
  only_fans_can_comment: 0 | 1;
}

export interface WeChatDraftGateway {
  countDrafts(): Promise<number>;
  uploadContentImage(asset: WeChatImageAsset): Promise<{ url: string }>;
  uploadPermanentImage(asset: WeChatImageAsset): Promise<{ mediaId: string; url?: string }>;
  addDraft(article: WeChatDraftArticlePayload): Promise<{ mediaId: string }>;
  updateDraft(mediaId: string, article: WeChatDraftArticlePayload): Promise<void>;
}

export interface WeChatDraftSyncInput {
  draft: ArticleDraft;
  author?: string;
  digest?: string;
  contentSourceUrl?: string;
  previousReceipt?: WeChatDraftSyncReceipt;
  now?: Date;
}

export interface WeChatDraftDesk {
  checkConnection(now?: Date): Promise<WeChatConnectionResult>;
  syncDraft(input: WeChatDraftSyncInput): Promise<WeChatDraftSyncReceipt>;
}

interface WeChatDraftDeskDependencies {
  gateway: WeChatDraftGateway;
  loadImage?: (placement: DraftImagePlacement) => Promise<WeChatImageAsset>;
}

const countCharacters = (value: string) => Array.from(value.trim()).length;

const assertDraftMetadata = (draft: ArticleDraft, author: string, digest: string) => {
  if (draft.contentFormat === "image-post") throw new Error("微信公众号草稿暂只支持文章格式");
  if (!draft.title.trim()) throw new Error("微信公众号草稿标题不能为空");
  if (countCharacters(draft.title) > 32) throw new Error("微信公众号标题不能超过 32 个字");
  if (countCharacters(author) > 16) throw new Error("微信公众号作者不能超过 16 个字");
  if (countCharacters(digest) > 120) throw new Error("微信公众号摘要不能超过 120 个字");
};

const applyWeChatStyles = ($: ReturnType<typeof cheerio.load>) => {
  const article = $("#wechat-article");
  article.find("p").attr("style", "margin:0 0 1.15em;font-size:16px;line-height:1.86;color:#25282d;");
  article.find("h1,h2,h3").attr("style", "margin:1.75em 0 .7em;font-size:20px;line-height:1.45;font-weight:700;color:#15171a;");
  article.find("blockquote").attr("style", "margin:1.35em 0;padding:.35em 0 .35em 1em;border-left:3px solid #d84a3e;color:#62666d;");
  article.find("a").attr("style", "color:#c83f35;text-decoration:underline;");
  article.find("img").attr("style", "display:block;max-width:100%;height:auto;margin:1.4em auto .55em;");
  article.find("img").each((_index, element) => {
    const caption = $(element).next("p").first();
    if (caption.text().replace(/\s+/g, " ").trim().startsWith("图：")) {
      caption.attr("style", "margin:.15em 0 1.5em;text-align:center;color:#858991;font-size:12px;line-height:1.6;");
    }
  });
};

const imageFingerprint = (asset: WeChatImageAsset) =>
  createHash("sha256").update(asset.bytes).digest("hex");

export const createWeChatDraftDesk = (
  dependencies: WeChatDraftDeskDependencies,
): WeChatDraftDesk => {
  const checkConnection: WeChatDraftDesk["checkConnection"] = async (now = new Date()) => {
    const checkedAt = now.toISOString();
    try {
      const draftCount = await dependencies.gateway.countDrafts();
      const result: WeChatConnectionResult = {
        ok: true,
        status: "connected",
        checkedAt,
        draftCount,
        detail: `公众号草稿接口已连接 · 当前 ${draftCount} 篇草稿`,
      };
      return result;
    } catch (error) {
      const result: WeChatConnectionResult = {
        ok: false,
        status: "error",
        checkedAt,
        detail: error instanceof Error ? error.message : "微信公众号连接失败",
      };
      return result;
    }
  };
  const syncDraft = async (input: WeChatDraftSyncInput): Promise<WeChatDraftSyncReceipt> => {
    if (!dependencies.loadImage) throw new Error("微信公众号图片读取器尚未配置");
    const author = input.author?.trim() ?? "";
    const digest = input.digest?.trim() ?? "";
    assertDraftMetadata(input.draft, author, digest);

    const $ = cheerio.load(
      `<article id="wechat-article">${normalizedDraftBodyHtml(input.draft)}</article>`,
      null,
      false,
    );
    const placements = new Map(input.draft.images.map((placement) => [placement.id, placement]));
    const usedIds = $("#wechat-article img[data-media-id]")
      .map((_index, element) => $(element).attr("data-media-id") ?? "")
      .get()
      .filter(Boolean);
    const usedPlacements = usedIds.map((id) => placements.get(id)).filter((placement): placement is DraftImagePlacement => Boolean(placement));
    if (!usedPlacements.length) throw new Error("微信公众号图文草稿需要封面，请先在正文插入至少一张图片");
    if (usedPlacements.length !== usedIds.length || $("#wechat-article img:not([data-media-id])").length) {
      throw new Error("正文存在未纳入素材库的图片，请重新插入后再同步公众号");
    }

    const readiness = evaluateDraftReadiness({ ...input.draft, images: usedPlacements }, "wechat");
    if (!readiness.ready) throw new Error(readiness.blockers.join("；"));

    const assets = new Map<string, WeChatImageAsset>();
    for (const placement of usedPlacements) {
      assets.set(placement.id, await dependencies.loadImage(placement));
    }
    const sourceHash = createHash("sha256").update(JSON.stringify({
      title: input.draft.title.trim(),
      author,
      digest,
      contentSourceUrl: input.contentSourceUrl?.trim() ?? "",
      bodyHtml: normalizedDraftBodyHtml(input.draft),
      images: usedPlacements.map((placement) => ({
        id: placement.id,
        fingerprint: imageFingerprint(assets.get(placement.id)!),
      })),
    })).digest("hex");
    const syncedAt = (input.now ?? new Date()).toISOString();
    if (input.previousReceipt?.contentHash === sourceHash) {
      return {
        ...input.previousReceipt,
        operation: "unchanged",
        syncedAt,
        localDraftUpdatedAt: input.draft.updatedAt,
      };
    }

    for (const placement of usedPlacements) {
      const uploaded = await dependencies.gateway.uploadContentImage(assets.get(placement.id)!);
      const image = $("#wechat-article img[data-media-id]").filter((_index, element) =>
        $(element).attr("data-media-id") === placement.id);
      image.attr("src", uploaded.url);
    }
    applyWeChatStyles($);
    $("#wechat-article img").each((_index, element) => {
      const image = $(element);
      for (const attribute of Object.keys(element.attribs)) {
        if (!["src", "alt", "title", "style"].includes(attribute)) image.removeAttr(attribute);
      }
    });

    const coverPlacementId = usedPlacements[0].id;
    const cover = await dependencies.gateway.uploadPermanentImage(assets.get(coverPlacementId)!);
    const article: WeChatDraftArticlePayload = {
      title: input.draft.title.trim(),
      ...(author ? { author } : {}),
      ...(digest ? { digest } : {}),
      content: $("#wechat-article").html() ?? "",
      ...(input.contentSourceUrl?.trim() ? { content_source_url: input.contentSourceUrl.trim() } : {}),
      thumb_media_id: cover.mediaId,
      need_open_comment: 0,
      only_fans_can_comment: 0,
    };
    const existingMediaId = input.previousReceipt?.mediaId;
    let mediaId = existingMediaId;
    let operation: WeChatDraftSyncReceipt["operation"] = "updated";
    if (existingMediaId) {
      await dependencies.gateway.updateDraft(existingMediaId, article);
    } else {
      mediaId = (await dependencies.gateway.addDraft(article)).mediaId;
      operation = "created";
    }
    if (!mediaId) throw new Error("微信没有返回草稿 media_id");
    return {
      schemaVersion: "wechat-draft-receipt/v1",
      draftId: input.draft.id,
      mediaId,
      operation,
      contentHash: sourceHash,
      syncedAt,
      localDraftUpdatedAt: input.draft.updatedAt,
      imageCount: usedPlacements.length,
      coverPlacementId,
    };
  };

  return { checkConnection, syncDraft };
};
