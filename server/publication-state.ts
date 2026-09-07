import { createHash } from "node:crypto";
import { insertedMediaIds, normalizedDraftBodyHtml } from "./article-html.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import type { PublisherReceipt } from "./publisher-preflight.js";
import type {
  ArticleDraft,
  PlatformPublicationConfirmation,
  PublicationPlatform,
  PublisherResult,
  WeChatDraftSyncReceipt,
} from "./types.js";

const sha256 = (value: unknown) => createHash("sha256")
  .update(JSON.stringify(value))
  .digest("hex");

const normalizedText = (value: string | undefined) => value?.trim() ?? "";

const normalizedTextSet = (values: string[] | undefined) => [...new Set(
  (values ?? []).map((value) => normalizedText(value).toLowerCase()).filter(Boolean),
)].sort();

const publishableImages = (draft: ArticleDraft) => {
  const inserted = insertedMediaIds(draft);
  return draft.images
    .filter((placement) => inserted.has(placement.id))
    .map((placement) => ({
      id: placement.id,
      caption: normalizedText(placement.caption),
      fingerprint: normalizedText(placement.image.fingerprint),
      publicPath: normalizedText(placement.image.publicPath),
      url: normalizedText(placement.image.url),
      attribution: normalizedText(placement.image.attribution),
      sourceUrl: normalizedText(placement.image.sourceUrl),
      rights: normalizedText(placement.image.rights),
      evidenceNote: normalizedText(placement.image.evidenceNote),
      evidencePath: normalizedText(placement.image.evidencePath),
      licenseId: normalizedText(placement.image.licenseId),
      licenseUrl: normalizedText(placement.image.licenseUrl),
      modificationNote: normalizedText(placement.image.modificationNote),
      allowedPlatforms: normalizedTextSet(placement.image.allowedPlatforms),
      expiresAt: normalizedText(placement.image.expiresAt),
    }));
};

/**
 * Identifies the local content that a platform delivery represents. Platform-
 * specific editor metadata is deliberately scoped so changing Xiaoheihe tags
 * does not invalidate an otherwise unchanged WeChat publication.
 */
export const publicationRevisionHash = (
  draft: ArticleDraft,
  platform: PublicationPlatform,
) => sha256({
  platform,
  contentFormat: draft.contentFormat ?? "article",
  title: normalizedText(draft.title),
  bodyHtml: normalizedDraftBodyHtml(draft),
  images: publishableImages(draft),
  ...(platform === "wechat" ? {
    // The sync API uses take as its default digest, so it is publishable even
    // when bodyHtml is already the authoritative article document.
    defaultDigest: normalizedText(draft.take),
  } : {}),
  ...(platform === "xiaoheihe" ? {
    imagePostImageIds: draft.contentFormat === "image-post" ? [...insertedMediaIds(draft)] : undefined,
    community: normalizedText(draft.community),
    topics: draft.topics.map((topic) => normalizedText(topic)).filter(Boolean),
  } : {}),
});

export class PublicationRevisionConflictError extends Error {
  readonly code = "PUBLISHER_REVISION_CONFLICT";
  readonly statusCode = 409;

  constructor(
    readonly draftId: string,
    readonly expectedRevisionHash: string,
    readonly actualRevisionHash: string,
  ) {
    super("草稿在发布预检后已发生变化，请重新预检后再填入编辑器");
    this.name = "PublicationRevisionConflictError";
  }
}

/** Refuses to let a transport operation silently switch from its audited
 * preflight snapshot to a newer mutable draft. */
export const assertPublicationRevision = (
  draft: ArticleDraft,
  platform: PublicationPlatform,
  expectedRevisionHash: string,
) => {
  const actualRevisionHash = publicationRevisionHash(draft, platform);
  if (actualRevisionHash !== expectedRevisionHash) {
    throw new PublicationRevisionConflictError(
      draft.id,
      expectedRevisionHash,
      actualRevisionHash,
    );
  }
  return actualRevisionHash;
};

const confirmationMap = (draft: ArticleDraft) => {
  draft.publicationConfirmations ??= {};
  return draft.publicationConfirmations;
};

const deliveryReceiptId = (draft: ArticleDraft, platform: PublicationPlatform) => (
  platform === "wechat"
    ? draft.wechatDraft?.mediaId
    : draft.publisherReceipt?.outcome === "filled"
      ? draft.publisherReceipt.attemptId
      : undefined
);

