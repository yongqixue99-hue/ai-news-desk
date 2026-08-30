import { createHash } from "node:crypto";
import type {
  AssetCandidate,
  AssignmentMode,
  ContentPackage,
  DiscussionSample,
  EvidenceClaim,
  StoryView,
} from "./product-types.js";
import { storyById } from "./story-desk.js";
import type { Candidate, SourceImage, WorkflowState } from "./types.js";

const signalIdFor = (runId: string, candidateId: string) => `${runId}:${candidateId}`;
const compactWhitespace = (value: string) => value.replace(/<[^>]+>/gu, " ").replace(/\s+/gu, " ").trim();

const splitClaims = (value: string) => compactWhitespace(value)
  .split(/(?<=[。！？!?；;])\s*|\n+/u)
  .map((item) => item.trim())
  .filter((item) => item.length >= 18 && item.length <= 260)
  .slice(0, 3);

const normalizedClaim = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]-]+/gu, "")
  .slice(0, 180);

const domainFor = (value: string) => {
  try { return new URL(value).hostname.replace(/^www\./u, ""); } catch { return value; }
};

const candidateForSignal = (state: WorkflowState, runId: string, candidateId: string) =>
  state.runs.find((run) => run.id === runId)?.candidates.find((candidate) => candidate.id === candidateId);

const evidenceClaimsFor = (state: WorkflowState, story: StoryView): EvidenceClaim[] => {
  const candidates = story.signals
    .filter((signal) => !signal.isCommunity)
    .map((signal) => ({
      signal,
      candidate: candidateForSignal(state, signal.runId, signal.candidateId),
    }))
    .filter((entry): entry is typeof entry & { candidate: Candidate } => Boolean(entry.candidate));
  const groups = new Map<string, Array<{ text: string; signalId: string; candidate: Candidate }>>();

  for (const { signal, candidate } of candidates) {
    const sourceText = candidate.briefing?.summaryZh || candidate.excerpt || candidate.title;
    const claims = splitClaims(sourceText);
    for (const text of claims.length ? claims : [compactWhitespace(candidate.title)]) {
      const key = normalizedClaim(text);
      if (!key) continue;
      const items = groups.get(key) ?? [];
      items.push({ text, signalId: signalIdFor(signal.runId, signal.candidateId), candidate });
      groups.set(key, items);
    }
  }

  return [...groups.values()].slice(0, 16).map((support, index) => {
    const domains = new Set(support.map((item) => domainFor(item.candidate.canonicalUrl || item.candidate.url)));
    const hasOfficial = support.some((item) => item.candidate.sourceRole === "official");
    const hasFullSource = support.some((item) => item.candidate.briefing?.basis === "full-source");
    const onlyTitle = support.every((item) => !item.candidate.briefing || item.candidate.briefing.basis === "title");
    const status: EvidenceClaim["status"] = onlyTitle
      ? "unverified"
      : domains.size >= 2 || hasOfficial || hasFullSource
        ? "supported"
        : "partially-supported";
    const text = support[0]!.text;
    return {
      id: `claim_${createHash("sha1").update(`${story.id}:${index}:${text}`).digest("hex").slice(0, 12)}`,
      text,
      status,
      sourceSignalIds: [...new Set(support.map((item) => item.signalId))],
      sourceUrls: [...new Set(support.map((item) => item.candidate.canonicalUrl || item.candidate.url))],
      note: status === "unverified"
        ? "当前只有标题级信息；写稿和同步前必须补充正文证据。"
        : status === "partially-supported"
          ? "只有一个独立来源支持，成稿时应使用克制表述。"
          : domains.size >= 2
            ? `由 ${domains.size} 个独立站点支持。`
            : hasOfficial
              ? "由官方来源直接支持。"
              : "已读取来源正文。",
    };
  });
};

const sampleKindFor = (text: string): DiscussionSample["kind"] => {
  if (/\?|？|how|怎么|为何|为什么|有没有/iu.test(text)) return "question";
  if (/解决|方法|可以试|workaround|fix|步骤|配置|安装|部署/iu.test(text)) return "solution";
  if (/我用|我们用|试过|experience|tested|in production|实测|遇到/iu.test(text)) return "experience";
  if (/未来|将会|可能|predict|expect|会不会/iu.test(text)) return "prediction";
  if (/但是|不过|反对|不同意|并不|yet|however|disagree|问题在于/iu.test(text)) return "counterpoint";
  return "opinion";
};

