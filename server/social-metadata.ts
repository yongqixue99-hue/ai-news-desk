import { socialPlatforms, type SocialPlatform } from "./social-delivery-types.js";
import type { ArticleDraft, SocialDraftMetadata } from "./types.js";

export const normalizeSocialMetadata = (input: unknown): SocialDraftMetadata => {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("平台配置格式无效");
  const result: SocialDraftMetadata = {};
  for (const [id, raw] of Object.entries(input)) {
    if (!socialPlatforms.some(platform => platform.id === id) || !raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("平台配置格式无效");
    const value = raw as Record<string, unknown>;
    if (value.title !== undefined && (typeof value.title !== "string" || Array.from(value.title).length > 300)) throw new Error("平台标题需为不超过 300 字的文本");
    if (value.coverPlacementId !== undefined && (typeof value.coverPlacementId !== "string" || value.coverPlacementId.length > 200)) throw new Error("平台封面配置无效");
    const title = typeof value.title === "string" ? value.title.trim() : "";
    const coverPlacementId = typeof value.coverPlacementId === "string" ? value.coverPlacementId.trim() : "";
    if (title || coverPlacementId) result[id as SocialPlatform] = { ...(title ? { title } : {}), ...(coverPlacementId ? { coverPlacementId } : {}) };
  }
  return result;
};

export const socialArticleTitle = (draft: ArticleDraft, platform: SocialPlatform) => draft.socialMetadata?.[platform]?.title?.trim() || draft.title.trim();
/** Keep legacy/default delivery hashes stable; unrelated platform edits do not invalidate a receipt. */
export const socialMetadataBinding = (draft: ArticleDraft, platform: SocialPlatform) => {
  const title = socialArticleTitle(draft, platform);
  const coverPlacementId = draft.socialMetadata?.[platform]?.coverPlacementId?.trim();
  return title !== draft.title.trim() || coverPlacementId ? JSON.stringify({ title, coverPlacementId: coverPlacementId || null }) : "";
};
