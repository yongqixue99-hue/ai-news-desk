import { randomUUID } from "node:crypto";
import { insertedMediaIds, normalizedDraftBodyHtml } from "./article-html.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import { publicationRevisionHash } from "./publication-state.js";
import { wechatMetadataFor } from "./wechat-metadata.js";
import type { ArticleDraft, WeChatChannelSettings, WeChatSyncAttempt } from "./types.js";

export const unresolvedWeChatAttempt = (draft: ArticleDraft, appId: string) =>
  draft.wechatSyncAttempts?.find(attempt => attempt.appId === appId && ["sending", "unknown"].includes(attempt.status));

export const beginWeChatAttempt = (draft: ArticleDraft, appId: string, operation: "created" | "updated", mediaId?: string): WeChatSyncAttempt => {
  if (unresolvedWeChatAttempt(draft, appId)) throw new Error("上次微信发送结果尚未核对，请先检查公众号草稿箱；本次没有重复发送");
  const attempt: WeChatSyncAttempt = { id: randomUUID(), appId, startedAt: new Date().toISOString(), revisionHash: publicationRevisionHash(draft, "wechat"), operation, mediaId, status: "sending" };
  draft.wechatSyncAttempts = [attempt, ...(draft.wechatSyncAttempts ?? [])];
  return attempt;
};

export const resolveWeChatAttempt = (draft: ArticleDraft, attemptId: string) => {
  const attempt = draft.wechatSyncAttempts?.find(item => item.id === attemptId);
  if (!attempt || !["unknown", "sending"].includes(attempt.status)) throw new Error("该发送记录已变化，请刷新后重新核对");
  attempt.status = "not-received";
  attempt.detail = "用户已在公众号草稿箱核对，确认本次未收到，允许重新发送";
};

export const primaryDeliveryStatus = (draft: ArticleDraft, appId: string) => {
  const wechatRevision = publicationRevisionHash(draft, "wechat");
  const xhhRevision = publicationRevisionHash(draft, "xiaoheihe");
  const receipt = draft.wechatDraft;
  const unresolved = unresolvedWeChatAttempt(draft, appId);
  const sameAccount = receipt && (!receipt.appId || receipt.appId === appId);
  const wechatCurrent = sameAccount && receipt.revisionHash === wechatRevision;
  const xhh = draft.publisherReceipt;
  const lastFillFailed = draft.fillResult && !draft.fillResult.ok && (!xhh || draft.fillResult.at >= xhh.completedAt);
  return {
    wechat: { status: unresolved ? "unknown" : !receipt ? "never" : !wechatCurrent ? "changed" : receipt.verification === "verified" ? "current" : "pending",
      receipt: sameAccount ? receipt : undefined, unresolved, accountChanged: Boolean(receipt && !sameAccount) },
    xiaoheihe: { status: lastFillFailed ? "failed" : !xhh ? "never" : xhh.outcome !== "filled" ? "failed" : xhh.revisionHash !== xhhRevision ? "changed" : "current", receipt: xhh },
  };
};
export type PrimaryDeliveryStatus = ReturnType<typeof primaryDeliveryStatus>;

export const wechatPreflight = (draft: ArticleDraft, settings: WeChatChannelSettings, qualityBlockers: string[] = []) => {
  const metadata = wechatMetadataFor(draft, settings);
  const used = insertedMediaIds(draft);
  const cover = draft.images.find(image => image.id === (metadata.coverPlacementId || [...used][0]));
  const images = draft.images.filter(image => used.has(image.id) || image.id === cover?.id);
  const readiness = evaluateDraftReadiness({ ...draft, images }, "wechat");
  const count = (value: string) => Array.from(value.trim()).length;
  const blockers = [
    ...(!settings.appId || !settings.appSecretConfigured ? ["公众号尚未连接，请先保存 AppID 和 AppSecret"] : []),
    ...(draft.contentFormat === "image-post" ? ["公众号当前支持文章，请切换为文章后同步"] : []),
    ...(!count(draft.title) || count(draft.title) > 32 ? ["公众号标题需要 1–32 个字"] : []),
    ...(!normalizedDraftBodyHtml(draft).replace(/<[^>]+>/gu, "").trim() ? ["请先填写正文"] : []),
    ...(count(metadata.author) > 16 ? ["公众号作者不能超过 16 个字"] : []),
    ...(count(metadata.digest) > 120 ? ["公众号摘要不能超过 120 个字"] : []),
    ...(metadata.contentSourceUrl.trim() && !/^https?:\/\//iu.test(metadata.contentSourceUrl.trim()) ? ["原文链接需以 http:// 或 https:// 开头"] : []),
    ...(!cover ? ["请先选择一张已授权的公众号封面"] : []),
    ...readiness.blockers, ...qualityBlockers,
  ];
  return { ready: blockers.length === 0, blockers: [...new Set(blockers)], imageCount: used.size, coverPlacementId: cover?.id };
};