const deliveryRevisionHash = (draft: ArticleDraft, platform: PublicationPlatform) => (
  platform === "wechat"
    ? draft.wechatDraft?.revisionHash
    : draft.publisherReceipt?.revisionHash
);

const currentConfirmation = (
  draft: ArticleDraft,
  platform: PublicationPlatform,
) => {
  const confirmation = draft.publicationConfirmations?.[platform];
  if (!confirmation || confirmation.staleAt) return undefined;
  if (confirmation.revisionHash !== publicationRevisionHash(draft, platform)) return undefined;
  if (confirmation.receiptId !== deliveryReceiptId(draft, platform)) return undefined;
  if (confirmation.revisionHash !== deliveryRevisionHash(draft, platform)) return undefined;
  if (
    platform === "wechat"
    && confirmation.deliveryContentHash !== draft.wechatDraft?.contentHash
  ) return undefined;
  return confirmation;
};

export const currentPublicationConfirmation = (
  draft: ArticleDraft,
  platform: PublicationPlatform,
) => currentConfirmation(draft, platform);

export const hasCurrentPublication = (draft: ArticleDraft) => (
  Boolean(currentConfirmation(draft, "wechat") || currentConfirmation(draft, "xiaoheihe"))
);

const markStale = (
  draft: ArticleDraft,
  platform: PublicationPlatform,
  at: string,
) => {
  const confirmation = draft.publicationConfirmations?.[platform];
  if (confirmation && !confirmation.staleAt) confirmation.staleAt = at;
};

const synchronizeLegacyPublicationFields = (draft: ArticleDraft) => {
  const current = (["wechat", "xiaoheihe"] as const)
    .map((platform) => currentConfirmation(draft, platform))
    .filter((confirmation): confirmation is PlatformPublicationConfirmation => Boolean(confirmation))
    .sort((left, right) => right.confirmedAt.localeCompare(left.confirmedAt));

  const latest = current[0];
  if (latest) {
    draft.publicationConfirmedAt = latest.confirmedAt;
    draft.publicationReceiptId = latest.receiptId;
    if (draft.status !== "shelved") draft.status = "published";
    return;
  }

  delete draft.publicationConfirmedAt;
  delete draft.publicationReceiptId;
  if (draft.status !== "published") return;

  const currentXiaoheiheDelivery = draft.publisherReceipt?.outcome === "filled"
    && (
      !draft.publisherReceipt.revisionHash
      || draft.publisherReceipt.revisionHash === publicationRevisionHash(draft, "xiaoheihe")
    );
  draft.status = currentXiaoheiheDelivery ? "filled" : "editing";
};

const migrateLegacyConfirmation = (draft: ArticleDraft) => {
  if (!draft.publicationConfirmedAt || !draft.publicationReceiptId) return;
  if (draft.publicationConfirmations?.wechat || draft.publicationConfirmations?.xiaoheihe) return;

  const map = confirmationMap(draft);
  if (draft.wechatDraft?.mediaId === draft.publicationReceiptId) {
    const revisionHash = publicationRevisionHash(draft, "wechat");
    // localDraftUpdatedAt was part of the v1 receipt and is the only safe
    // migration proof available for old WeChat acknowledgements.
    if (draft.wechatDraft.localDraftUpdatedAt === draft.updatedAt) {
      draft.wechatDraft.revisionHash = revisionHash;
      map.wechat = {
        platform: "wechat",
        confirmedAt: draft.publicationConfirmedAt,
        receiptId: draft.publicationReceiptId,
        revisionHash,
        deliveryContentHash: draft.wechatDraft.contentHash,
      };
      return;
    }
  }

  if (draft.publisherReceipt?.attemptId === draft.publicationReceiptId) {
    const revisionHash = draft.publisherReceipt.revisionHash;
    map.xiaoheihe = {
      platform: "xiaoheihe",
      confirmedAt: draft.publicationConfirmedAt,
      receiptId: draft.publicationReceiptId,
      revisionHash: revisionHash ?? "legacy-unversioned",
      staleAt: revisionHash ? undefined : draft.publicationConfirmedAt,
    };
  }
};

/** Upgrade old singleton publication state without treating an unverifiable
 * acknowledgement as proof that the current local revision was published. */
