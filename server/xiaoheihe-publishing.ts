import type { ArticleDraft, Settings, XiaoheihePublishOptions } from "./types.js";

export const XHH_FIXED_TOPICS = ["AI", "盒友杂谈", "盒友日常", "Steam 游戏"] as const;
export const topicKey = (value: string) => value.replace(/^#+|#+$/gu, "").replace(/\s+/gu, "").toLowerCase().replace(/和友/gu, "盒友");
export const canonicalCommunity = (value: string) => {
  const name = value.trim();
  return ({ codex: "CodeX", "steam游戏": "Steam", steam: "Steam", "硬件": "数码硬件", "和友杂谈": "盒友杂谈" } as Record<string, string>)[name.replace(/\s+/gu, "").toLowerCase()] || name || "盒友杂谈";
};
export const normalizeXiaoheiheOptions = (value: unknown): XiaoheihePublishOptions => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("小黑盒发布设置无效");
  const input = value as Record<string, unknown>;
  if (input.creationPlan !== undefined && !["none", "standard", "hot"].includes(String(input.creationPlan))) throw new Error("请选择有效的创作计划");
  if (input.companionCommunity !== undefined && !["Steam", "数码硬件"].includes(String(input.companionCommunity))) throw new Error("第二社区无效");
  if (input.coverPlacementId !== undefined && (typeof input.coverPlacementId !== "string" || input.coverPlacementId.length > 200)) throw new Error("封面图片无效");
  return { creationPlan: (input.creationPlan || "none") as XiaoheihePublishOptions["creationPlan"],
    companionCommunity: input.companionCommunity as XiaoheihePublishOptions["companionCommunity"],
    coverPlacementId: typeof input.coverPlacementId === "string" ? input.coverPlacementId || undefined : undefined };
};

/** Defaults are fixed per draft; saving or retrying must not rotate its communities. */
export const xiaoheiheSelection = (draft: Pick<ArticleDraft, "community" | "topics" | "xiaoheiheOptions">, next: "Steam" | "数码硬件" = "Steam") => {
  const primary = canonicalCommunity(draft.community);
  const options = normalizeXiaoheiheOptions(draft.xiaoheiheOptions ?? {});
  let companion = options.companionCommunity ?? next;
  if (companion === primary) companion = companion === "Steam" ? "数码硬件" : "Steam";
  const extras = draft.topics.map(topic => topic.trim().replace(/^#+|#+$/gu, "").trim()).filter(topic => topic && !XHH_FIXED_TOPICS.some(fixed => topicKey(fixed) === topicKey(topic)));
  return {
    community: primary,
    communities: primary === "盒友杂谈" ? [primary] : [primary, companion],
    topics: [...XHH_FIXED_TOPICS, ...extras.slice(0, 1)],
    options: { ...options, companionCommunity: primary === "盒友杂谈" ? options.companionCommunity : companion },
  };
};

export const reserveXiaoheiheDefaults = (draft: ArticleDraft, settings: Settings, previous?: ArticleDraft) => {
  const selection = xiaoheiheSelection(draft, settings.xiaoheiheNextCompanion);
  draft.community = selection.community;
  draft.topics = selection.topics;
  draft.xiaoheiheOptions = selection.options;
  if (selection.communities.length === 2 && !previous?.xiaoheiheOptions?.companionCommunity) {
    settings.xiaoheiheNextCompanion = selection.options.companionCommunity === "Steam" ? "数码硬件" : "Steam";
  }
  return selection;
};
