import type { Express, RequestHandler } from "express";
import { SocialBridge } from "./social-bridge.js";
import { createSocialDeliveryDesk, socialAccounts, socialRevisionHash, socialDraftUrl } from "./social-delivery.js";
import { selectedSocialPlatforms, socialPlatforms, socialTargetActive, type SocialPlatform, type SocialBridgeSettings, type SocialDeliveryStatus } from "./social-delivery-types.js";
import { createSocialDeliveryQueue } from "./social-delivery-queue.js";
import { openRegularChromeUrls } from "./chrome-launch.js";
import { getSocialBridgeToken, setSocialBridgeToken } from "./secrets.js";
import { readState, updateState, getLocalDatabase } from "./storage.js";
import { reviewDraftQuality } from "./draft-quality-review.js";
import { loadWeChatPlacementImage } from "./wechat-image.js";

const bridge = new SocialBridge();
const desk = createSocialDeliveryDesk({
  bridge, read: readState, update: updateState, loadImage: loadWeChatPlacementImage,
  quality: async draft => {
    const review = reviewDraftQuality(draft, await getLocalDatabase());
    if (!review.ready) throw new Error(review.blockers.join("；"));
  },
});
const defaultSettings: SocialBridgeSettings = { enabled: false, extensionId: "", tokenConfigured: false };
export const startSocialBridge = async () => {
  const settings = (await readState()).settings.socialBridge ?? defaultSettings;
  if (settings.enabled && settings.tokenConfigured) await bridge.start(settings.extensionId, await getSocialBridgeToken());
};
const route = (handler: RequestHandler): RequestHandler => (request, response, next) => {
  void Promise.resolve(handler(request, response, next)).catch(error => {
    // These handlers expose controlled, user-actionable errors without logging request bodies.
    response.status(400).json({ error: error instanceof Error ? error.message : "投递未完成，请检查连接状态" });
  });
};
let checking: Promise<SocialDeliveryStatus> | undefined;
const status = (): Promise<SocialDeliveryStatus> => checking ??= (async () => {
  const settings = (await readState()).settings.socialBridge ?? defaultSettings;
  let detail = settings.enabled ? "等待同步助手连接；浏览器登录状态尚未检测" : "尚未配置文章同步助手";
  let accounts = socialAccounts([]);
  try {
    await startSocialBridge();
    if (bridge.connected) {
      const auth = await Promise.all(socialPlatforms.filter(platform => platform.enabled).map(async platform => {
        try { const result = await bridge.request("checkAuth", { platform: platform.id }); return { ...(result && typeof result === "object" ? result : {}), id: platform.id }; }
        catch { return { id: platform.id }; }
      }));
      accounts = socialAccounts(auth);
      detail = "同步助手已连接，直接复用 Chrome 中的登录账号";
    }
  } catch (error) { detail = error instanceof Error ? error.message : "同步助手暂不可用"; }
  return { settings, address: "ws://127.0.0.1:19527", connected: bridge.connected, detail, accounts };
})().finally(() => { checking = undefined; });
const openPlatforms = (platforms: SocialPlatform[]) => openRegularChromeUrls(platforms.map(id => socialPlatforms.find(item => item.id === id)!.url));
const openReceipt = (receipt: import("./social-delivery-types.js").SocialDeliveryReceipt) => {
  const url = socialDraftUrl(receipt.platform, receipt.url);
  if (!url) throw new Error("未取得有效的草稿编辑链接，请到平台核对");
  return openRegularChromeUrls([url]);
};
const queue = createSocialDeliveryQueue({ read: readState, update: updateState, status, deliver: desk.deliver, open: openPlatforms, openReceipt });
let polling: ReturnType<typeof setInterval> | undefined;
export const registerSocialDeliveryRoutes = (app: Express) => {
  polling ??= setInterval(() => { void queue.tick().catch(() => undefined); }, 5_000).unref();
  app.get("/api/delivery/social/status", route(async (_request, response) => {
    response.json(await status());
  }));
  app.post("/api/delivery/social/open", route(async (request, response) => {
    const platforms = selectedSocialPlatforms(request.body?.platforms);
    await openPlatforms(platforms);
    response.json({ platforms, detail: "已在 Chrome 打开所选编辑页；已登录账号会直接进入" });
  }));
  app.get("/api/drafts/:draftId/social-delivery-batches", route(async (request, response) => {
    const draft = (await readState()).drafts.find(item => item.id === request.params.draftId);
    if (!draft) throw new Error("草稿不存在");
    response.json(draft.socialDeliveryBatches ?? []);
  }));
  app.post("/api/drafts/:draftId/social-delivery-batches", route(async (request, response) => {
    const accounts = request.body?.accounts;
    if (accounts && (typeof accounts !== "object" || Array.isArray(accounts))) throw new Error("账号信息无效，请刷新重试");
    const batch = await queue.start(String(request.params.draftId), request.body?.platforms, String(request.body?.updatedAt ?? ""), accounts);
    response.json(batch);
    void queue.tick().catch(() => undefined);
  }));
  app.post("/api/drafts/:draftId/social-delivery-batches/:batchId/cancel", route(async (request, response) => {
    response.json(await queue.cancel(String(request.params.draftId), String(request.params.batchId)));
  }));
  app.patch("/api/delivery/social/settings", route(async (request, response) => {
    if (desk.busy() || (await readState()).drafts.some(draft => draft.socialDeliveryBatches?.some(batch => batch.targets.some(target => socialTargetActive(target) && target.status === "sending")))) throw new Error("有投递正在执行，请完成后再修改连接");
    const extensionId = typeof request.body?.extensionId === "string" ? request.body.extensionId.trim() : "";
    const enabled = request.body?.enabled === true;
    if (!/^[a-p]{32}$/.test(extensionId)) throw new Error("扩展 ID 应为 chrome://extensions 显示的 32 位字母");
    const token = typeof request.body?.token === "string" ? request.body.token.trim() : "";
    if (token && (token.length < 16 || token.length > 500)) throw new Error("Token 长度应为 16–500 位");
    const previous = (await readState()).settings.socialBridge;
    if (previous?.extensionId && previous.extensionId !== extensionId && !token) throw new Error("更换扩展时请重新填写 Token");
    if (token) await setSocialBridgeToken(token);
    if (enabled) await getSocialBridgeToken();
    const settings = { enabled, extensionId, tokenConfigured: Boolean(token || previous?.tokenConfigured) };
    await updateState(state => { state.settings.socialBridge = settings; });
    await bridge.stop();
    await startSocialBridge();
    response.json(settings);
  }));
  app.get("/api/drafts/:draftId/social-deliveries", route(async (request, response) => {
    const draft = (await readState()).drafts.find(item => item.id === request.params.draftId);
    if (!draft) { response.status(404).json({ error: "草稿不存在" }); return; }
    response.json({ receipts: (draft.socialDeliveries ?? []).map(receipt => ({ ...receipt, url: socialDraftUrl(receipt.platform, receipt.url) })), revisions: Object.fromEntries(socialPlatforms.map(platform => [platform.id, socialRevisionHash(draft, platform.id)])) });
  }));
  app.post("/api/drafts/:draftId/social-deliveries", route(async (request, response) => {
    const platform = request.body?.platform as SocialPlatform;
    if (!socialPlatforms.some(item => item.id === platform)) throw new Error("未知目标平台");
    await startSocialBridge();
    const receipt = await desk.deliver(String(request.params.draftId), platform, String(request.body?.account ?? ""), String(request.body?.updatedAt ?? ""), String(request.body?.accountId ?? ""));
    response.json(receipt);
  }));
  app.post("/api/drafts/:draftId/social-deliveries/:receiptId/resolve", route(async (request, response) => {
    const resolution = request.body?.resolution;
    if (resolution !== "reviewed" && resolution !== "not-received") throw new Error("无效的回执核对状态");
    response.json(await desk.resolve(String(request.params.draftId), String(request.params.receiptId), resolution));
  }));
  app.post("/api/drafts/:draftId/social-deliveries/:receiptId/open", route(async (request, response) => {
    const receipt = (await readState()).drafts.find(item => item.id === request.params.draftId)?.socialDeliveries?.find(item => item.id === request.params.receiptId);
    if (!receipt) throw new Error("草稿回执不存在");
    await openReceipt(receipt);
    response.json({ ok: true });
  }));
};
