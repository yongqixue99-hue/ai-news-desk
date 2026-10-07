import { randomUUID } from "node:crypto";
import { deliveryPlatforms, deliveryTargetActive, retryableDeliveryPlatforms, selectedDeliveryPlatforms, type DeliveryBatch, type DeliveryBatchTarget, type DeliveryBatchView, type DeliveryPlatform } from "./delivery-batch-types.js";
import type { ArticleDraft, WorkflowState } from "./types.js";

export interface DeliveryDriver {
  revision: (draft: ArticleDraft, state: WorkflowState) => string;
  inspect: (draft: ArticleDraft, state: WorkflowState, signal?: AbortSignal) => Promise<{ ready: boolean; status?: "waiting-connection" | "waiting-login" | "failed"; detail: string; accountBinding?: string }>;
  deliver: (draft: ArticleDraft, state: WorkflowState, target: DeliveryBatchTarget, signal?: AbortSignal) => Promise<Pick<DeliveryBatchTarget, "status" | "detail" | "receiptId" | "url">>;
  /** Must only inspect durable evidence; it must never submit another remote write. */
  recover: (draft: ArticleDraft, target: DeliveryBatchTarget, error?: unknown) => Promise<Pick<DeliveryBatchTarget, "status" | "detail" | "receiptId" | "url"> | undefined>;
}
interface Dependencies {
  read: () => Promise<WorkflowState>;
  update: <T>(mutate: (state: WorkflowState) => T) => Promise<T>;
  drivers: Record<DeliveryPlatform, DeliveryDriver>;
  open: (platforms: DeliveryPlatform[], state: WorkflowState) => Promise<void>;
  now?: () => number;
  pending?: () => Promise<Array<{ draftId: string; batch: DeliveryBatch; target: DeliveryBatchTarget }>>;
  inspectionTimeoutMs?: number;
  deliveryTimeoutMs?: number;
}

export const pendingDeliveryBatchJobs = (state: Readonly<WorkflowState>) => state.drafts.flatMap(draft => (draft.deliveryBatches ?? []).flatMap(batch => batch.targets.filter(deliveryTargetActive).map(target => ({ draftId: draft.id, batch, target }))));

