import { deliveryContent, deliveryText } from "./delivery-content.js";
import type { PublisherStep } from "./types.js";
import type { WeChatDraftArticlePayload } from "./wechat-draft.js";

const labels = {
  title: "标题", body: "正文与来源链接", images: "图片及顺序", captions: "图片说明", cover: "封面",
  author: "作者", digest: "摘要", sourceUrl: "原文链接", comments: "留言权限", fanComments: "粉丝留言权限",
  community: "关联社区", topics: "话题", visibility: "可见范围", creationPlan: "创作计划", settings: "平台发布设置",
} as const;
export type DeliveryField = keyof typeof labels;
export interface DeliveryFieldChecks {
  schemaVersion: "delivery-fields/v1";
  adapterVersion: string;
  source: "remote-draft" | "editor-readback" | "helper-receipt";
  checkedAt: string;
  fields: Array<{ key: DeliveryField; label: string; status: "matched" | "different" | "unobserved" }>;
}
/** An acknowledgement without field evidence is never a successful readback. Values stay out of the receipt. */
export function compareDeliveryFields(adapterVersion: string, source: DeliveryFieldChecks["source"], expected: Partial<Record<DeliveryField, unknown>>, actual?: Partial<Record<DeliveryField, unknown>>, checkedAt = new Date().toISOString()): DeliveryFieldChecks {
  return { schemaVersion: "delivery-fields/v1", adapterVersion, source, checkedAt,
    fields: (Object.keys(expected) as DeliveryField[]).map(key => ({ key, label: labels[key],
      status: !actual || !Object.hasOwn(actual, key) || actual[key] === undefined ? "unobserved" : JSON.stringify(expected[key]) === JSON.stringify(actual[key]) ? "matched" : "different" })) };
}
const wechatFields = (article: WeChatDraftArticlePayload) => {
  const content = deliveryContent(article.content);
  return { title: deliveryText(article.title), body: { blocks: content.blocks, links: content.links }, images: content.images,
    cover: article.thumb_media_id, author: deliveryText(article.author), digest: deliveryText(article.digest), sourceUrl: deliveryText(article.content_source_url),
    comments: article.need_open_comment, fanComments: article.only_fans_can_comment };
};
export const wechatDeliveryChecks = (expected: WeChatDraftArticlePayload, actual?: WeChatDraftArticlePayload, checkedAt?: string) => {
  const fields: Partial<ReturnType<typeof wechatFields>> = wechatFields(expected);
  if (!expected.digest) delete fields.digest; // Empty input delegates automatic summary to WeChat.
  return compareDeliveryFields("wechat-draft/v3", "remote-draft", fields, actual ? wechatFields(actual) : undefined, checkedAt);
};
const xiaoheiheSteps: Partial<Record<DeliveryField, string>> = { title: "标题", body: "正文", images: "配图", community: "分区", topics: "话题", visibility: "可见范围", creationPlan: "创作计划", cover: "内容封面" };
export const xiaoheiheDeliveryChecks = (steps: PublisherStep[], version = "unknown", checkedAt?: string) => {
  const expected: Partial<Record<DeliveryField, boolean>> = {}, actual: Partial<Record<DeliveryField, boolean>> = {};
  for (const [key, name] of Object.entries(xiaoheiheSteps) as Array<[DeliveryField, string]>) {
    expected[key] = true;
    const matches = steps.filter(step => step.name === name);
    if (matches.length === 1) actual[key] = matches[0]!.ok;
  }
  return compareDeliveryFields(`xiaoheihe-chrome/${version}`, "editor-readback", expected, actual, checkedAt);
};
export const socialDeliveryChecks = (platform: string, version = "unknown", checkedAt?: string) => compareDeliveryFields(
  `social-bridge/v1:${platform}/${version}`, "helper-receipt", { title: true, body: true, images: true, cover: true, settings: true }, undefined, checkedAt,
);
