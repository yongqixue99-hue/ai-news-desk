import { createHash, randomUUID } from "node:crypto";
import * as cheerio from "cheerio";
import { bodyHtmlWithRequiredImageAttribution } from "./article-html.js";
import { publicationRevisionHash } from "./publication-state.js";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import { socialPlatforms, type SocialPlatform, type SocialAccount, type SocialDeliveryReceipt } from "./social-delivery-types.js";
import type { ArticleDraft, WorkflowState, DraftImagePlacement } from "./types.js";
import type { SocialBridgeMethod } from "./social-bridge.js";
import type { WeChatImageAsset } from "./wechat-draft.js";

type Bridge = { request: (method: SocialBridgeMethod, params?: Record<string, unknown>) => Promise<unknown> };
const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
const text = (input: unknown) => typeof input === "string" ? input.slice(0, 300) : "";
export const socialRevisionHash = (draft: ArticleDraft, platform: SocialPlatform) => createHash("sha256").update(`${platform}:${publicationRevisionHash(draft, "wechat")}`).digest("hex");
export const socialDraftUrl = (platform: SocialPlatform, input: unknown) => {
  try {
    const url = new URL(String(input));
    if (url.protocol !== "https:" || url.username || url.password || url.port) return undefined;
    if (platform === "zhihu" && url.hostname === "zhuanlan.zhihu.com" && /^\/p\/\d+\/edit\/?$/.test(url.pathname)) return url.href;
    if (platform === "baijiahao" && url.hostname === "baijiahao.baidu.com" && url.pathname === "/builder/rc/edit" && /^\d+$/.test(url.searchParams.get("article_id") ?? "")) return url.href;
  } catch { /* Untrusted link. */ }
  return undefined;
};
export const socialAccounts = (input: unknown): SocialAccount[] => {
  const list = Array.isArray(input) ? input.map(record) : [];
  return socialPlatforms.map(platform => {
    const account = list.find(entry => entry.id === platform.id);
    const authenticated = account?.isAuthenticated === true;
    const username = text(account?.username).trim();
    return { id: platform.id, available: platform.enabled && Boolean(account), authenticated, username, accountId: text(account?.userId),
      detail: !platform.enabled ? "待接入：草稿适配尚未核验，可打开平台手动发布"
        : !account ? "当前同步助手未提供此平台" : !authenticated ? "请先在同一个 Chrome 登录"
          : !username || !text(account?.userId) ? "助手未返回完整账号标识，暂不能投递" : `已登录 · ${username}` };
  });
};
interface Dependencies {
  bridge: Bridge;
  read: () => Promise<WorkflowState>;
  update: <T>(mutate: (state: WorkflowState) => T) => Promise<T>;
  quality: (draft: ArticleDraft) => Promise<void>;
  loadImage: (placement: DraftImagePlacement) => Promise<WeChatImageAsset>;
}
export const createSocialDeliveryDesk = (dependencies: Dependencies) => {
  const active = new Set<string>();
  const account = async (platform: SocialPlatform) => {
    const raw = record(await dependencies.bridge.request("checkAuth", { platform }));
    if (raw.isAuthenticated !== true || !text(raw.username).trim() || !text(raw.userId).trim()) throw new Error("未取得可核对的登录账号，请刷新连接状态并登录平台");
    return { name: text(raw.username).trim(), id: text(raw.userId).trim() };
  };
  const deliver = async (draftId: string, platform: SocialPlatform, expectedAccount: string, expectedUpdatedAt: string, expectedAccountId: string): Promise<SocialDeliveryReceipt> => {
    if (!socialPlatforms.find(item => item.id === platform)?.enabled) throw new Error("这个平台的草稿投递尚未接通");
    const key = `${draftId}:${platform}`;
    if (active.has(key)) throw new Error("该平台正在投递，请等待当前回执");
    active.add(key);
    let attempt: SocialDeliveryReceipt | undefined;
    try {
      const state = await dependencies.read();
      const draft = state.drafts.find(entry => entry.id === draftId);
      if (!draft) throw new Error("草稿不存在");
      if (draft.updatedAt !== expectedUpdatedAt) throw new Error("草稿已变化，请保存当前正文后重新投递");
      if (draft.contentFormat === "image-post") throw new Error("新增渠道目前支持文章，请切换为文章格式");
      const title = draft.title.trim();
      if (!title || Array.from(title).length > (platform === "baijiahao" ? 30 : 100)) throw new Error(platform === "baijiahao" ? "百家号文章标题需为 1–30 字" : "知乎文章标题需为 1–100 字");
      const initialAccount = await account(platform);
      if (!expectedAccount || !expectedAccountId || initialAccount.name !== expectedAccount || initialAccount.id !== expectedAccountId) throw new Error("登录账号已变化，请刷新后核对目标账号");
      const revisionHash = socialRevisionHash(draft, platform);
      const previous = draft.socialDeliveries ?? [];
      if (previous.some(receipt => receipt.platform === platform && ["sending", "unknown"].includes(receipt.status))) throw new Error("上次投递结果待核对；请先到平台确认是否已有草稿，避免重复发送");
      const same = previous.find(receipt => receipt.platform === platform && receipt.accountId === expectedAccountId && receipt.revisionHash === revisionHash && ["reported", "reviewed"].includes(receipt.status));
      if (same) return same;
      if (previous.some(receipt => receipt.platform === platform && receipt.accountId === expectedAccountId && receipt.status === "reported")) throw new Error("请先核对上次助手回执中的草稿，再投递新版本");
      await dependencies.quality(draft);
      const $ = cheerio.load(`<article>${bodyHtmlWithRequiredImageAttribution(draft)}</article>`, null, false);
      const nodes = $("article img").toArray();
      const placements = nodes.map(node => draft.images.find(item => item.id === $(node).attr("data-media-id")));
      if (placements.some(item => !item)) throw new Error("正文包含未纳入素材管理的图片，请重新插入");
      const used = placements.filter((item): item is DraftImagePlacement => Boolean(item));
      const readiness = evaluateDraftReadiness({ ...draft, images: used }, platform);
      if (!readiness.ready) throw new Error(readiness.blockers.join("；"));
      if (!$("article").text().trim()) throw new Error("文章正文不能为空");
      // Validate every local path and fingerprint before any upload; never send local file URLs.
      const assets = await Promise.all(used.map(dependencies.loadImage));
      for (let index = 0; index < assets.length; index++) {
        const asset = assets[index]!;
        const response = record(await dependencies.bridge.request("uploadImage", { platform, imageData: Buffer.from(asset.bytes).toString("base64"), mimeType: asset.contentType }));
        const url = new URL(String(response.url ?? ""));
        const hosts = platform === "zhihu" ? ["zhimg.com"] : ["baidu.com", "bdstatic.com", "bcebos.com"];
        if (url.protocol !== "https:" || url.username || url.password || url.port || !hosts.some(host => url.hostname === host || url.hostname.endsWith(`.${host}`))) throw new Error("图片上传未返回目标平台的图片地址");
        $(nodes[index]!).attr("src", url.href).removeAttr("data-media-id data-caption data-attribution");
      }
      if ((await account(platform)).id !== expectedAccountId) throw new Error("图片准备期间账号发生变化，请重新核对");
      const current = (await dependencies.read()).drafts.find(entry => entry.id === draftId);
      if (!current || socialRevisionHash(current, platform) !== revisionHash) throw new Error("图片准备期间正文发生变化，已停止投递");
      await dependencies.quality(current);
      const currentReadiness = evaluateDraftReadiness({ ...current, images: current.images.filter(item => used.some(placement => placement.id === item.id)) }, platform);
      if (!currentReadiness.ready) throw new Error(currentReadiness.blockers.join("；"));
      const now = new Date().toISOString();
      attempt = { id: randomUUID(), platform, account: expectedAccount, accountId: expectedAccountId, title, revisionHash, createdAt: now, updatedAt: now, status: "sending", detail: "已发送请求，等待助手回执", finalPublishAttempted: false };
      // Persist before the remote mutation. Interrupted tasks remain blocked across restarts.
      await dependencies.update(state => {
        const current = state.drafts.find(entry => entry.id === draftId);
        if (!current || socialRevisionHash(current, platform) !== revisionHash) throw new Error("正文已变化，已停止投递");
        (current.socialDeliveries ??= []).unshift(attempt!);
      });
      const response = record(await dependencies.bridge.request("syncArticle", { platforms: [platform], article: { title, content: $("article").html(), cover: $("article img").first().attr("src") } }));
      const returnedAccount = await account(platform);
      const results = Array.isArray(response.results) ? response.results.map(record) : [];
      const result = results.find(entry => entry.platform === platform);
      const url = socialDraftUrl(platform, result?.postUrl);
      if (result?.success !== true || result.draftOnly !== true || !url || !text(result.postId) || (platform === "zhihu" ? new URL(url).pathname.split("/")[2] !== text(result.postId) : new URL(url).searchParams.get("article_id") !== text(result.postId)) || returnedAccount.id !== expectedAccountId || returnedAccount.name !== expectedAccount) throw new Error("助手未返回完整且匹配账号的草稿回执，请到平台核对后处理");
      attempt = { ...attempt, status: "reported", postId: text(result.postId), url, detail: "助手报告草稿已创建；请打开核对正文、图片和账号。尚未公开发布。", updatedAt: new Date().toISOString() };
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
    receipt.status = resolution;
    receipt.detail = resolution === "reviewed" ? "用户已在平台核对草稿；最终发布仍由用户完成" : "用户确认平台未收到，允许手动重新投递";
    receipt.updatedAt = new Date().toISOString();
    return receipt;
  });
  return { deliver, resolve, busy: () => active.size > 0 };
};
