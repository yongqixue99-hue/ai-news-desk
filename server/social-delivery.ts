import { socialDeliveryChecks } from "./delivery-verification.js";
import { createHash, randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { bodyHtmlWithRequiredImageAttribution } from "./article-html.js";
import { publicationRevisionHash } from "./publication-state.js";
import { socialArticleTitle, socialMetadataBinding } from "./social-metadata.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import { socialPlatforms, socialTitleProblem, type SocialPlatform, type SocialAccount, type SocialDeliveryReceipt } from "./social-delivery-types.js";
import type { ArticleDraft, WorkflowState, DraftImagePlacement } from "./types.js";
import type { SocialBridgeMethod } from "./social-bridge.js";
import type { WeChatImageAsset } from "./wechat-draft.js";

type Bridge = { request: (method: SocialBridgeMethod, params?: Record<string, unknown>) => Promise<unknown> };
const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
const text = (input: unknown) => typeof input === "string" ? input.slice(0, 300) : "";
export const socialRevisionHash = (draft: ArticleDraft, platform: SocialPlatform) => {
  const metadata = socialMetadataBinding(draft, platform);
  return createHash("sha256").update(`${platform}:${publicationRevisionHash(draft, "wechat")}${metadata ? `:${metadata}` : ""}`).digest("hex");
};
export const socialDraftUrl = (platform: SocialPlatform, input: unknown) => {
  try {
    const url = new URL(String(input));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (platform === "zhihu" && url.hostname === "zhuanlan.zhihu.com" && /^\/p\/\d+\/edit\/?$/.test(url.pathname)) return url.href;
    if (platform === "toutiao" && url.hostname === "mp.toutiao.com" && /^\/profile_v[34]\/graphic\/publish\/?$/.test(url.pathname) && url.searchParams.getAll("pgc_id").length === 1 && /^[1-9]\d*$/.test(url.searchParams.get("pgc_id") ?? "")) return url.href;
    if (platform === "baijiahao" && url.hostname === "baijiahao.baidu.com" && url.pathname === "/builder/rc/edit" && /^\d+$/.test(url.searchParams.get("article_id") ?? "")) return url.href;
  } catch { /* Untrusted link. */ }
  return undefined;
};
export const socialAccounts = (input: unknown): SocialAccount[] => {
  const list = Array.isArray(input) ? input.map(record) : [];
  return socialPlatforms.map(platform => {
    const account = list.find(entry => entry.id === platform.id);
    const supportsDraft = platform.id !== "toutiao" || Array.isArray(account?.capabilities) && account.capabilities.includes("article") && account.capabilities.includes("draft");
    const discovering = account?.capabilityPending === true;
    const unavailable = Boolean(account && !supportsDraft && !discovering);
    const authenticated = account?.isAuthenticated === true;
    const username = text(account?.username).trim();
    const authState = !platform.enabled || unavailable ? "unavailable" : discovering ? "unknown" : authenticated ? "signed-in" : account?.isAuthenticated === false ? "signed-out" : "unknown";
    return { id: platform.id, available: platform.enabled && Boolean(account) && supportsDraft, authenticated, authState, username, accountId: text(account?.userId),
      detail: discovering ? "正在后台检测头条草稿能力，其他平台继续交付" : unavailable ? "当前同步助手未提供头条草稿能力，请更新助手" : !platform.enabled ? "可打开编辑页；自动存稿尚未接通"
        : authState === "unknown" ? "登录状态待检测，已登录账号无需重登" : !authenticated ? "等待在 Chrome 登录，完成后自动继续"
          : !username || !text(account?.userId) ? "助手未返回完整账号标识，暂不能投递" : `已登录 · ${username}` };
  });
};
interface Dependencies {
  bridge: Bridge;
  platformMetadata?: () => Promise<unknown>;
  read: () => Promise<WorkflowState>;
  update: <T>(mutate: (state: WorkflowState) => T) => Promise<T>;
  quality: (draft: ArticleDraft, deliveryTitle?: string) => Promise<void>;
  loadImage: (placement: DraftImagePlacement) => Promise<WeChatImageAsset>;
}
export const createSocialDeliveryDesk = (dependencies: Dependencies) => {
  const active = new Set<string>();
  const account = async (platform: SocialPlatform) => {
    const raw = record(await dependencies.bridge.request("checkAuth", { platform }));
    if (raw.isAuthenticated !== true || !text(raw.username).trim() || !text(raw.userId).trim()) throw new Error("未取得可核对的登录账号，请刷新连接状态并登录平台");
    return { name: text(raw.username).trim(), id: text(raw.userId).trim() };
  };
  const deliver = async (draftId: string, platform: SocialPlatform, expectedAccount: string, expectedUpdatedAt: string, expectedAccountId: string, expectedRevision?: string, signal?: AbortSignal): Promise<SocialDeliveryReceipt> => {
    signal?.throwIfAborted();
    if (!socialPlatforms.find(item => item.id === platform)?.enabled) throw new Error("这个平台的草稿投递尚未接通");
    const key = `${draftId}:${platform}`;
    if (active.has(key)) throw new Error("该平台正在投递，请等待当前回执");
    active.add(key);
    let attempt: SocialDeliveryReceipt | undefined;
    try {
      const state = await dependencies.read();
      const draft = state.drafts.find(entry => entry.id === draftId);
      if (!draft) throw new Error("草稿不存在");
      if (expectedRevision ? socialRevisionHash(draft, platform) !== expectedRevision : draft.updatedAt !== expectedUpdatedAt) throw new Error("草稿已变化，请保存当前正文后重新投递");
      if (draft.contentFormat === "image-post") throw new Error("新增渠道目前支持文章，请切换为文章格式");
      const title = socialArticleTitle(draft, platform);
      const titleProblem = socialTitleProblem(platform, title);
      if (titleProblem) throw new Error(titleProblem);
      let adapterVersion = "unknown";
      if (platform === "toutiao") {
        const available = await (dependencies.platformMetadata?.() ?? dependencies.bridge.request("listPlatforms"));
        const metadata = Array.isArray(available) ? available.map(record).find(entry => entry.id === platform) : undefined;
        if (!Array.isArray(metadata?.capabilities) || !metadata.capabilities.includes("article") || !metadata.capabilities.includes("draft")) throw new Error("当前同步助手未提供头条草稿能力，请更新助手后重试");
        adapterVersion = typeof metadata.version === "string" ? metadata.version.replace(/[^a-zA-Z0-9._/+-]/gu, "").slice(0, 80) || "unknown" : "unknown";
      }
      const initialAccount = await account(platform);
      if (!expectedAccount || !expectedAccountId || initialAccount.name !== expectedAccount || initialAccount.id !== expectedAccountId) throw new Error("登录账号已变化，请刷新后核对目标账号");
      const revisionHash = socialRevisionHash(draft, platform);
      const previous = draft.socialDeliveries ?? [];
      if (previous.some(receipt => receipt.platform === platform && ["sending", "unknown"].includes(receipt.status))) throw new Error("上次投递结果待核对；请先到平台确认是否已有草稿，避免重复发送");
      const same = previous.find(receipt => receipt.platform === platform && receipt.accountId === expectedAccountId && receipt.revisionHash === revisionHash && ["reported", "reviewed"].includes(receipt.status));
      if (same) return same;
      if (previous.some(receipt => receipt.platform === platform && receipt.accountId === expectedAccountId && receipt.status === "reported")) throw new Error("请先核对上次助手回执中的草稿，再投递新版本");
      await dependencies.quality(draft, title);
      const $ = cheerio.load(`<article>${bodyHtmlWithRequiredImageAttribution(draft)}</article>`, null, false);
      const nodes = $("article img").toArray();
      const placements = nodes.map(node => draft.images.find(item => item.id === $(node).attr("data-media-id")));
      if (placements.some(item => !item)) throw new Error("正文包含未纳入素材管理的图片，请重新插入");
      const used = placements.filter((item): item is DraftImagePlacement => Boolean(item));
      const coverId = draft.socialMetadata?.[platform]?.coverPlacementId;
      const cover = coverId ? draft.images.find(item => item.id === coverId) : used[0];
      if (coverId && !cover) throw new Error("所选平台封面已不存在，请重新选择封面");
      const required = [...new Map([...used, ...(cover ? [cover] : [])].map(item => [item.id, item])).values()];
      const readiness = evaluateDraftReadiness({ ...draft, title, images: required }, platform);
      if (!readiness.ready) throw new Error(readiness.blockers.join("；"));
      if (!$("article").text().trim()) throw new Error("文章正文不能为空");
      // Validate every local path and fingerprint before any upload; never send local file URLs.
      const assets = await Promise.all(required.map(dependencies.loadImage));
      const uploaded = new Map<string, string>();
      for (let index = 0; index < assets.length; index++) {
        signal?.throwIfAborted();
        const asset = assets[index]!;
        const response = record(await dependencies.bridge.request("uploadImage", { platform, imageData: Buffer.from(asset.bytes).toString("base64"), mimeType: asset.contentType }));
        const url = new URL(String(response.url ?? ""));
        const hosts = platform === "zhihu" ? ["zhimg.com"] : platform === "toutiao" ? ["toutiaoimg.com", "pstatp.com", "byteimg.com"] : ["baidu.com", "bdstatic.com", "bcebos.com"];
        if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("图片上传未返回目标平台的图片地址");
        uploaded.set(required[index]!.id, url.href);
      }
      nodes.forEach((node, index) => $(node).attr("src", uploaded.get(used[index]!.id)!).removeAttr("data-media-id data-caption data-attribution"));
      if ((await account(platform)).id !== expectedAccountId) throw new Error("图片准备期间账号发生变化，请重新核对");
      const current = (await dependencies.read()).drafts.find(entry => entry.id === draftId);
      if (!current || socialRevisionHash(current, platform) !== revisionHash) throw new Error("图片准备期间正文发生变化，已停止投递");
      await dependencies.quality(current, socialArticleTitle(current, platform));
      const currentReadiness = evaluateDraftReadiness({ ...current, title, images: current.images.filter(item => required.some(placement => placement.id === item.id)) }, platform);
      if (!currentReadiness.ready) throw new Error(currentReadiness.blockers.join("；"));
      const now = new Date().toISOString();
      attempt = { id: randomUUID(), platform, account: expectedAccount, accountId: expectedAccountId, title, revisionHash, createdAt: now, updatedAt: now, status: "sending", detail: "已发送请求，等待助手回执", fieldChecks: socialDeliveryChecks(platform, adapterVersion, now), finalPublishAttempted: false };
      // Persist before the remote mutation. Interrupted tasks remain blocked across restarts.
      await dependencies.update(state => {
        signal?.throwIfAborted();
        const current = state.drafts.find(entry => entry.id === draftId);
        if (!current || socialRevisionHash(current, platform) !== revisionHash) throw new Error("正文已变化，已停止投递");
        (current.socialDeliveries ??= []).unshift(attempt!);
      });
      signal?.throwIfAborted();
      const response = record(await dependencies.bridge.request("syncArticle", { platforms: [platform], draftOnly: true, article: { title, content: $("article").html(), cover: cover ? uploaded.get(cover.id) : undefined } }));
      const returnedAccount = await account(platform);
      const results = Array.isArray(response.results) ? response.results.map(record) : [];
      const result = results.find(entry => entry.platform === platform);
      const url = socialDraftUrl(platform, result?.postUrl);
      if (result?.success !== true || result.draftOnly !== true || !url || !text(result.postId) || (platform === "zhihu" ? new URL(url).pathname.split("/")[2] !== text(result.postId) : new URL(url).searchParams.get(platform === "toutiao" ? "pgc_id" : "article_id") !== text(result.postId)) || returnedAccount.id !== expectedAccountId || returnedAccount.name !== expectedAccount) throw new Error("助手未返回完整且匹配账号的草稿回执，请到平台核对后处理");
      attempt = { ...attempt, status: "reported", postId: text(result.postId), url, detail: "助手已返回草稿编号；正文、图片、封面和平台设置尚未回读核对。尚未公开发布。", updatedAt: new Date().toISOString() };
      await persist(attempt, draftId);
      return attempt;
    } catch (error) {
      if (!attempt) throw error;
      attempt = { ...attempt, status: "unknown", detail: "投递已开始，但未取得完整回执。请到平台或同步助手历史核对，不能直接重试。", updatedAt: new Date().toISOString() };
      await persist(attempt, draftId);
      return attempt;
    } finally { active.delete(key); }
  };
  const persist = (receipt: SocialDeliveryReceipt, draftId: string) => dependencies.update(state => {
    const draft = state.drafts.find(entry => entry.id === draftId);
    if (!draft) throw new Error("投递后本地草稿不存在，请到平台核对");
    draft.socialDeliveries = (draft.socialDeliveries ?? []).map(item => item.id === receipt.id ? receipt : item);
  });
  const resolve = (draftId: string, receiptId: string, resolution: "reviewed" | "not-received") => dependencies.update(state => {
    const draft = state.drafts.find(entry => entry.id === draftId);
    const receipt = draft?.socialDeliveries?.find(item => item.id === receiptId);
    if (!receipt) throw new Error("回执不存在");
    if (active.has(`${draftId}:${receipt.platform}`)) throw new Error("投递仍在执行，请等待结束");
    if (resolution === "not-received" && !["sending", "unknown"].includes(receipt.status)) throw new Error("这个回执不需要重试处理");
    if (resolution === "reviewed") receipt.acceptance = { reviewedAt: new Date().toISOString(), accountId: receipt.accountId, revisionHash: receipt.revisionHash,
      adapterVersion: receipt.fieldChecks?.adapterVersion || "unknown", fields: receipt.fieldChecks?.fields.map(field => field.key) || [] };
    receipt.status = resolution;
    receipt.detail = resolution === "reviewed" ? "用户已在平台核对草稿；最终发布仍由用户完成" : "用户确认平台未收到，允许手动重新投递";
    receipt.updatedAt = new Date().toISOString();
    return receipt;
  });
  return { deliver, resolve, busy: () => active.size > 0 };
};