export const normalizeDraftPublicationState = (draft: ArticleDraft) => {
  migrateLegacyConfirmation(draft);

  for (const platform of ["wechat", "xiaoheihe"] as const) {
    const confirmation = draft.publicationConfirmations?.[platform];
    if (!confirmation || confirmation.staleAt) continue;
    if (!currentConfirmation(draft, platform)) {
      confirmation.staleAt = confirmation.confirmedAt;
    }
  }
  synchronizeLegacyPublicationFields(draft);
  if (draft.publicationConfirmations && Object.keys(draft.publicationConfirmations).length === 0) {
    delete draft.publicationConfirmations;
  }
  return draft;
};

/** Reconcile version-bound publication state after a local draft edit. */
export const reconcileDraftPublicationAfterEdit = (
  before: ArticleDraft,
  draft: ArticleDraft,
  at: string,
) => {
  normalizeDraftPublicationState(before);
  const requestedStatus = draft.status;
  let publishableContentChanged = false;
  let deliveredContentChanged = false;
  draft.publicationConfirmations = before.publicationConfirmations
    ? structuredClone(before.publicationConfirmations)
    : undefined;
  if (
    draft.wechatDraft
    && before.wechatDraft?.mediaId === draft.wechatDraft.mediaId
    && !draft.wechatDraft.revisionHash
  ) draft.wechatDraft.revisionHash = before.wechatDraft.revisionHash;
  draft.publicationConfirmedAt = before.publicationConfirmedAt;
  draft.publicationReceiptId = before.publicationReceiptId;

  for (const platform of ["wechat", "xiaoheihe"] as const) {
    if (publicationRevisionHash(before, platform) !== publicationRevisionHash(draft, platform)) {
      publishableContentChanged = true;
      deliveredContentChanged ||= platform === "wechat"
        ? Boolean(before.wechatDraft || before.publicationConfirmations?.wechat)
        : Boolean(
          before.publisherReceipt?.outcome === "filled"
          || before.publicationConfirmations?.xiaoheihe,
        );
      markStale(draft, platform, at);
    }
  }
  synchronizeLegacyPublicationFields(draft);
  if (!publishableContentChanged && requestedStatus !== before.status) {
    draft.status = requestedStatus;
  } else if (deliveredContentChanged && !hasCurrentPublication(draft) && draft.status !== "shelved") {
    draft.status = draft.publisherReceipt?.outcome === "filled"
      && draft.publisherReceipt.revisionHash === publicationRevisionHash(draft, "xiaoheihe")
      ? "filled"
      : "editing";
  }
  return draft;
};

export const attachWeChatDeliveryReceipt = (
  draft: ArticleDraft,
  receipt: WeChatDraftSyncReceipt,
  at: string,
) => {
  normalizeDraftPublicationState(draft);
  const revisionHash = receipt.revisionHash ?? publicationRevisionHash(draft, "wechat");
  receipt.revisionHash = revisionHash;

  const confirmation = draft.publicationConfirmations?.wechat;
  if (
    confirmation
    && !confirmation.staleAt
    && (
      confirmation.receiptId !== receipt.mediaId
      || confirmation.revisionHash !== revisionHash
      || confirmation.deliveryContentHash !== receipt.contentHash
    )
  ) markStale(draft, "wechat", at);

  draft.wechatDraft = receipt;
  synchronizeLegacyPublicationFields(draft);
  return receipt;
};

export const attachXiaoheiheDeliveryReceipt = (
  draft: ArticleDraft,
  receipt: PublisherReceipt,
  at: string,
) => {
  normalizeDraftPublicationState(draft);
  receipt.revisionHash ??= publicationRevisionHash(draft, "xiaoheihe");
  markStale(draft, "xiaoheihe", at);
  draft.publisherReceipt = receipt;
  synchronizeLegacyPublicationFields(draft);
  if (!hasCurrentPublication(draft)) {
    draft.status = receipt.outcome === "filled"
      && receipt.revisionHash === publicationRevisionHash(draft, "xiaoheihe")
      ? "filled"
      : "editing";
  }
  return receipt;
};

/** Records every browser attempt for UI/audit, but only replaces the draft's
 * successful delivery pointer when the receipt is both filled and represents
 * the exact current publishable revision. */
export const recordXiaoheiheFillAttempt = (
  draft: ArticleDraft,
  result: PublisherResult,
  receipt: PublisherReceipt,
  at: string,
) => {
  result.receipt ??= receipt;
  draft.fillResult = result;
  const representsCurrentRevision = receipt.outcome === "filled"
    && Boolean(receipt.revisionHash)
    && receipt.revisionHash === publicationRevisionHash(draft, "xiaoheihe");
  if (!representsCurrentRevision) return false;
  attachXiaoheiheDeliveryReceipt(draft, receipt, at);
  return true;
};

