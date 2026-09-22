import { randomUUID } from "node:crypto";
import { socialRevisionHash } from "./social-delivery.js";
import { selectedSocialPlatforms, socialPlatforms, socialTargetActive, socialTitleProblem, type SocialDeliveryBatch, type SocialDeliveryReceipt, type SocialDeliveryStatus, type SocialDeliveryTarget, type SocialPlatform } from "./social-delivery-types.js";
import type { WorkflowState } from "./types.js";

interface Dependencies {
  read: () => Promise<WorkflowState>;
  update: <T>(mutate: (state: WorkflowState) => T) => Promise<T>;
  status: () => Promise<SocialDeliveryStatus>;
  deliver: (draftId: string, platform: SocialPlatform, account: string, updatedAt: string, accountId: string) => Promise<SocialDeliveryReceipt>;
  open: (platforms: SocialPlatform[]) => Promise<void>;
  openReceipt: (receipt: SocialDeliveryReceipt) => Promise<void>;
  now?: () => number;
}
type AccountBindings = Partial<Record<SocialPlatform, { account: string; accountId: string }>>;

/** DeliveryDesk owns the queue. A page refresh never resubmits a remote mutation. */
export const createSocialDeliveryQueue = (dependencies: Dependencies) => {
  const now = dependencies.now ?? Date.now;
  let ticking = false;
  const running = new Set<string>();
  const start = async (draftId: string, input: unknown, updatedAt: string, accounts: AccountBindings = {}) => {
    const platforms = selectedSocialPlatforms(input);
    const result = await dependencies.update(state => {
      const draft = state.drafts.find(item => item.id === draftId);
      if (!draft) throw new Error("草稿不存在");
      if (draft.updatedAt !== updatedAt) throw new Error("草稿已变化，请保存后重新交付");
      const existing = draft.socialDeliveryBatches?.find(batch => batch.targets.some(socialTargetActive));
      if (existing) {
        if (existing.targets.length === platforms.length && existing.targets.every(target => platforms.includes(target.platform) && target.revisionHash === socialRevisionHash(draft, target.platform))) return { batch: structuredClone(existing), created: false };
        throw new Error("已有交付在等待或执行，请先完成或取消");
      }
      const batch: SocialDeliveryBatch = {
        id: randomUUID(), createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 10 * 60_000).toISOString(),
        targets: platforms.map(platform => {
          const rule = socialPlatforms.find(item => item.id === platform)!;
          const problem = socialTitleProblem(platform, draft.title) || (draft.contentFormat === "image-post" ? "此渠道需要文章格式" : "") || (!rule.enabled ? "头条自动存稿尚未接通，可在已打开的编辑页继续" : "");
          const binding = accounts[platform];
          return { platform, revisionHash: socialRevisionHash(draft, platform),
            ...(binding?.account && binding.accountId ? { account: String(binding.account).slice(0, 300), accountId: String(binding.accountId).slice(0, 300) } : {}),
            status: problem ? "blocked" : "queued", detail: problem || "正在检查登录与稿件" };
        }),
      };
      (draft.socialDeliveryBatches ??= []).unshift(batch);
      return { batch: structuredClone(batch), created: true };
    });
    if (result.created) {
      try { await dependencies.open(platforms); }
      catch {
        return { ...result.batch, browserError: "未能打开 Chrome，可用下方编辑入口手动打开；交付仍会检测已有登录" };
      }
    }
    return result.batch;
  };
  const change = async (draftId: string, batchId: string, platform: SocialPlatform, patch: Partial<SocialDeliveryTarget>) => {
    // Avoid rewriting the state every poll while a user is scanning a QR code.
    const before = (await dependencies.read()).drafts.find(draft => draft.id === draftId)?.socialDeliveryBatches?.find(batch => batch.id === batchId)?.targets.find(target => target.platform === platform);
    if (!before || !socialTargetActive(before) || Object.entries(patch).every(([key, value]) => before[key as keyof SocialDeliveryTarget] === value)) return;
    await dependencies.update(state => {
      const target = state.drafts.find(draft => draft.id === draftId)?.socialDeliveryBatches?.find(batch => batch.id === batchId)?.targets.find(target => target.platform === platform);
      if (target && socialTargetActive(target)) Object.assign(target, patch);
    });
  };
  const advance = async (draftId: string, batch: SocialDeliveryBatch, target: SocialDeliveryTarget, connection?: SocialDeliveryStatus) => {
    const key = `${batch.id}:${target.platform}`;
    if (running.has(key)) return;
    running.add(key);
    try {
      const current = (await dependencies.read()).drafts.find(draft => draft.id === draftId);
      if (!current) return;
      if (target.status === "sending") {
        // Recover an interrupted process by its durable receipt; never retry a send.
        const receipt = current.socialDeliveries?.find(receipt => receipt.platform === target.platform && receipt.revisionHash === target.revisionHash && receipt.accountId === target.accountId);
        await change(draftId, batch.id, target.platform, receipt
          ? { status: ["reported", "reviewed"].includes(receipt.status) ? "reported" : receipt.status === "not-received" ? "blocked" : "unknown", detail: receipt.detail, receiptId: receipt.id }
          : { status: "blocked", detail: "交付中断，尚未发送存稿请求，请重新交付" });
        return;
      }
      if (now() >= Date.parse(batch.expiresAt)) {
        await change(draftId, batch.id, target.platform, { status: "blocked", detail: "等待登录已超过 10 分钟；登录后重新交付即可" }); return;
      }
      if (socialRevisionHash(current, target.platform) !== target.revisionHash) {
        await change(draftId, batch.id, target.platform, { status: "blocked", detail: "等待期间稿件已修改，请保存后重新交付" }); return;
      }
      if (!connection?.connected) {
        await change(draftId, batch.id, target.platform, { status: "waiting-connection", detail: "等待同步助手连接；网站已登录则无需重登" }); return;
      }
      const account = connection.accounts.find(account => account.id === target.platform);
      if (!account?.authenticated || !account.accountId || !account.username) {
        await change(draftId, batch.id, target.platform, { status: account?.authState === "signed-out" ? "waiting-login" : "waiting-connection", detail: account?.detail || "等待识别平台账号" }); return;
      }
      if (target.accountId && (account.accountId !== target.accountId || account.username !== target.account)) {
        await change(draftId, batch.id, target.platform, { status: "blocked", detail: "登录账号发生变化，请核对后重新交付" }); return;
      }
      const claimed = await dependencies.update(state => {
        const draft = state.drafts.find(item => item.id === draftId);
        const live = draft?.socialDeliveryBatches?.find(item => item.id === batch.id)?.targets.find(item => item.platform === target.platform);
        if (!draft || !live || !socialTargetActive(live) || live.status === "sending") return undefined;
        if (socialRevisionHash(draft, target.platform) !== target.revisionHash) { live.status = "blocked"; live.detail = "稿件已修改，请保存后重新交付"; return undefined; }
        Object.assign(live, { status: "sending", detail: "正在检查内容并存入草稿箱", account: account.username, accountId: account.accountId });
        return draft.updatedAt;
      });
      if (!claimed) return;
      const receipt = await dependencies.deliver(draftId, target.platform, account.username, claimed, account.accountId);
      if (receipt.status === "reported" || receipt.status === "reviewed") {
        try { await dependencies.openReceipt(receipt); } catch { /* The persisted draft link remains available for the user. */ }
      }
      await change(draftId, batch.id, target.platform, { status: receipt.status === "reported" || receipt.status === "reviewed" ? "reported" : "unknown", detail: receipt.detail, receiptId: receipt.id });
    } catch (error) {
      // DeliveryDesk persists remote attempts before sending. Transport ambiguity is returned as a receipt.
      await change(draftId, batch.id, target.platform, { status: "blocked", detail: error instanceof Error ? error.message : "交付未完成，请检查连接后重试" });
    } finally { running.delete(key); }
  };
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const drafts = (await dependencies.read()).drafts;
      const jobs = drafts.flatMap(draft => (draft.socialDeliveryBatches ?? []).flatMap(batch => batch.targets.filter(socialTargetActive).map(target => ({ draftId: draft.id, batch, target }))));
      if (!jobs.length) return;
      let connection: SocialDeliveryStatus | undefined;
      try { connection = await dependencies.status(); } catch { /* Keep awaiting the bridge. */ }
      await Promise.all(jobs.map(job => advance(job.draftId, job.batch, job.target, connection)));
    } finally { ticking = false; }
  };
  const cancel = (draftId: string, batchId: string) => dependencies.update(state => {
    const batch = state.drafts.find(draft => draft.id === draftId)?.socialDeliveryBatches?.find(batch => batch.id === batchId);
    if (!batch) throw new Error("交付任务不存在");
    for (const target of batch.targets) {
      if (socialTargetActive(target) && target.status !== "sending") { target.status = "cancelled"; target.detail = "已取消等待，未发送存稿请求"; }
    }
    return structuredClone(batch);
  });
  return { start, tick, cancel };
};