/** A durable batch owns one saved version; channel drivers own preflight and receipts. */
export const createDeliveryBatchDesk = (dependencies: Dependencies) => {
  const now = dependencies.now ?? Date.now;
  const inspectionTimeout = dependencies.inspectionTimeoutMs ?? 30_000;
  const deliveryTimeout = dependencies.deliveryTimeoutMs ?? 10 * 60_000;
  const running = new Map<DeliveryPlatform, { draftId: string; batchId: string; target: DeliveryBatchTarget;
    controller: AbortController; deadline: number; expired: boolean }>();
  let ticking = false;
  const start = async (draftId: string, input: unknown, updatedAt: string, retryOf?: string, accountBindings: Partial<Record<DeliveryPlatform, string>> = {}) => {
    const platforms = selectedDeliveryPlatforms(input);
    if (!accountBindings || typeof accountBindings !== "object" || Array.isArray(accountBindings)
      || Object.entries(accountBindings).some(([platform, binding]) => !platforms.includes(platform as DeliveryPlatform) || typeof binding !== "string" || !binding || binding.length > 500)) throw new Error("平台账号标识无效，请刷新连接后重试");
    const created = await dependencies.update(state => {
      const draft = state.drafts.find(item => item.id === draftId);
      if (!draft) throw new Error("草稿不存在");
      if (draft.updatedAt !== updatedAt) throw new Error("草稿已变化，请保存后重新交付");
      const active = draft.deliveryBatches?.find(batch => batch.targets.some(deliveryTargetActive));
      if (active) {
        if (active.targets.length === platforms.length && active.targets.every(target => platforms.includes(target.platform)
          && (!accountBindings[target.platform] || accountBindings[target.platform] === target.accountBinding)
          && target.revisionHash === dependencies.drivers[target.platform].revision(draft, state))) return { batch: structuredClone(active), created: false };
        throw new Error("已有交付正在处理，请等待完成或取消等待");
      }
      if (retryOf) {
        const previous = draft.deliveryBatches?.find(batch => batch.id === retryOf);
        const allowed = retryableDeliveryPlatforms(previous);
        if (!previous || platforms.some(platform => !allowed.includes(platform))) throw new Error("仅可重试明确失败或取消的平台；成功和结果未知的平台不会重复发送");
      }
      const batch: DeliveryBatch = { id: randomUUID(), createdAt: new Date(now()).toISOString(), expiresAt: new Date(now() + 10 * 60_000).toISOString(), draftUpdatedAt: updatedAt, retryOf,
        targets: platforms.map(platform => ({ platform, revisionHash: dependencies.drivers[platform].revision(draft, state), accountBinding: accountBindings[platform], status: "queued", detail: "检查连接与保存版本" })) };
      (draft.deliveryBatches ??= []).unshift(batch);
      return { batch: structuredClone(batch), created: true };
    });
    if (created.created) {
      try { await dependencies.open(platforms, await dependencies.read()); }
      catch {
        created.batch.browserError = "未能自动打开浏览器，可从平台入口继续；本次不会重复创建交付任务";
        await dependencies.update(state => {
          const batch = state.drafts.find(draft => draft.id === draftId)?.deliveryBatches?.find(batch => batch.id === created.batch.id);
          if (batch) batch.browserError = created.batch.browserError;
        });
      }
    }
    return created.batch;
  };
  const patch = (draftId: string, batchId: string, platform: DeliveryPlatform, result: Partial<DeliveryBatchTarget>) => dependencies.update(state => {
    const target = state.drafts.find(item => item.id === draftId)?.deliveryBatches?.find(item => item.id === batchId)?.targets.find(item => item.platform === platform);
    if (target && deliveryTargetActive(target) && Object.entries(result).some(([key, value]) => target[key as keyof DeliveryBatchTarget] !== value)) Object.assign(target, result);
  });
  const advance = async (draftId: string, batch: DeliveryBatch, target: DeliveryBatchTarget) => {
    if (running.has(target.platform)) return;
    const operation = { draftId, batchId: batch.id, target, controller: new AbortController(), deadline: now() + inspectionTimeout, expired: false };
    running.set(target.platform, operation);
    const signal = operation.controller.signal;
    const driver = dependencies.drivers[target.platform];
    let attempted = target;
    try {
      const state = await dependencies.read();
      signal.throwIfAborted();
      const draft = state.drafts.find(item => item.id === draftId);
      if (!draft) return;
      if (target.status === "sending") {
        const recovered = await driver.recover(draft, target);
        signal.throwIfAborted();
        await patch(draftId, batch.id, target.platform, { ...recovered,
          status: recovered?.status ?? "unknown", detail: recovered?.detail ?? "交付中断，尚未取得可核对回执；请检查原平台草稿，本次没有重复发送", completedAt: new Date(now()).toISOString() });
        return;
      }
      if (now() >= Date.parse(batch.expiresAt) || driver.revision(draft, state) !== target.revisionHash) {
        await patch(draftId, batch.id, target.platform, { status: "failed", detail: now() >= Date.parse(batch.expiresAt) ? "等待登录超过 10 分钟，登录后可重试此平台" : "等待期间正文、账号或配置已变化，请保存后重新交付" }); return;
      }
      const connection = await driver.inspect(draft, state, signal);
      signal.throwIfAborted();
      if (!connection.ready) {
        if (connection.status !== target.status || connection.detail !== target.detail) await patch(draftId, batch.id, target.platform, { status: connection.status ?? "waiting-connection", detail: connection.detail });
        return;
      }
      if (target.accountBinding && connection.accountBinding !== target.accountBinding) {
        await patch(draftId, batch.id, target.platform, { status: "failed", detail: "平台账号已变化，请核对后重新交付" }); return;
      }
      const claimed = await dependencies.update(current => {
        signal.throwIfAborted();
        const item = current.drafts.find(item => item.id === draftId);
        const live = item?.deliveryBatches?.find(item => item.id === batch.id)?.targets.find(item => item.platform === target.platform);
        if (!item || !live || !deliveryTargetActive(live) || live.status === "sending") return undefined;
        if (driver.revision(item, current) !== target.revisionHash) { live.status = "failed"; live.detail = "保存版本已变化，请重新交付"; return undefined; }
        Object.assign(live, { status: "sending", accountBinding: connection.accountBinding, startedAt: new Date(now()).toISOString(), detail: "正在核对内容并交付草稿" });
        return { draft: structuredClone(item), state: current, target: structuredClone(live) };
      });
      if (!claimed) return;
      attempted = claimed.target;
      operation.target = claimed.target;
      operation.deadline = now() + deliveryTimeout;
      const result = await driver.deliver(claimed.draft, claimed.state, claimed.target, signal);
      signal.throwIfAborted();
      await patch(draftId, batch.id, target.platform, { ...result, completedAt: new Date(now()).toISOString() });
    } catch (error) {
      if (signal.aborted) return;
      const draft = (await dependencies.read()).drafts.find(item => item.id === draftId);
      const recovered = draft ? await driver.recover(draft, attempted, error).catch(() => undefined) : undefined;
      await patch(draftId, batch.id, target.platform, { ...recovered, status: recovered?.status ?? (attempted.status === "sending" ? "unknown" : "failed"), detail: recovered?.detail ?? (error instanceof Error ? error.message : "交付未完成"), completedAt: new Date(now()).toISOString() });
    } finally { running.delete(target.platform); }
  };
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    let work: Promise<void>[] = [];
    try {
      for (const [platform, operation] of running) {
        if (operation.expired || now() < operation.deadline) continue;
        const sending = operation.target.status === "sending";
        const detail = sending ? "交付超过处理时限，已停止后续步骤；结果暂未核对，不会自动重复发送" : "平台连接检测超时，未提交存稿请求，可重试此平台";
        operation.controller.abort(new Error(detail));
        await patch(operation.draftId, operation.batchId, platform, { status: sending ? "unknown" : "failed", detail, completedAt: new Date(now()).toISOString() });
        operation.expired = true;
      }
      const jobs = dependencies.pending ? await dependencies.pending() : pendingDeliveryBatchJobs(await dependencies.read());
      work = jobs.map(job => advance(job.draftId, job.batch, job.target));
    } finally { ticking = false; }
    // Only dispatch is serialized. Each platform retains its own execution lock.
    await Promise.all(work);
  };
  const cancel = (draftId: string, batchId: string) => dependencies.update(state => {
    const batch = state.drafts.find(item => item.id === draftId)?.deliveryBatches?.find(item => item.id === batchId);
    if (!batch) throw new Error("交付任务不存在");
    batch.targets.filter(target => deliveryTargetActive(target) && target.status !== "sending").forEach(target => { target.status = "cancelled"; target.detail = "已取消等待，未提交存稿请求"; });
    return structuredClone(batch);
  });
  const reconcile = async (draftId: string) => {
    const draft = (await dependencies.read()).drafts.find(item => item.id === draftId);
    for (const batch of draft?.deliveryBatches ?? []) for (const target of batch.targets.filter(target => target.status === "unknown")) {
      const recovered = await dependencies.drivers[target.platform].recover(draft!, target).catch(() => undefined);
      if (!recovered || !["verified", "filled", "reported", "failed"].includes(recovered.status)) continue;
      await dependencies.update(state => {
        const live = state.drafts.find(item => item.id === draftId)?.deliveryBatches?.find(item => item.id === batch.id)?.targets.find(item => item.platform === target.platform);
        if (live?.status === "unknown") Object.assign(live, recovered, { completedAt: new Date(now()).toISOString() });
      });
    }
  };
  const view = async (draftId: string): Promise<DeliveryBatchView | undefined> => {
    await reconcile(draftId);
    const draft = (await dependencies.read()).drafts.find(item => item.id === draftId);
    // Durable progress must not depend on a browser, a login page or a live account check.
    return draft ? { batches: draft.deliveryBatches ?? [], platforms: [] } : undefined;
  };
  const connections = async (draftId: string): Promise<DeliveryBatchView["platforms"] | undefined> => {
    const state = await dependencies.read(), draft = state.drafts.find(item => item.id === draftId);
    if (!draft) return undefined;
    return Promise.all(deliveryPlatforms.map(async platform => ({ ...platform,
      ...(await dependencies.drivers[platform.id].inspect(draft, state).catch(() => ({ ready: false, status: "waiting-connection" as const, detail: "暂时无法读取连接，正在等待恢复" }))) })));
  };
  return { start, tick, cancel, reconcile, view, connections };
};