export interface ConfirmDraftPublicationResult {
  alreadyConfirmed: boolean;
  confirmation: PlatformPublicationConfirmation;
}

export interface ConfirmDraftPublicationOptions {
  /** SHA-256 values read from the managed files immediately before confirmation. */
  actualImageFingerprints?: Readonly<Record<string, string | undefined>>;
}

const assertConfirmationImageFingerprints = (
  draft: ArticleDraft,
  inserted: ReadonlySet<string>,
  actualImageFingerprints: ConfirmDraftPublicationOptions["actualImageFingerprints"],
) => {
  const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
  for (const placementId of inserted) {
    const placement = placements.get(placementId);
    if (!placement) throw new Error(`正文图片 ${placementId} 没有对应的草稿图片记录，请重新插入图片`);
    const label = placement.caption || placement.image.caption || placementId;
    const reviewed = placement.image.fingerprint?.trim().toLowerCase() || "";
    if (!/^[a-f0-9]{64}$/u.test(reviewed)) {
      throw new Error(`图片“${label}”缺少已审核的 SHA-256 指纹，请重新插入图片并再次同步或填入编辑器`);
    }
    const actual = actualImageFingerprints?.[placementId]?.trim().toLowerCase() || "";
    if (!/^[a-f0-9]{64}$/u.test(actual)) {
      throw new Error(`无法核验图片“${label}”的本地文件指纹，请确认文件存在后重新同步或填入编辑器`);
    }
    if (actual !== reviewed) {
      throw new Error(`图片“${label}”的本地文件已发生变化，请重新插入图片并再次同步或填入编辑器`);
    }
  }
};

export const confirmDraftPublication = (
  draft: ArticleDraft,
  platform: PublicationPlatform,
  confirmedAt: string,
  options: ConfirmDraftPublicationOptions = {},
): ConfirmDraftPublicationResult => {
  normalizeDraftPublicationState(draft);
  const revisionHash = publicationRevisionHash(draft, platform);

  if (platform === "wechat") {
    if (!draft.wechatDraft) throw new Error("请先同步到微信公众号草稿箱，再确认发布");
    if (!draft.wechatDraft.revisionHash) {
      if (draft.wechatDraft.localDraftUpdatedAt !== draft.updatedAt) {
        throw new Error("本地正文已变化，请先更新微信公众号草稿箱");
      }
      draft.wechatDraft.revisionHash = revisionHash;
    }
    if (draft.wechatDraft.revisionHash !== revisionHash) {
      throw new Error("本地正文已变化，请先更新微信公众号草稿箱");
    }
  } else {
    if (draft.publisherReceipt?.outcome !== "filled") {
      throw new Error("请先把当前草稿填入小黑盒编辑器");
    }
    if (!draft.publisherReceipt.revisionHash) {
      throw new Error("旧填入回执无法确认当前版本，请重新填入小黑盒编辑器");
    }
    if (draft.publisherReceipt.revisionHash !== revisionHash) {
      throw new Error("本地正文已变化，请重新填入小黑盒编辑器");
    }
  }

  const inserted = insertedMediaIds(draft);
  assertConfirmationImageFingerprints(draft, inserted, options.actualImageFingerprints);
  const readiness = evaluateDraftReadiness({
    ...draft,
    images: draft.images.filter((placement) => inserted.has(placement.id)),
  }, platform, confirmedAt);
  if (!readiness.ready) {
    throw new Error(`当前版本未通过发布准备度检查：${readiness.blockers.join("；")}`);
  }

  const existing = currentConfirmation(draft, platform);
  if (existing) return { alreadyConfirmed: true, confirmation: existing };

  const receiptId = deliveryReceiptId(draft, platform);
  if (!receiptId) throw new Error("没有可确认的发布回执");
  const confirmation: PlatformPublicationConfirmation = {
    platform,
    confirmedAt,
    receiptId,
    revisionHash,
    ...(platform === "wechat" ? { deliveryContentHash: draft.wechatDraft?.contentHash } : {}),
  };
  confirmationMap(draft)[platform] = confirmation;
  synchronizeLegacyPublicationFields(draft);
  return { alreadyConfirmed: false, confirmation };
};
