import { createHash } from "node:crypto";
import type { createDeliveryDesk } from "./delivery-desk.js";
import type { reviewDraftQuality } from "./draft-quality-review.js";
import { beginWeChatAttempt, unresolvedWeChatAttempt, wechatPreflight } from "./primary-delivery.js";
import { assertPublicationRevision, attachWeChatDeliveryReceipt, publicationRevisionHash } from "./publication-state.js";
import { createWeChatDraftDesk, type WeChatDraftGateway, type WeChatImageAsset } from "./wechat-draft.js";
import { WeChatApiError } from "./wechat-http.js";
import { wechatMetadataFor } from "./wechat-metadata.js";
import type { ArticleDraft, DraftImagePlacement, WeChatDraftSyncReceipt, WorkflowState } from "./types.js";

interface Dependencies {
  deliveryDesk: Pick<ReturnType<typeof createDeliveryDesk>, "sync">;
  read: () => Promise<WorkflowState>;
  update: <T>(mutate: (state: WorkflowState) => T | Promise<T>) => Promise<T>;
  gateway: (appId: string, signal?: AbortSignal) => Promise<WeChatDraftGateway>;
  review: (draft: ArticleDraft) => Promise<ReturnType<typeof reviewDraftQuality>>;
  loadImage: (placement: DraftImagePlacement) => Promise<WeChatImageAsset>;
}

const metadataHash = (draft: ArticleDraft, state: WorkflowState) => createHash("sha256")
  .update(JSON.stringify(wechatMetadataFor(draft, state.settings.wechat))).digest("hex");
export const wechatDeliveryRevision = (draft: ArticleDraft, state: WorkflowState) => `${publicationRevisionHash(draft, "wechat")}:${state.settings.wechat.appId}:${metadataHash(draft, state)}`;