const discussionSamplesFor = (state: WorkflowState, story: StoryView): DiscussionSample[] => {
  const samples: DiscussionSample[] = [];
  for (const signal of story.signals.filter((item) => item.isCommunity)) {
    const candidate = candidateForSignal(state, signal.runId, signal.candidateId);
    if (!candidate) continue;
    const matches = [...candidate.excerpt.matchAll(/\[([^\]]{1,80})\]:\s*([\s\S]{20,}?)(?=\s+\[[^\]]{1,80}\]:|$)/gu)];
    const rawSamples = matches.length
      ? matches.map((match) => ({ author: compactWhitespace(match[1]!), text: compactWhitespace(match[2]!) }))
      : candidate.author && candidate.excerpt.length >= 40
        ? [{ author: candidate.author, text: compactWhitespace(candidate.excerpt) }]
        : [];
    rawSamples.slice(0, 30).forEach((sample, index) => {
      const originalText = sample.text.slice(0, 1_200);
      samples.push({
        id: `sample_${createHash("sha1").update(`${signal.runId}:${signal.candidateId}:${index}:${originalText}`).digest("hex").slice(0, 12)}`,
        signalId: signalIdFor(signal.runId, signal.candidateId),
        platform: signal.sourceName,
        author: sample.author || "匿名用户",
        permalink: signal.discussionUrl || signal.url,
        originalText,
        kind: sampleKindFor(originalText),
        branchId: `${signal.candidateId}:excerpt-only`,
        publishedAt: signal.publishedAt,
      });
    });
  }
  const seen = new Set<string>();
  return samples.filter((sample) => {
    const key = `${sample.author.toLocaleLowerCase()}:${normalizedClaim(sample.originalText)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 80);
};

const rightsFor = (image: SourceImage): Pick<AssetCandidate, "rightsDecision" | "rightsReason"> => {
  if (image.rights === "expired") return { rightsDecision: "blocked", rightsReason: "授权或适用期已过期" };
  if (["official", "licensed", "owned"].includes(image.rights)) {
    const allowed = image.allowedPlatforms;
    if (allowed?.length && !allowed.includes("wechat") && !allowed.includes("*")) {
      return { rightsDecision: "blocked", rightsReason: "现有授权不包含微信公众号" };
    }
    return { rightsDecision: "allowed", rightsReason: "权利状态允许进入微信公众号预检" };
  }
  return {
    rightsDecision: "warning",
    rightsReason: image.rights === "editorial-screenshot" || image.rights === "commentary-screenshot"
      ? "编辑截图需要人工确认合理使用范围与图注"
      : "来源未明确授权，使用前必须人工确认",
  };
};

const imageRoleFor = (image: SourceImage): AssetCandidate["role"] => {
  const text = `${image.caption} ${image.attribution} ${image.url}`;
  if (/chart|graph|benchmark|数据|图表|排行|曲线/iu.test(text)) return "data";
  if (/screenshot|界面|dashboard|产品|demo|演示/iu.test(text)) return "product";
  if (/comment|社区|reddit|hacker news|v2ex|知乎/iu.test(text)) return "community";
  return "fact";
};

const assetsFor = (story: StoryView, claims: EvidenceClaim[]): AssetCandidate[] => story.images.map((image, index) => ({
  id: `asset_${createHash("sha1").update(`${story.id}:${image.id}:${image.url}`).digest("hex").slice(0, 12)}`,
  sourceImageId: image.id,
  url: image.publicPath || image.url,
  caption: image.caption,
  attribution: image.attribution,
  sourceUrl: image.sourceUrl,
  rights: image.rights,
  ...rightsFor(image),
  role: index === 0 ? "cover" : imageRoleFor(image),
  width: image.width,
  height: image.height,
  recommendedAfterClaimId: claims[index % Math.max(1, claims.length)]?.id,
}));

const communityEvidenceLabelFor = (samples: DiscussionSample[]) => {
  const authors = new Set(samples.map((sample) => sample.author));
  const branches = new Set(samples.map((sample) => sample.branchId).filter(Boolean));
  if (samples.length < 5) return `仅 ${samples.length} 条有效样本，只能表述为“有限样本中有人提出”`;
  if (samples.length < 15 || branches.size < 5) return `${samples.length} 条样本可列出观点，但不足以宣称多数或共识`;
  return `${samples.length} 条样本、${authors.size} 名作者、${branches.size} 个讨论分支，可提炼反复出现的主题`;
};

const anglesFor = (mode: ContentPackage["mode"], story: StoryView) => ({
  brief: ["发生了什么、何时发生、普通读者为何要在意", "把已证实事实与仍待观察的信息明确分开"],
  synthesis: ["比较不同来源各自新增了什么", "找出官方说法、独立验证与社区体验之间的差距"],
  community: ["先建立事实主干，再呈现多种真实使用观点", "保留分歧，不把少量高赞评论包装成共识"],
  playbook: ["按可复现顺序整理步骤、条件和失败案例", "把经验与官方支持范围分开标记"],
  curate: ["说明原文为什么值得读，不做无意义全文重写", "只引用必要片段并把读者带回原文"],
})[mode].map((angle) => `${angle}；围绕“${story.title}”展开`);

export interface BuildContentPackageInput {
  storyId: string;
  mode?: Exclude<AssignmentMode, "watch" | "skip">;
  now?: string;
  discussionSamples?: DiscussionSample[];
}

/**
 * PackageDesk is the sole writing-evidence boundary. It converts a Story into
 * a reviewable package of claims, community samples and governed assets; draft
 * generation must consume this result instead of reaching back into raw feeds.
 */
export const buildContentPackage = (state: WorkflowState, input: BuildContentPackageInput): ContentPackage => {
  const now = input.now ?? new Date().toISOString();
  const story = storyById(state, input.storyId, now);
  if (!story) throw new Error("Story 不存在或已经从当前数据中移除");
  if (!story.assignment.canDraft) {
    throw new Error(story.assignment.blockers[0] || "当前 Story 不能进入成稿流程");
  }
  const mode = input.mode ?? story.assignment.mode;
  if (mode === "watch" || mode === "skip") throw new Error("Watch 和 Skip 不会生成素材包");
  const facts = evidenceClaimsFor(state, story);
  const discussionSamples = input.discussionSamples?.length
    ? input.discussionSamples
    : discussionSamplesFor(state, story);
  const assets = assetsFor(story, facts);
  const blockers = [...story.assignment.blockers];
  if (!facts.some((claim) => claim.status === "supported" || claim.status === "partially-supported")) {
    blockers.push("没有可用于写作的正文级事实");
  }
  const uncertainties = [
    ...story.assignment.warnings,
    ...facts.filter((claim) => claim.status === "unverified").map((claim) => `待核验：${claim.text}`),
  ];
  if (assets.some((asset) => asset.rightsDecision === "warning")) uncertainties.push("部分图片需要人工确认权利状态");
  if (assets.some((asset) => asset.rightsDecision === "blocked")) uncertainties.push("存在不能同步微信公众号的图片，预检时会自动排除");
  const sourceFingerprint = story.signals.map((signal) => `${signal.runId}:${signal.candidateId}:${signal.fetchedAt}`).sort().join("|");
  const id = `package_${createHash("sha256").update(`${story.id}:${mode}:${sourceFingerprint}`).digest("hex").slice(0, 18)}`;
  return {
    id,
    storyId: story.id,
    mode,
    title: story.title,
    createdAt: now,
    facts,
    communitySummary: story.communitySummary,
    communityFocus: story.communityFocus,
    discussionSamples,
    sourceSignalIds: story.signals.map((signal) => signalIdFor(signal.runId, signal.candidateId)),
    sources: story.signals.map((signal) => ({
      signalId: signalIdFor(signal.runId, signal.candidateId),
      label: signal.sourceName,
      url: signal.discussionUrl || signal.url,
      role: signal.sourceRole || (signal.isCommunity ? "community" : "discovery"),
      basis: candidateForSignal(state, signal.runId, signal.candidateId)?.briefing?.basis ?? "title",
      publishedAt: signal.publishedAt,
      isCommunity: signal.isCommunity,
    })),
    imageIds: assets.map((asset) => asset.id),
    assets,
    uncertainties: [...new Set(uncertainties)],
    suggestedAngles: anglesFor(mode, story),
    communityEvidenceLabel: communityEvidenceLabelFor(discussionSamples),
    status: blockers.length ? "blocked" : "ready",
    blockers: [...new Set(blockers)],
  };
};
