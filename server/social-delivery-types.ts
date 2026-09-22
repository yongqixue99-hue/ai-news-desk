/** Browser-assisted article channels. Transport acknowledgements are not publication. */
export const socialPlatforms = [
  { id: "baijiahao", name: "百家号", url: "https://baijiahao.baidu.com/builder/rc/edit?type=news&is_from_cms=1", enabled: true, titleMin: 2, titleMax: 64, saveHint: "保存到草稿箱" },
  { id: "toutiao", name: "今日头条", url: "https://mp.toutiao.com/profile_v4/graphic/publish", enabled: false, titleMin: 2, titleMax: 30, saveHint: "平台自动保存 · 自动交付待接通" },
  { id: "zhihu", name: "知乎", url: "https://zhuanlan.zhihu.com/write", enabled: true, titleMin: 1, titleMax: 100, saveHint: "保存到草稿箱" },
] as const;
export type SocialPlatform = typeof socialPlatforms[number]["id"];
export interface SocialBridgeSettings { enabled: boolean; extensionId: string; tokenConfigured: boolean }
export interface SocialAccount { id: SocialPlatform; available: boolean; authenticated: boolean; authState: "unknown" | "signed-out" | "signed-in" | "unavailable"; username: string; accountId: string; detail: string }
export interface SocialDeliveryStatus {
  settings: SocialBridgeSettings; address: string; connected: boolean; detail: string; accounts: SocialAccount[];
}
export interface SocialDeliveryReceipt {
  id: string; platform: SocialPlatform; account: string; accountId: string; revisionHash: string; title: string;
  createdAt: string; updatedAt: string;
  status: "sending" | "reported" | "unknown" | "not-received" | "reviewed";
  detail: string; postId?: string; url?: string;
  finalPublishAttempted: false;
}

export interface SocialDeliveryTarget {
  platform: SocialPlatform; revisionHash: string;
  account?: string; accountId?: string; receiptId?: string;
  status: "queued" | "waiting-connection" | "waiting-login" | "sending" | "reported" | "unknown" | "blocked" | "cancelled";
  detail: string;
}
export interface SocialDeliveryBatch {
  id: string; createdAt: string; expiresAt: string; targets: SocialDeliveryTarget[];
}
export const socialTargetActive = (target: SocialDeliveryTarget) => ["queued", "waiting-connection", "waiting-login", "sending"].includes(target.status);
export const socialTitleProblem = (platform: SocialPlatform, title: string) => {
  const rule = socialPlatforms.find(item => item.id === platform)!;
  const length = Array.from(title.trim()).length;
  return length < rule.titleMin || length > rule.titleMax ? `${rule.name}文章标题需为 ${rule.titleMin}–${rule.titleMax} 字（当前 ${length} 字）` : "";
};
export const selectedSocialPlatforms = (input: unknown): SocialPlatform[] => {
  if (!Array.isArray(input) || !input.length || input.length > socialPlatforms.length || input.some(id => !socialPlatforms.some(item => item.id === id))) throw new Error("请选择有效的平台");
  return [...new Set(input)] as SocialPlatform[];
};
