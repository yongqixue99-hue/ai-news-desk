import { createHash } from "node:crypto";
import * as cheerio from "cheerio";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import { bodyHtmlWithRequiredImageAttribution } from "./article-html.js";
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
  getDraft?(mediaId: string): Promise<WeChatDraftArticlePayload>;
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
  coverPlacementId?: string;
  previousReceipt?: WeChatDraftSyncReceipt;
  now?: Date;
}

export interface WeChatDraftDesk {
  checkConnection(now?: Date): Promise<WeChatConnectionResult>;
  syncDraft(input: WeChatDraftSyncInput): Promise<WeChatDraftSyncReceipt>;
}

interface WeChatDraftDeskDependencies {
  gateway: WeChatDraftGateway;
  beforeCommit?: () => Promise<void>;
  beforeRemoteWrite?: (operation: "created" | "updated", mediaId?: string) => Promise<void>;
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

/** Compare readable content and image order, not styles rewritten by the platform. */
export const wechatRemoteFingerprint = (article: WeChatDraftArticlePayload, includeDigest = true) => {
  const $ = cheerio.load(article.content || "");
  const text = (value: string | undefined) => (value || "").replace(/\s+/gu, " ").trim();
  return createHash("sha256").update(JSON.stringify({
    title: text(article.title), author: text(article.author),
    ...(includeDigest ? { digest: text(article.digest) } : {}),
    content: text($.root().text()),
    images: $("img").map((_i, element) => ($(element).attr("src") || "").replace(/^http:/u, "https:")).get(),
    cover: article.thumb_media_id,
    source: text(article.content_source_url),
  })).digest("hex");
};

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

    const deliveryBodyHtml = bodyHtmlWithRequiredImageAttribution(input.draft);
    const $ = cheerio.load(
      `<article id="wechat-article">${deliveryBodyHtml}</article>`,
      null,
      false,
    );
    const placements = new Map(input.draft.images.map((placement) => [placement.id, placement]));
    const usedIds = $("#wechat-article img[data-media-id]")
      .map((_index, element) => $(element).attr("data-media-id") ?? "")
      .get()
      .filter(Boolean);
    const usedPlacements = usedIds.map((id) => placements.get(id)).filter((placement): placement is DraftImagePlacement => Boolean(placement));
    const coverPlacement = input.coverPlacementId ? placements.get(input.coverPlacementId) : usedPlacements[0];
    if (!coverPlacement) throw new Error("微信公众号图文草稿需要封面，请选择一张已授权图片");
    const uploadPlacements = [...new Map([...usedPlacements, coverPlacement].map(item => [item.id, item])).values()];
    if (usedPlacements.length !== usedIds.length || $("#wechat-article img:not([data-media-id])").length) {
      throw new Error("正文存在未纳入素材库的图片，请重新插入后再同步公众号");
    }

    const readiness = evaluateDraftReadiness({ ...input.draft, images: uploadPlacements }, "wechat");
    if (!readiness.ready) throw new Error(readiness.blockers.join("；"));

    const assets = new Map<string, WeChatImageAsset>();
    for (const placement of uploadPlacements) {
      assets.set(placement.id, await dependencies.loadImage(placement));
    }
    const sourceHash = createHash("sha256").update(JSON.stringify({
      title: input.draft.title.trim(),
      author,
      digest,
      contentSourceUrl: input.contentSourceUrl?.trim() ?? "",
      bodyHtml: deliveryBodyHtml,
      coverPlacementId: coverPlacement.id,
      images: uploadPlacements.map((placement) => ({
        id: placement.id,
        fingerprint: imageFingerprint(assets.get(placement.id)!),
      })),
    })).digest("hex");
    const syncedAt = (input.now ?? new Date()).toISOString();
    let existingRemote: WeChatDraftArticlePayload | undefined;
    if (input.previousReceipt?.mediaId && dependencies.gateway.getDraft) {
      existingRemote = await dependencies.gateway.getDraft(input.previousReceipt.mediaId);
      if (input.previousReceipt.remoteFingerprint && wechatRemoteFingerprint(existingRemote) !== input.previousReceipt.remoteFingerprint) {
        throw new Error("微信后台草稿已被修改，本次未覆盖。请先打开公众号草稿箱核对，或使用复制排版合并修改");
      }
      if (!input.previousReceipt.remoteFingerprint && input.previousReceipt.remoteContentFingerprint &&
        (wechatRemoteFingerprint(existingRemote, false) !== input.previousReceipt.remoteContentFingerprint ||
          (input.previousReceipt.sentDigest && existingRemote.digest !== input.previousReceipt.sentDigest))) {
        throw new Error("微信草稿回读内容与上次发送版本不一致，请到公众号后台核对，本次未覆盖");
      }
    }
    if (input.previousReceipt?.contentHash === sourceHash) {
      await dependencies.beforeCommit?.();
      return {
        ...input.previousReceipt,
        operation: "unchanged",
        ...(existingRemote && (input.previousReceipt.remoteFingerprint || input.previousReceipt.remoteContentFingerprint) ? { verification: "verified" as const, verifiedAt: syncedAt, verificationDetail: undefined, remoteFingerprint: wechatRemoteFingerprint(existingRemote) } : {}),
        syncedAt,
        localDraftUpdatedAt: input.draft.updatedAt,
      };
    }

    for (const placement of [...new Map(usedPlacements.map(item => [item.id, item])).values()]) {
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

    const coverPlacementId = coverPlacement.id;
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
    await dependencies.beforeCommit?.();
    await dependencies.beforeRemoteWrite?.(existingMediaId ? "updated" : "created", existingMediaId);
    let mediaId = existingMediaId;
    let operation: WeChatDraftSyncReceipt["operation"] = "updated";
    if (existingMediaId) {
      await dependencies.gateway.updateDraft(existingMediaId, article);
    } else {
      mediaId = (await dependencies.gateway.addDraft(article)).mediaId;
      operation = "created";
    }
    if (!mediaId) throw new Error("微信没有返回草稿 media_id");
    let verification: "verified" | "pending" = "pending";
    let verificationDetail = "微信已返回草稿编号，尚未完成内容回读";
    const remoteContentFingerprint = wechatRemoteFingerprint(article, false);
    let remoteFingerprint: string | undefined;
    if (dependencies.gateway.getDraft) {
      try {
        const remote = await dependencies.gateway.getDraft(mediaId);
        if (wechatRemoteFingerprint(remote, false) === remoteContentFingerprint && (!article.digest || remote.digest === article.digest)) {
          verification = "verified";
          remoteFingerprint = wechatRemoteFingerprint(remote);
          verificationDetail = "已回读核对标题、正文、图片顺序与封面";
        } else verificationDetail = "微信已保存，但回读内容与发送版本不一致，请打开草稿箱核对";
      } catch (error) { verificationDetail = `微信已返回草稿编号，回读未完成：${error instanceof Error ? error.message : "网络错误"}。再次同步将先核对原稿，不会重复新建`; }
    }
    return {
      verification, verificationDetail, remoteFingerprint, remoteContentFingerprint, sentDigest: digest,
      ...(verification === "verified" ? { verifiedAt: syncedAt } : {}),
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
