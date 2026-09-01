import type { ArticleDraft, DraftFactClaim, DraftSource } from "./types.js";
import { isCommunityDiscoveryFraming } from "./editorial-source-policy.js";

const communityLabelPattern = /Hacker News|Reddit|V2EX|知乎|社区|讨论串/u;
const communityCommentPattern = /Top Comments|热门评论|热评|Top Comment/u;
const rightsPattern = /版权|转载|翻译|图片|授权|许可|权利/u;
const contextPattern = /^(仍未知|未知|尚未公开|公开资料|现有页面|原始材料过长|原文使用)|没有说明|没有给出|无法直接读取|本地快照/u;
const explicitFactPattern = /^(待核验|待确认|事实冲突|来源冲突)|尚未核实|无法核实/u;
const weakStatuses = new Set(["excerpt-only", "inference", "unverified"]);

const hostFor = (value: string) => {
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    return "";
  }
};

export const isCommunityDiscoverySource = (source: DraftSource) => {
  const host = hostFor(source.url);
  if (["news.ycombinator.com", "reddit.com", "www.reddit.com", "old.reddit.com", "v2ex.com", "www.v2ex.com", "zhihu.com", "www.zhihu.com"].includes(host)) return true;
  if ((host === "github.com" || host === "www.github.com") && /\/(issues|discussions)\//u.test(new URL(source.url).pathname)) return true;
  return communityLabelPattern.test(source.label);
};

const isCommunityCommentClaim = (claim: DraftFactClaim) => communityCommentPattern.test(
  `${claim.claim} ${claim.sourceExcerpt ?? ""}`,
) || isCommunityDiscoveryFraming(claim.claim);

export type DraftUncertaintyKind = "fact" | "rights" | "context";

export const classifyDraftUncertainty = (value: string): DraftUncertaintyKind => {
  const text = value.trim();
  if (rightsPattern.test(text)) return "rights";
  if (explicitFactPattern.test(text)) return "fact";
  if (contextPattern.test(text)) return "context";
  return "fact";
};

const insertedImageIds = (draft: ArticleDraft) => {
  const ids = new Set<string>();
  for (const match of draft.bodyHtml?.matchAll(/data-media-id=["']([^"']+)["']/gu) ?? []) ids.add(match[1]);
  return ids;
};

export interface DraftEvidenceView {
  eventSources: DraftSource[];
  discoverySources: DraftSource[];
  automaticClaims: DraftFactClaim[];
  attentionClaims: DraftFactClaim[];
  discussionNotes: DraftFactClaim[];
  factUncertainties: string[];
  rightsNotes: string[];
  contextNotes: string[];
  automaticFactCount: number;
  factDecisionCount: number;
  sourceDecisionCount: number;
  imageDecisionCount: number;
  sourceRightsDecisionCount: number;
  totalDecisionCount: number;
}

export const buildDraftEvidenceView = (draft: ArticleDraft): DraftEvidenceView => {
  const discoverySources = draft.sources.filter(isCommunityDiscoverySource);
  const eventSources = draft.sources.filter((source) => !isCommunityDiscoverySource(source));
  const discussionNotes = (draft.factClaims ?? []).filter(isCommunityCommentClaim);
  const factualClaims = (draft.factClaims ?? []).filter((claim) => !isCommunityCommentClaim(claim));
  const automaticClaims = factualClaims.filter((claim) => !weakStatuses.has(claim.status));
  const attentionClaims = factualClaims.filter((claim) => weakStatuses.has(claim.status));
  const factUncertainties: string[] = [];
  const rightsNotes: string[] = [];
  const contextNotes: string[] = [];
  for (const uncertainty of draft.uncertainties) {
    const kind = classifyDraftUncertainty(uncertainty);
    if (kind === "fact") factUncertainties.push(uncertainty);
    else if (kind === "rights") rightsNotes.push(uncertainty);
    else contextNotes.push(uncertainty);
  }
  const inserted = insertedImageIds(draft);
  const insertedImages = draft.images.filter((placement) => inserted.has(placement.id));
  const imageDecisionCount = insertedImages.filter((placement) => {
    const platforms = placement.image.allowedPlatforms
      ?? (placement.image.rights === "owned" ? ["*"] : []);
    return ["check-required", "expired"].includes(placement.image.rights)
      || !platforms.some((platform) => platform === "wechat" || platform === "*")
      || !placement.image.localPath;
  }).length;
  const sourceRightsDecisionCount = draft.sourceMaterial?.rights === "check-required" ? 1 : 0;
  const sourceDecisionCount = eventSources.filter((source) => !source.verified).length;
  const factDecisionCount = attentionClaims.length + factUncertainties.length;
  return {
    eventSources,
    discoverySources,
    automaticClaims,
    attentionClaims,
    discussionNotes,
    factUncertainties,
    rightsNotes,
    contextNotes,
    automaticFactCount: automaticClaims.length,
    factDecisionCount,
    sourceDecisionCount,
    imageDecisionCount,
    sourceRightsDecisionCount,
    totalDecisionCount: factDecisionCount + sourceDecisionCount + imageDecisionCount + sourceRightsDecisionCount,
  };
};
