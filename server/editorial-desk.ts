import type { AssignmentDecision, AssignmentMode, EvidenceStrength } from "./product-types.js";

export interface EditorialAssignmentInput {
  technicalArticle?: import("./technical-article.js").TechnicalArticlePolicy;
  title: string;
  ageHours: number;
  evidenceStrength: EvidenceStrength;
  factSourceCount: number;
  communitySourceCount: number;
  communitySampleCount: number;
  longestExcerpt: number;
  protected: boolean;
  now: string;
}

/**
 * EditorialDesk is the deterministic routing and blocking boundary. AI may
 * later explain or suggest an angle, but it cannot route weak evidence around
 * Watch/Skip or bypass age and copyright policy by changing the requested mode.
 */
export const assignStory = (input: EditorialAssignmentInput): AssignmentDecision => {
  const blockers: string[] = [];
  const warnings: string[] = [];
  let mode: AssignmentMode;
  let reason: string;
  if (input.ageHours > 7 * 24 && !input.protected && !input.technicalArticle) {
    mode = "skip";
    reason = "内容已经超过七日补看窗口，且没有进入编辑流程";
    blockers.push("内容已过期");
  } else if (input.evidenceStrength === "weak") {
    mode = "watch";
    reason = input.communitySourceCount
      ? "社区热度存在，但缺少可建立事实主干的官方或新闻来源"
      : "当前只有弱证据或标题级信息，需要继续补充来源";
    blockers.push("事实证据不足，暂不生成可发布文章");
  } else if (input.technicalArticle) {
    mode = "curate";
    reason = input.technicalArticle.reason;
  } else if (/\b(?:how to|guide|tutorial|playbook)\b|教程|实操|方案|部署/iu.test(input.title) && input.communitySampleCount >= 2) {
    mode = "playbook";
    reason = "内容包含可执行方案，并有多个社区经验样本可供核对";
  } else if (input.communitySampleCount >= 5 && input.communitySourceCount > 0) {
    mode = "community";
    reason = "事实主干已建立，讨论样本足以整理为社区观察";
  } else if (input.factSourceCount >= 2) {
    mode = "synthesis";
    reason = "已有多个事实来源，适合比较信息增量后综合成稿";
  } else if (input.longestExcerpt >= 1_800) {
    mode = "curate";
    reason = "原始材料较完整，优先制作导读与有限引用，避免无意义重写";
  } else {
    mode = "brief";
    reason = "事件单一且证据足够，适合生成简洁事实稿";
  }
  if (input.communitySourceCount > 0 && input.communitySampleCount < 5) {
    warnings.push("社区样本不足，只能呈现有限观点，不能概括共识");
  }
  if (input.ageHours > 48 && input.ageHours <= 7 * 24 && !input.protected && !input.technicalArticle) {
    warnings.push("已超过 48 小时今日窗口，仅在近 7 日补看区展示");
  }
  return {
    mode,
    reason,
    audienceValue: /ai|模型|智能|agent|芯片|机器人/iu.test(input.title)
      ? "直接关系 AI 产品、开发或使用体验"
      : "属于普通科技读者可理解的产品或行业变化",
    evidenceStrength: input.evidenceStrength,
    canDraft: !["watch", "skip"].includes(mode),
    blockers,
    warnings,
    decidedAt: input.now,
    basis: "policy-v1",
  };
};

