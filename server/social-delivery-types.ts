/** Browser-assisted article channels. Transport acknowledgements are not publication. */
export const socialPlatforms = [
  { id: "zhihu", name: "知乎", url: "https://zhuanlan.zhihu.com/write", enabled: true },
  { id: "baijiahao", name: "百家号", url: "https://baijiahao.baidu.com/builder/rc/home", enabled: true },
  { id: "toutiao", name: "今日头条", url: "https://mp.toutiao.com/", enabled: false },
] as const;
export type SocialPlatform = typeof socialPlatforms[number]["id"];
export interface SocialBridgeSettings { enabled: boolean; extensionId: string; tokenConfigured: boolean }
export interface SocialAccount { id: SocialPlatform; available: boolean; authenticated: boolean; username: string; accountId: string; detail: string }
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
