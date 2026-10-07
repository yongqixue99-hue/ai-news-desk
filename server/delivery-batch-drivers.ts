import type { DeliveryDriver } from "./delivery-batch-desk.js";
import type { DeliveryBatchTarget, DeliveryPlatform } from "./delivery-batch-types.js";
import { publicationRevisionHash } from "./publication-state.js";
import { socialRevisionHash } from "./social-delivery.js";
import { socialArticleTitle } from "./social-metadata.js";
import { socialTitleProblem, type SocialDeliveryReceipt, type SocialDeliveryStatus, type SocialPlatform } from "./social-delivery-types.js";
import { wechatDeliveryRevision, type createWeChatDelivery } from "./wechat-delivery.js";
import type { createXiaoheiheDelivery } from "./xiaoheihe-delivery.js";
import type { PublisherStatus } from "./types.js";

interface Dependencies {
  wechat: ReturnType<typeof createWeChatDelivery>;
  xiaoheihe: ReturnType<typeof createXiaoheiheDelivery>;
  publisherStatus: () => PublisherStatus;
  socialStatus: () => Promise<SocialDeliveryStatus>;
  socialDeliver: (draftId: string, platform: SocialPlatform, account: string, updatedAt: string, accountId: string, revision?: string, signal?: AbortSignal) => Promise<SocialDeliveryReceipt>;
}
const afterStart = (at: string | undefined, target: DeliveryBatchTarget) => Boolean(at && target.startedAt && Date.parse(at) >= Date.parse(target.startedAt));
const socialResult = (receipt: SocialDeliveryReceipt) => ({ status: ["reported", "reviewed"].includes(receipt.status) ? "reported" as const : receipt.status === "not-received" ? "failed" as const : "unknown" as const, detail: receipt.detail, receiptId: receipt.id, url: receipt.url });

const socialDriver = (dependencies: Dependencies, platform: SocialPlatform): DeliveryDriver => ({
    revision: (draft: Parameters<DeliveryDriver["revision"]>[0]) => socialRevisionHash(draft, platform),
    inspect: async (draft: Parameters<DeliveryDriver["inspect"]>[0]) => {
      const problem = platform === "toutiao" ? "头条仅打开编辑入口，自动存稿尚未验收" : socialTitleProblem(platform, socialArticleTitle(draft, platform));
      if (problem) return { ready: false, status: "failed" as const, detail: problem };
      const status = await dependencies.socialStatus();
      const account = status.accounts.find(account => account.id === platform);
      return { ready: Boolean(status.connected && account?.authenticated && account.accountId && account.username),
        status: account?.authState === "signed-out" ? "waiting-login" as const : "waiting-connection" as const,
        detail: account?.detail || status.detail,
        accountBinding: account?.accountId && account.username ? JSON.stringify([account.accountId, account.username]) : undefined };
    },
    deliver: async (draft: Parameters<DeliveryDriver["deliver"]>[0], _state: unknown, target: DeliveryBatchTarget, signal?: AbortSignal) => {
      const [accountId, account] = JSON.parse(target.accountBinding || "[]") as string[];
      if (!accountId || !account) throw new Error("尚未识别平台账号");
      return socialResult(await dependencies.socialDeliver(draft.id, platform, account, draft.updatedAt, accountId, target.revisionHash, signal));
    },
    recover: async (draft: Parameters<DeliveryDriver["recover"]>[0], target: DeliveryBatchTarget, error?: unknown) => {
      const receipt = draft.socialDeliveries?.find(receipt => receipt.platform === platform && receipt.revisionHash === target.revisionHash
        && JSON.stringify([receipt.accountId, receipt.account]) === target.accountBinding && afterStart(receipt.createdAt, target));
      return receipt ? socialResult(receipt) : error ? { status: "failed" as const, detail: error instanceof Error ? error.message : "存稿未完成" } : undefined;
    },
});

export const createDeliveryBatchDrivers = (dependencies: Dependencies): Record<DeliveryPlatform, DeliveryDriver> => ({
  wechat: {
    // The first segment remains the receipt's document revision; the rest binds defaults and account.
    revision: wechatDeliveryRevision,
    inspect: async (_draft, state) => ({ ready: Boolean(state.settings.wechat.appId && state.settings.wechat.appSecretConfigured), status: "failed", accountBinding: state.settings.wechat.appId,
      detail: state.settings.wechat.appId && state.settings.wechat.appSecretConfigured ? "公众号草稿接口已配置" : "请先连接微信公众号" }),
    deliver: async (draft, _state, target, signal) => {
      const { receipt } = await dependencies.wechat.deliver(draft.id, undefined, target.revisionHash, signal);
      return { status: receipt.verification === "verified" ? "verified" : "reported", detail: receipt.verificationDetail || "微信已返回草稿编号，等待回读核对", receiptId: receipt.mediaId, url: "https://mp.weixin.qq.com/" };
    },
    recover: async (draft, target, error) => {
      const receipt = draft.wechatDraft;
      if (receipt && receipt.appId === target.accountBinding && receipt.revisionHash === target.revisionHash.split(":")[0] && afterStart(receipt.syncedAt, target)) {
        return { status: receipt.verification === "verified" ? "verified" : "reported", detail: receipt.verificationDetail || "已保存微信草稿回执", receiptId: receipt.mediaId, url: "https://mp.weixin.qq.com/" };
      }
      const pending = draft.wechatSyncAttempts?.find(attempt => attempt.appId === target.accountBinding && ["unknown", "sending"].includes(attempt.status));
      if (pending) return { status: "unknown", detail: "微信上次发送结果待核对，再次同步会先回读原稿，不会重复新建" };
      return error ? { status: "failed", detail: error instanceof Error ? error.message : "微信交付未完成" } : undefined;
    },
  },
  xiaoheihe: {
    revision: draft => publicationRevisionHash(draft, "xiaoheihe"),
    inspect: async () => { const status = dependencies.publisherStatus(); return { ready: status.ok, status: "waiting-connection", detail: status.detail }; },
    deliver: async (draft, state, _target, signal) => {
      const result = await dependencies.xiaoheihe.deliver(draft, state.settings, signal);
      if (result.status === 409) return { status: "failed", detail: result.body.error, receiptId: result.body.receipt.attemptId };
      return { status: result.body.ok ? "filled" : "failed", detail: result.body.ok ? "已填入并核对编辑页，打开后可检查并发布" : result.body.steps.filter(step => !step.ok).map(step => step.detail).join("；"), receiptId: result.body.receipt?.attemptId, url: result.body.pageUrl };
    },
    recover: async (draft, target) => {
      const result = draft.fillResult;
      if (result?.revisionHash !== target.revisionHash || !afterStart(result.at, target)) return undefined;
      return { status: result.ok ? "filled" : "failed", detail: result.ok ? "已恢复小黑盒填入回执，可打开检查" : result.steps.filter(step => !step.ok).map(step => step.detail).join("；") || result.warning || "小黑盒未完成填入", receiptId: result.receipt?.attemptId, url: result.pageUrl };
    },
  },
  baijiahao: socialDriver(dependencies, "baijiahao"),
  zhihu: socialDriver(dependencies, "zhihu"),
  toutiao: socialDriver(dependencies, "toutiao"),
});
