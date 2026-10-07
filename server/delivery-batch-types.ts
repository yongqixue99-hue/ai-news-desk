export const deliveryPlatforms = [
  { id: "wechat", name: "微信公众号", automatic: true, url: "https://mp.weixin.qq.com/" },
  { id: "xiaoheihe", name: "小黑盒", automatic: true, url: "https://www.xiaoheihe.cn/creator/editor/draft/article" },
  { id: "baijiahao", name: "百家号", automatic: true, url: "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1" },
  { id: "zhihu", name: "知乎", automatic: true, url: "https://zhuanlan.zhihu.com/write" },
  { id: "toutiao", name: "今日头条", automatic: false, url: "https://mp.toutiao.com/profile_v4/graphic/publish" },
] as const;
export type DeliveryPlatform = typeof deliveryPlatforms[number]["id"];
export type DeliveryTargetStatus = "queued" | "waiting-connection" | "waiting-login" | "sending" | "verified" | "filled" | "reported" | "unknown" | "failed" | "cancelled";
export interface DeliveryBatchTarget {
  platform: DeliveryPlatform;
  revisionHash: string;
  status: DeliveryTargetStatus;
  detail: string;
  accountBinding?: string;
  startedAt?: string;
  completedAt?: string;
  receiptId?: string;
  url?: string;
}
export interface DeliveryBatch {
  id: string;
  createdAt: string;
  expiresAt: string;
  draftUpdatedAt: string;
  retryOf?: string;
  targets: DeliveryBatchTarget[];
  browserError?: string;
}
export interface DeliveryBatchView {
  batches: DeliveryBatch[];
  platforms: Array<typeof deliveryPlatforms[number] & { ready: boolean; status?: "waiting-connection" | "waiting-login" | "failed"; detail: string; accountBinding?: string }>;
}
export const deliveryTargetActive = (target: DeliveryBatchTarget) => ["queued", "waiting-connection", "waiting-login", "sending"].includes(target.status);
export const retryableDeliveryPlatforms = (batch?: DeliveryBatch) => batch?.targets.filter(target => ["failed", "cancelled"].includes(target.status)
  && deliveryPlatforms.some(platform => platform.id === target.platform && platform.automatic)).map(target => target.platform) ?? [];
export const selectedDeliveryPlatforms = (input: unknown): DeliveryPlatform[] => {
  if (!Array.isArray(input) || !input.length || input.length > deliveryPlatforms.length
    || input.some(id => !deliveryPlatforms.some(platform => platform.id === id))) throw new Error("请选择有效的交付平台");
  return deliveryPlatforms.filter(platform => input.includes(platform.id)).map(platform => platform.id);
};
