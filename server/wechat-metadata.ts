import type { ArticleDraft, WeChatChannelSettings, WeChatDraftMetadata } from "./types.js";

export const wechatMetadataFor = (draft: ArticleDraft | undefined, settings: Pick<WeChatChannelSettings, "defaultAuthor">): WeChatDraftMetadata => ({
  author: draft?.wechatMetadata?.author ?? settings.defaultAuthor,
  digest: draft?.wechatMetadata?.digest ?? Array.from(draft?.take.trim() ?? "").slice(0, 120).join(""),
  contentSourceUrl: draft?.wechatMetadata?.contentSourceUrl ?? draft?.provenance.originalUrl ?? "",
  ...(draft?.wechatMetadata?.coverPlacementId ? { coverPlacementId: draft.wechatMetadata.coverPlacementId } : {}),
});

export const normalizeWeChatMetadata = (value: unknown): WeChatDraftMetadata => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("公众号信息格式无效");
  const input = value as Record<string, unknown>;
  for (const key of ["author", "digest", "contentSourceUrl"] as const) {
    if (typeof input[key] !== "string" || input[key].length > 4000) throw new Error("公众号信息格式无效");
  }
  if (input.coverPlacementId !== undefined && (typeof input.coverPlacementId !== "string" || input.coverPlacementId.length > 200)) throw new Error("封面选择无效");
  return { author: input.author as string, digest: input.digest as string, contentSourceUrl: input.contentSourceUrl as string,
    ...(input.coverPlacementId ? { coverPlacementId: input.coverPlacementId as string } : {}) };
};