/** One delivery operation for HTTP and batches; recovery never performs a remote mutation. */
export const createWeChatDelivery = (dependencies: Dependencies) => ({
  async deliver(draftId: string, expectedUpdatedAt?: string, expectedRevision?: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const initial = await dependencies.read();
    const initialDraft = initial.drafts.find(item => item.id === draftId);
    if (!initialDraft) throw new Error("草稿不存在");
    if (expectedRevision && wechatDeliveryRevision(initialDraft, initial) !== expectedRevision) throw new Error("正文版本、公众号账号或设置已变化，请重新交付");
    const account = initial.settings.wechat;
    if (!account.appId || !account.appSecretConfigured) throw new Error("请先在自动化 → 平台连接中连接微信公众号");
    const revision = publicationRevisionHash(initialDraft, "wechat");
    const metadata = metadataHash(initialDraft, initial);
    return dependencies.deliveryDesk.sync({ draftId, channel: "wechat", revision: `${account.appId}:${revision}:${metadata}` }, async () => {
      signal?.throwIfAborted();
      let state = await dependencies.read();
      let draft = state.drafts.find(item => item.id === draftId);
      if (!draft) throw new Error("同步开始前本地草稿已被删除");
      if (expectedUpdatedAt && draft.updatedAt !== expectedUpdatedAt) throw new Error("草稿已在其他窗口变化，请刷新后重新同步");
      assertPublicationRevision(draft, "wechat", revision);
      if (state.settings.wechat.appId !== account.appId || metadataHash(draft, state) !== metadata) throw new Error("公众号账号或默认设置已变化，请重新同步");
      const gateway = await dependencies.gateway(account.appId, signal);
      const pending = unresolvedWeChatAttempt(draft, account.appId);
      if (pending) {
        const recovered = await createWeChatDraftDesk({ gateway }).recoverAttempt({ draftId, appId: account.appId, attempt: pending });
        if (!recovered) throw new Error("上次微信发送结果暂未核对成功；本次只检查原稿，未重复发送。请打开公众号草稿箱核对");
        await dependencies.update(current => {
          const target = current.drafts.find(item => item.id === draftId) ?? current.draftTrash?.find(item => item.draft.id === draftId)?.draft;
          const attempt = target?.wechatSyncAttempts?.find(item => item.id === pending.id);
          if (!target || !attempt || !["sending", "unknown"].includes(attempt.status)) throw new Error("发送记录已变化，请刷新后核对");
          attachWeChatDeliveryReceipt(target, recovered, recovered.verifiedAt!);
          attempt.status = "complete";
          attempt.detail = recovered.verificationDetail;
        });
        state = await dependencies.read();
        draft = state.drafts.find(item => item.id === draftId);
        if (!draft) throw new Error("上次发送结果已保存，但本地草稿已移入回收站");
      }
      const quality = await dependencies.review(draft);
      const preflight = wechatPreflight(draft, state.settings.wechat, quality.blockers);
      if (!preflight.ready) throw new Error(preflight.blockers.join("；"));
      const assertCurrent = async (current: WorkflowState) => {
        signal?.throwIfAborted();
        if (current.settings.wechat.appId !== account.appId) throw new Error("公众号账号已变化，请重新检查后同步");
        const target = current.drafts.find(item => item.id === draftId);
        if (!target) throw new Error("草稿已不存在");
        assertPublicationRevision(target, "wechat", revision);
        if (metadataHash(target, current) !== metadata) throw new Error("公众号默认设置已变化，请重新同步");
        const checked = await dependencies.review(target);
        if (!checked.ready || checked.binding.documentHash !== quality.binding.documentHash || checked.binding.packageHash !== quality.binding.packageHash) throw new Error("正文或来源在交付准备期间变化，请重新核对");
        return target;
      };
      let attemptId: string | undefined;
      let receipt: WeChatDraftSyncReceipt;
      try {
        receipt = await createWeChatDraftDesk({ gateway, loadImage: dependencies.loadImage,
          beforeCommit: async () => { await assertCurrent(await dependencies.read()); },
          beforeRemoteWrite: (operation, mediaId, checkpoint) => dependencies.update(async current => {
            const target = await assertCurrent(current);
            attemptId = beginWeChatAttempt(target, account.appId, operation, mediaId, checkpoint).id;
          }),
          afterRemoteWrite: mediaId => dependencies.update(current => {
            const target = current.drafts.find(item => item.id === draftId) ?? current.draftTrash?.find(item => item.draft.id === draftId)?.draft;
            const attempt = target?.wechatSyncAttempts?.find(item => item.id === attemptId);
            if (attempt) attempt.mediaId = mediaId;
          }),
        }).syncDraft({ draft, ...wechatMetadataFor(draft, state.settings.wechat),
          previousReceipt: !draft.wechatDraft?.appId || draft.wechatDraft.appId === account.appId ? draft.wechatDraft : undefined });
      } catch (error) {
        if (attemptId) await dependencies.update(current => {
          const target = current.drafts.find(item => item.id === draftId) ?? current.draftTrash?.find(item => item.draft.id === draftId)?.draft;
          const attempt = target?.wechatSyncAttempts?.find(item => item.id === attemptId);
          if (attempt) { attempt.status = error instanceof WeChatApiError && error.definitive ? "failed" : "unknown"; attempt.detail = error instanceof Error ? error.message : "微信未返回明确结果"; }
        });
        throw error;
      }
      receipt.appId = account.appId;
      receipt.revisionHash = revision;
      const updatedDraft = await dependencies.update(current => {
        const target = current.drafts.find(item => item.id === draftId) ?? current.draftTrash?.find(item => item.draft.id === draftId)?.draft;
        if (!target) return undefined;
        attachWeChatDeliveryReceipt(target, receipt, receipt.syncedAt);
        const attempt = target.wechatSyncAttempts?.find(item => item.id === attemptId);
        if (attempt) { attempt.status = "complete"; attempt.mediaId = receipt.mediaId; attempt.detail = receipt.verificationDetail; }
        return target;
      });
      return { receipt, draft: updatedDraft, recovered: Boolean(pending) };
    });
  },
});
