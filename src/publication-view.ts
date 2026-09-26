import type { ArticleDraft, PlatformPublicationConfirmation, PublicationPlatform } from "./types";

export interface PlatformDeliveryViewInput {
  platform: PublicationPlatform;
  status?: string;
  dirty?: boolean;
  loadFailed?: boolean;
}

export type PlatformDeliveryDisplayStatus = "checking" | "unknown" | "never" | "current" | "changed" | "pending" | "failed";

export interface DraftDeliverySnapshot<T> {
  draftId: string;
  updatedAt: string;
  value?: T;
  loadFailed?: boolean;
}

export const currentDraftDeliverySnapshot = <T>(
  draft: Pick<ArticleDraft, "id" | "updatedAt"> | undefined,
  snapshot: DraftDeliverySnapshot<T> | undefined,
) => draft && snapshot?.draftId === draft.id && snapshot.updatedAt === draft.updatedAt ? snapshot : undefined;

/** Missing/failed reads cannot prove that a delivered draft changed. */
export const platformDeliveryView = ({ platform, status, dirty, loadFailed }: PlatformDeliveryViewInput) => {
  const known = ["unknown", "never", "current", "changed", "pending", "failed"].includes(status ?? "");
  const resolved: PlatformDeliveryDisplayStatus = dirty && ["current", "pending"].includes(status ?? "")
    ? "changed" : known ? status as PlatformDeliveryDisplayStatus : loadFailed ? "unknown" : "checking";
  const label = resolved === "current" ? platform === "wechat" ? "已核对" : "已填入"
    : resolved === "changed" ? "修改待同步" : resolved === "unknown" ? "待核对结果"
    : resolved === "pending" ? "待回读核对" : resolved === "failed" ? "需要处理"
    : resolved === "checking" ? "正在核对" : "未发送";
  return { status: resolved, label, stale: resolved === "changed" };
};

export const currentPlatformPublicationConfirmation = (
  draft: Pick<ArticleDraft, "publicationConfirmations">,
  platform: PublicationPlatform,
): PlatformPublicationConfirmation | undefined => {
  const confirmation = draft.publicationConfirmations?.[platform];
  return confirmation && !confirmation.staleAt ? confirmation : undefined;
};

export const withoutPlatformPublicationConfirmation = (
  draft: Pick<ArticleDraft, "publicationConfirmations">,
  platform: PublicationPlatform,
) => {
  if (!draft.publicationConfirmations?.[platform]) return draft.publicationConfirmations;
  const next = { ...draft.publicationConfirmations };
  delete next[platform];
  return Object.keys(next).length ? next : undefined;
};
