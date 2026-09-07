import { createHash } from "node:crypto";
import { assessEditorialOpportunity, opportunityPriority } from "./newsworthiness.js";
import { personalizeCandidates } from "./personalization.js";
import type {
  EvidenceStrength,
  ModelReleaseDossier,
  StoryExplanation,
  StorySignalView,
  StoryTrendView,
  StoryView,
  TodayView,
} from "./product-types.js";
import { assignStory } from "./editorial-desk.js";
import { isCommunityCandidate } from "./community-feed.js";
import { interleaveBySource } from "./source-diversity.js";
import { hasCurrentPublication } from "./publication-state.js";
import { isLocalImageFileReady, isNeutralImagePublishReady } from "./image-readiness.js";
import { uniqueEligibleEditorialImages } from "./editorial-image-policy.js";
import { firstPartyModelVendorFor, modelResearchVendorFor } from "./model-release-research.js";
import type { Candidate, CollectionTopicId, SourceConfig, WorkflowState } from "./types.js";

interface CandidateRecord {
  runId: string;
  candidate: Candidate;
}

interface StoryCluster {
  records: CandidateRecord[];
  exactKeys: Set<string>;
  versionKeys: Set<string>;
  titles: string[];
  /**
   * The first observed source identity is deliberately immutable. Page
   * extraction may discover a canonical URL later; that must enrich a Story,
   * not silently create a different Story id while a package job is running.
   */
  identityKey: string;
}

const titleStopWords = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "in", "is", "it", "of", "on", "or", "the", "to", "with",
  "new", "news", "official", "report", "reports", "发布", "宣布", "推出", "消息", "报道", "关于", "一个", "这个",
]);
const titleTokenCache = new Map<string, Set<string>>();
const versionEventWords = new Set([
  "announces", "announced", "introduces", "introducing", "launches", "launched", "releases", "released",
  "model", "models", "preview", "version", "正式", "模型", "发布", "推出", "上线",
]);
const distinctiveModelProductWords = new Set([
  "fable", "mythos", "astra", "opus", "sonnet", "haiku", "magistral", "devstral",
]);

const normalizedUrl = (value: string | undefined) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|spm|from)$/iu.test(key)) url.searchParams.delete(key);
    }
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    return url.toString().toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

export const hasLinkedCommunitySource = (candidate: Candidate) => {
  if (!isCommunityCandidate(candidate)) return false;
  const sourceUrl = normalizedUrl(candidate.canonicalUrl || candidate.url);
  const discussionUrl = normalizedUrl(candidate.engagement?.discussionUrl);
  return Boolean(sourceUrl && discussionUrl && sourceUrl !== discussionUrl);
};

const isFactBearingCandidate = (candidate: Candidate) => !isCommunityCandidate(candidate)
  || (hasLinkedCommunitySource(candidate) && candidate.briefing?.basis === "full-source");

const titleTokens = (title: string) => {
  const cached = titleTokenCache.get(title);
  if (cached) return cached;
  const normalized = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim();
  const words = normalized.split(/\s+/u).filter((word) => word.length > 1 && !titleStopWords.has(word));
  const chinese = [...normalized.matchAll(/[\u3400-\u9fff]{2,}/gu)].flatMap((match) => {
    const value = match[0];
    return value.length <= 2
      ? [value]
      : Array.from({ length: value.length - 1 }, (_unused, index) => value.slice(index, index + 2));
  });
  const tokens = new Set([...words, ...chinese]);
  if (titleTokenCache.size >= 5_000) titleTokenCache.clear();
  titleTokenCache.set(title, tokens);
  return tokens;
};

const titleSimilarity = (left: string, right: string) => {
  const leftTokens = titleTokens(left);
  const rightTokens = titleTokens(right);
  if (!leftTokens.size || !rightTokens.size) return 0;
  let intersection = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1;
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return Math.max(intersection / union, (intersection / Math.min(leftTokens.size, rightTokens.size)) * 0.9);
};

const recordTitles = (record: CandidateRecord) => [
  record.candidate.title,
  record.candidate.briefing?.titleZh,
].filter((value): value is string => Boolean(value));

/**
 * Model releases are often titled from different angles by the owner,
 * hosting platforms, and communities. Preserve the product token immediately
 * before a dotted version number so "Claude Fable 5.1" can join an AWS
 * availability post without collapsing unrelated 5.1 releases.
 */
const versionedEntityKeys = (title: string) => {
  const words = title
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}.+-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean);
  const keys = new Set<string>();
  for (let index = 1; index < words.length; index += 1) {
    const version = words[index]?.match(/^v?(\d+(?:\.\d+)+(?:[-+][a-z0-9.-]+)?)$/u)?.[1];
    if (!version) continue;
    const product = words[index - 1]!;
    if (product.length < 3 || versionEventWords.has(product)) continue;
    keys.add(`${product}@${version}`);
    const family = words[index - 2];
    if (family && family.length >= 3 && !versionEventWords.has(family) && !titleStopWords.has(family)) {
      keys.add(`${family}:${product}@${version}`);
    }
  }
  return keys;
};

const versionKeysFor = (record: CandidateRecord) => record.candidate.technicalArticle ? new Set<string>() : new Set(
  recordTitles(record).flatMap((title) => {
    const keys = [...versionedEntityKeys(title)];
    const normalized = title.normalize("NFKC").toLocaleLowerCase();
    const looksLikeRelease = /(?:\bv?\d+(?:\.\d+)+\b|\b(?:release(?:d|s)?|launch(?:ed|es)?|introduc(?:e|ed|es|ing)|announce(?:d|s)?|preview)\b|发布|推出|上线|预告)/iu.test(normalized);
    if (!looksLikeRelease) return keys;
    const words = normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u);
    for (const word of words) {
      if (distinctiveModelProductWords.has(word)) keys.push(`model:${word}`);
    }
    return keys;
  }),
);

const exactKeysFor = (candidate: Candidate) => [...new Set([
  normalizedUrl(candidate.url),
  normalizedUrl(candidate.canonicalUrl),
  candidate.evidenceRelation === "independent-report" || candidate.evidenceRelation === "research-material"
    ? normalizedUrl(candidate.evidenceGroupUrl)
    : "",
  normalizedUrl(candidate.engagement?.discussionUrl),
].filter(Boolean))];

const initialIdentityFor = (record: CandidateRecord) => exactKeysFor(record.candidate)[0]
  || `${record.candidate.title.toLocaleLowerCase()}:${record.candidate.publishedAt.slice(0, 10)}`;

const timeFor = (record: CandidateRecord) => {
  const fetched = Date.parse(record.candidate.fetchedAt);
  return Number.isFinite(fetched) ? fetched : Date.parse(record.candidate.publishedAt);
};

const withinMergeWindow = (left: CandidateRecord, right: CandidateRecord) => {
  const delta = Math.abs(Date.parse(left.candidate.publishedAt) - Date.parse(right.candidate.publishedAt));
  return Number.isFinite(delta) && delta <= 96 * 3_600_000;
};

const clustersFor = (state: WorkflowState) => {
  const clusters: StoryCluster[] = [];
  const exactIndex = new Map<string, StoryCluster>();
  const versionIndex = new Map<string, Set<StoryCluster>>();
  const titleIndex = new Map<string, Set<StoryCluster>>();
  const records = state.runs.flatMap((run) => run.candidates.map((candidate) => ({ runId: run.id, candidate })))
    .sort((left, right) => timeFor(left) - timeFor(right));

  // Research documents belong to their explicit event. Indexing their own URL
  // would join unrelated Stories every time they share a pricing page/manual.
  for (const record of records.filter((entry) => entry.candidate.evidenceRelation !== "research-material")) {
    const exactKeys = exactKeysFor(record.candidate);
    const versionKeys = versionKeysFor(record);
    let cluster = exactKeys.map((key) => exactIndex.get(key)).find(Boolean);
    if (!cluster) {
      const versionCandidates = new Set<StoryCluster>();
      for (const key of versionKeys) {
        for (const candidateCluster of versionIndex.get(key) ?? []) versionCandidates.add(candidateCluster);
      }
      cluster = [...versionCandidates].find((candidateCluster) =>
        withinMergeWindow(record, candidateCluster.records.at(-1)!));
    }
    if (!cluster) {
      const nearbyClusters = new Set<StoryCluster>();
      for (const title of recordTitles(record)) {
        for (const token of titleTokens(title)) {
          for (const candidateCluster of titleIndex.get(token) ?? []) nearbyClusters.add(candidateCluster);
        }
      }
      cluster = [...nearbyClusters].find((candidateCluster) => {
        const latest = candidateCluster.records.at(-1)!;
        if (Boolean(record.candidate.technicalArticle) !== Boolean(latest.candidate.technicalArticle)) return false;
        if (!withinMergeWindow(record, latest)) return false;
        return recordTitles(record).some((leftTitle) => candidateCluster.titles.some((rightTitle) =>
          titleSimilarity(leftTitle, rightTitle) >= 0.78));
      });
    }
    if (!cluster) {
      cluster = {
        records: [],
        exactKeys: new Set(),
        versionKeys: new Set(),
        titles: [],
        identityKey: initialIdentityFor(record),
      };
      clusters.push(cluster);
    }
    cluster.records.push(record);
    for (const key of exactKeys) {
      cluster.exactKeys.add(key);
      exactIndex.set(key, cluster);
    }
    for (const key of versionKeys) {
      cluster.versionKeys.add(key);
      const indexed = versionIndex.get(key) ?? new Set<StoryCluster>();
      indexed.add(cluster);
      versionIndex.set(key, indexed);
    }
    const titles = recordTitles(record);
    cluster.titles.push(...titles);
    for (const title of titles) {
      for (const token of titleTokens(title)) {
        const indexed = titleIndex.get(token) ?? new Set<StoryCluster>();
        indexed.add(cluster);
        titleIndex.set(token, indexed);
      }
    }
  }
  for (const record of records.filter((entry) => entry.candidate.evidenceRelation === "research-material")) {
    const owner = exactIndex.get(normalizedUrl(record.candidate.evidenceGroupUrl));
    if (owner) owner.records.push(record);
  }
  return clusters;
};

const roleRank = (candidate: Candidate) => ({
  official: 5,
  research: 4,
  verification: 3,
  discovery: 2,
  community: 1,
})[candidate.sourceRole ?? (isCommunityCandidate(candidate) ? "community" : "discovery")];

const briefingRank = (candidate: Candidate) => ({
  "full-source": 3,
  excerpt: 2,
  title: 1,
})[candidate.briefing?.basis ?? "title"];

const uniqueBy = <T>(items: T[], keyFor: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const commentSamplesIn = (candidate: Candidate) => {
  const bracketed = candidate.excerpt.match(/\[[^\]]{1,80}\]:\s*[\s\S]{20,}?(?=\s+\[[^\]]{1,80}\]:|$)/gu)?.length ?? 0;
  const labeled = candidate.excerpt.match(/社区原句[:：]/gu)?.length ?? 0;
  return Math.max(bracketed, labeled, candidate.author && candidate.excerpt.length >= 80 ? 1 : 0);
};

const trendFor = (records: CandidateRecord[]): StoryTrendView => {
  const communityRecords = records.filter((record) => isCommunityCandidate(record.candidate) && record.candidate.engagement)
    .sort((left, right) => timeFor(left) - timeFor(right));
  const platformCount = new Set(communityRecords.map((record) => record.candidate.sourceName)).size;
  if (!communityRecords.length) return { direction: "unknown", summary: "暂无公开社区热度快照", platformCount: 0 };
  const latest = communityRecords.at(-1)!;
  const latestEngagement = latest.candidate.engagement!;
  const sameDiscussion = communityRecords.filter((record) =>
    normalizedUrl(record.candidate.engagement?.discussionUrl)
      === normalizedUrl(latest.candidate.engagement?.discussionUrl));
  if (sameDiscussion.length < 2) {
    return {
      direction: "steady",
      summary: `当前记录 ${latestEngagement.points ?? 0} 积分、${latestEngagement.comments ?? 0} 条讨论`,
      platformCount,
      latestPoints: latestEngagement.points,
      latestComments: latestEngagement.comments,
    };
  }
  const previous = sameDiscussion.at(-2)!;
  const hours = Math.max(0.25, (timeFor(latest) - timeFor(previous)) / 3_600_000);
  const pointsDelta = Math.max(0, (latestEngagement.points ?? 0) - (previous.candidate.engagement?.points ?? 0));
  const commentsDelta = Math.max(0, (latestEngagement.comments ?? 0) - (previous.candidate.engagement?.comments ?? 0));
  const rate = pointsDelta / hours + commentsDelta * 2 / hours;
  const direction = rate >= 18 ? "rising" : rate >= 2 ? "steady" : "cooling";
  const directionLabel = direction === "rising" ? "仍在升温" : direction === "cooling" ? "增长放缓" : "热度稳定";
  return {
    direction,
    summary: `近 ${Math.round(hours * 10) / 10} 小时新增 ${pointsDelta} 积分、${commentsDelta} 条讨论，${directionLabel}`,
    platformCount,
    latestPoints: latestEngagement.points,
    latestComments: latestEngagement.comments,
    pointsDelta,
    commentsDelta,
    windowHours: Math.round(hours * 10) / 10,
  };
};

const evidenceStrengthFor = (factRecords: CandidateRecord[]) => {
  const domains = new Set(factRecords.map((record) => {
    try { return new URL(record.candidate.canonicalUrl || record.candidate.url).hostname; } catch { return record.candidate.sourceName; }
  }));
  const hasOfficial = factRecords.some((record) => record.candidate.sourceRole === "official");
  const hasFullSource = factRecords.some((record) => record.candidate.briefing?.basis === "full-source");
  if ((hasOfficial && domains.size >= 2) || domains.size >= 3) return "strong" satisfies EvidenceStrength;
  if (hasOfficial || hasFullSource || domains.size >= 2) return "moderate" satisfies EvidenceStrength;
  return "weak" satisfies EvidenceStrength;
};

const briefingBasisFor = (candidate: Candidate) => candidate.briefing?.basis
  ?? (candidate.excerpt.trim() ? "excerpt" : "title");

const explanationRank = (candidate: Candidate) => {
  const explanation = candidate.briefing?.explanation;
  if (!explanation) return 0;
  return explanation.voiceVersion === 2 && explanation.readerBriefZh ? 2 : 1;
};

const explanationFor = (
  records: CandidateRecord[],
  primary: CandidateRecord,
  assignment: ReturnType<typeof assignStory>,
): StoryExplanation => {
  const ordered = [...records].sort((left, right) =>
    explanationRank(right.candidate) - explanationRank(left.candidate)
      || briefingRank(right.candidate) - briefingRank(left.candidate)
      || roleRank(right.candidate) - roleRank(left.candidate));
  const explained = ordered.find((record) => record.candidate.briefing?.explanation);
  const selected = explained ?? ordered[0] ?? primary;
  const detailed = selected.candidate.briefing?.explanation;
  const sourceRecords = uniqueBy(
    records.filter((record) => isFactBearingCandidate(record.candidate)),
    (record) => normalizedUrl(record.candidate.canonicalUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const evidenceRecords = sourceRecords.length ? sourceRecords : uniqueBy(
    records,
    (record) => normalizedUrl(record.candidate.canonicalUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const sources = evidenceRecords.slice(0, 6).map((record) => ({
    signalId: `${record.runId}:${record.candidate.id}`,
    sourceName: record.candidate.sourceName,
    role: record.candidate.sourceRole ?? (isCommunityCandidate(record.candidate) ? "community" : "discovery"),
    basis: briefingBasisFor(record.candidate),
    summary: record.candidate.briefing?.summaryZh
      || record.candidate.excerpt.replace(/\s+/gu, " ").trim().slice(0, 300)
      || record.candidate.title,
    url: record.candidate.canonicalUrl || record.candidate.url,
  }));
  const fallbackOverview = selected.candidate.briefing?.summaryZh
    || primary.candidate.briefing?.summaryZh
    || primary.candidate.excerpt.replace(/\s+/gu, " ").trim().slice(0, 420)
    || primary.candidate.title;
  const fallbackPoints = uniqueBy(
    sources.map((source) => source.summary).filter((summary) => summary && summary !== fallbackOverview),
    (summary) => summary,
  ).slice(0, 4);
  const basis = briefingBasisFor(selected.candidate);
  const voiceReady = detailed?.voiceVersion === 2 && Boolean(detailed.readerBriefZh);
  return {
    status: voiceReady ? "ready" : "partial",
    basis,
    voiceVersion: detailed?.voiceVersion ?? 1,
    readerBrief: detailed?.readerBriefZh || detailed?.whatHappenedZh || fallbackOverview,
    editorNote: detailed?.editorNoteZh,
    whatHappened: detailed?.whatHappenedZh || fallbackOverview,
    keyPoints: detailed?.keyPointsZh.length ? detailed.keyPointsZh : (fallbackPoints.length ? fallbackPoints : [fallbackOverview]),
    whyItMatters: detailed?.whyItMattersZh || assignment.audienceValue,
    affected: detailed?.affectedZh,
    unknowns: detailed?.unknownsZh.length
      ? detailed.unknownsZh
      : basis === "title"
        ? ["当前只有标题级证据，正文细节、数据与实际影响仍未确认。"]
        : ["当前为扫描级摘要；打开后会继续读取来源正文并补齐具体细节。"],
    qualityFlags: detailed?.qualityFlags ?? [],
    sources,
    generatedAt: selected.candidate.briefing?.generatedAt,
  };
};

const modelReleaseTerms = /(?:\b(?:claude|fable|mythos|gpt(?:-[\w.]+)?|astra|gemini|llama|qwen|deepseek|grok|mistral|kimi|glm|ernie|minimax)\b|\bmodel\b|模型)/iu;
const releaseEventTerms = /(?:\b(?:release(?:d|s)?|launch(?:ed|es)?|introduc(?:e|ed|es|ing)|announce(?:d|s)?|available|preview|coming soon|on the way|preparing)\b|发布|推出|上线|预告|即将|模型)/iu;
const launchHeadlineTerms = /(?:\b(?:new generation|release(?:d|s)?|launch(?:ed|es)?|introduc(?:e|ed|es|ing)|announce(?:d|s)?)\b|正式发布|发布|推出|上线)/iu;
const supportingDocumentTerms = /(?:\b(?:safety|system card|pricing|case study|apolog(?:y|ize[sd]?)|reviewed|cut manual fixes)\b|安全|模型卡|定价|致歉|案例)/iu;
const modelIdentityTerms = /\b(?:gpt[\s-]*\d+|astra|(?:claude[\s-]*)?(?:fable|mythos|opus|sonnet|haiku)[\s-]*\d+|gemini[\s-]*\d+|deepseek[\s-]*[rv]?\d+|qwen[\s-]*\d+)\b/iu;
const routineReleaseTerms = /\b(?:nightly|canary|daily|weekly|webinar|(?:co)?workshop|cli|sdk)\b|报名|活动预告/iu;
const isFirstPartyModelSignal = (signal: StorySignalView) => signal.sourceRole === "official"
  && Boolean(firstPartyModelVendorFor(signal))
  && modelReleaseTerms.test(`${signal.title} ${signal.titleZh ?? ""}`)
  && !routineReleaseTerms.test(signal.title)
  && !supportingDocumentTerms.test(signal.title);
const isFirstPartyModelAnnouncement = (signal: StorySignalView) => isFirstPartyModelSignal(signal)
  && launchHeadlineTerms.test(`${signal.title} ${signal.titleZh ?? ""}`);

const dossierTextFor = (records: CandidateRecord[]) => records.flatMap(({ candidate }) => [
  candidate.title,
  candidate.excerpt,
  candidate.briefing?.titleZh,
  candidate.briefing?.summaryZh,
  candidate.briefing?.explanation?.whatHappenedZh,
  candidate.briefing?.explanation?.readerBriefZh,
  ...(candidate.briefing?.explanation?.keyPointsZh ?? []),
  ...(candidate.briefing?.explanation?.unknownsZh ?? []),
]).filter((value): value is string => Boolean(value)).join(" \n ");

const hostnameFor = (value: string | undefined) => {
  try { return value ? new URL(value).hostname.toLocaleLowerCase() : ""; } catch { return ""; }
};

const knownOwnerDomainsFor = (text: string) => {
  const rules: Array<[RegExp, string[]]> = [
    [/(?:anthropic|claude|fable|mythos)/iu, ["anthropic.com", "claude.com"]],
    [/(?:openai|\bgpt(?:-[\w.]+)?\b|\bastra\b)/iu, ["openai.com"]],
    [/(?:google|gemini|deepmind)/iu, ["google.com", "google.dev", "deepmind.google"]],
    [/(?:meta|llama)/iu, ["meta.com"]],
    [/(?:\bxai\b|\bgrok\b)/iu, ["x.ai"]],
    [/(?:mistral)/iu, ["mistral.ai"]],
    [/(?:deepseek)/iu, ["deepseek.com"]],
    [/(?:qwen|alibaba|通义千问)/iu, ["qwen.ai", "qwenlm.ai", "alibabacloud.com"]],
  ];
  return rules.find(([pattern]) => pattern.test(text))?.[1] ?? [];
};

const domainMatches = (hostname: string, domain: string) => hostname === domain || hostname.endsWith(`.${domain}`);

const releaseDossierFor = (
  cluster: StoryCluster,
  records: CandidateRecord[],
  factRecords: CandidateRecord[],
  imageCount: number,
  localImageCount: number,
): ModelReleaseDossier | undefined => {
  const text = dossierTextFor(records);
  const looksLikeRelease = modelReleaseTerms.test(text)
    && (releaseEventTerms.test(text) || cluster.versionKeys.size > 0);
  if (!looksLikeRelease) return undefined;

  const ownerDomains = knownOwnerDomainsFor(text);
  const officialRecords = factRecords.filter(({ candidate }) => candidate.sourceRole === "official");
  const ownerOfficial = officialRecords.some(({ candidate }) => {
    const hostname = hostnameFor(candidate.canonicalUrl || candidate.url);
    return ownerDomains.length ? ownerDomains.some((domain) => domainMatches(hostname, domain)) : true;
  });
  const preview = /(?:\b(?:coming soon|on the way|preparing|not yet (?:released|available))\b|即将|预告|尚未发布|仍在准备)/iu.test(text);
  const released = /(?:\b(?:released|launched|available now|generally available)\b|正式发布|已经发布|现已可用|上线)/iu.test(text);
  const releaseStatus: ModelReleaseDossier["releaseStatus"] = preview && !released
    ? "preview"
    : released
      ? "released"
      : "reported";

  const modelIdMentioned = /(?:\b(?:api\s+)?model\s*(?:id|identifier|snapshot)\b|模型\s*(?:ID|标识|快照))/iu.test(text);
  const lifecycleMentioned = releaseStatus !== "reported"
    || /(?:\b(?:ga|general availability|deprecated|deprecation|retired|sunset|preview)\b|正式版|预览版|弃用|下线|生命周期)/iu.test(text);
  const accessSignals = [
    /(?:\b(?:api|chatgpt|gemini app|ai studio|model studio|vertex ai|bedrock|azure|cloud console)\b|接口|应用端|开发者平台|云平台)/iu,
    /(?:\b(?:available|availability|public beta|private beta|waitlist|rollout|region|countries|accounts?|tiers?)\b|开放范围|灰度|地区|区域|账号门槛|可用范围)/iu,
  ].filter((pattern) => pattern.test(text)).length;
  const specSignals = [
    /(?:\bcontext(?: window)?\b|上下文窗口|上下文长度)/iu,
    /(?:\b(?:maximum|max) output\b|最大输出)/iu,
    /(?:\b(?:parameters?|weights?)\b|参数量|权重)/iu,
    /(?:\b(?:multimodal|vision|audio|image input|video input|tool use|function calling|thinking|reasoning|fim)\b|多模态|视觉|音频|图像输入|视频输入|工具调用|思考模式|推理模式)/iu,
  ].filter((pattern) => pattern.test(text)).length;
  const pricingMentioned = /(?:\b(?:pricing|price|costs?)\b|定价|价格|费用)/iu.test(text);
  const pricingExplicitlyUnknown = /(?:\b(?:pricing|price)\b[^.。]{0,30}\b(?:unknown|unannounced|not (?:yet )?(?:announced|available))\b|(?:尚未|还未|未)(?:公布|说明|提供)?[^。；]{0,12}(?:定价|价格|费用)|(?:定价|价格|费用)[^。；]{0,12}(?:尚未|还未|未知|待定))/iu.test(text);
  const exactPricing = pricingMentioned && !pricingExplicitlyUnknown && /(?:[$€£¥]\s*\d|\d+(?:\.\d+)?\s*(?:dollars?|usd|美元|元|\/\s*(?:m|million|百万)|per\s+(?:million|token)))/iu.test(text);
  const pricingKnownMention = pricingMentioned && !pricingExplicitlyUnknown;
  const benchmarkMentioned = /(?:\b(?:benchmark|leaderboard|evaluation|evals?|swe-bench|gpqa|mmlu|aime|artificial analysis|arena)\b|跑分|评测|基准|排行榜)/iu.test(text);
  const benchmarkMeasured = benchmarkMentioned && /(?:\b\d+(?:\.\d+)?\s*%|(?:score|index|得分|指数)\s*[:：]?\s*\d)/iu.test(text);
  const safetyMentioned = /(?:\b(?:system card|model card|safety report|risk assessment|responsible ai|technical report)\b|系统卡|模型卡|安全报告|风险评估|技术报告)/iu.test(text);
  const safetyDocument = records.some(({ candidate }) => /(?:system[-_/ ]?card|model[-_/ ]?card|safety|technical[-_/ ]?report|系统卡|模型卡|安全报告|技术报告)/iu.test(
    `${candidate.title} ${candidate.canonicalUrl || candidate.url}`,
  ));

  const facets: ModelReleaseDossier["facets"] = [
    {
      id: "official",
      label: "官方介绍",
      status: ownerOfficial ? "ready" : officialRecords.length ? "partial" : "missing",
      detail: ownerOfficial
        ? "已找到模型方一手发布页。"
        : officialRecords.length
          ? "目前只有平台方或相关官方资料，仍缺模型方原文。"
          : "尚未找到模型方的一手发布说明。",
    },
    {
      id: "identity",
      label: "模型身份与生命周期",
      status: modelIdMentioned && lifecycleMentioned ? "ready" : modelIdMentioned || lifecycleMentioned ? "partial" : "missing",
      detail: modelIdMentioned && lifecycleMentioned
        ? "已记录模型 ID 或快照，并区分预告、上线或弃用状态。"
        : modelIdMentioned
          ? "已找到模型标识，仍需确认预告、正式上线或弃用状态。"
          : lifecycleMentioned
            ? "已确认发布阶段，但仍缺可核对的模型 ID 或快照。"
            : "尚未确认模型 ID、具体快照与生命周期状态。",
    },
    {
      id: "access",
      label: "接入与可用范围",
      status: accessSignals >= 2 ? "ready" : accessSignals === 1 ? "partial" : "missing",
      detail: accessSignals >= 2
        ? "已识别接入渠道及至少一项开放范围、地域或账号条件。"
        : accessSignals === 1
          ? "已找到接入渠道线索，仍需核对地域、灰度范围或账号门槛。"
          : "尚未确认是在 App、API 或云平台上线，也未确认可用范围。",
    },
    {
      id: "specs",
      label: "模型规格",
      status: specSignals >= 2 ? "ready" : specSignals === 1 ? "partial" : "missing",
      detail: specSignals >= 2
        ? `已识别 ${specSignals} 类规格信息。`
        : specSignals === 1
          ? "已找到一项规格线索，仍需补齐上下文、输出、模态或工具能力。"
          : "尚未找到上下文、最大输出、模态、参数或工具能力等规格。",
    },
    {
      id: "pricing",
      label: "价格信息",
      status: exactPricing ? "ready" : pricingKnownMention ? "partial" : "missing",
      detail: exactPricing
        ? "已找到带数值的价格信息。"
        : pricingKnownMention
          ? "来源提到价格，但还没有可核对的完整数值。"
          : "尚未找到官方定价或可核对的价格信息。",
    },
    {
      id: "benchmarks",
      label: "跑分与评测",
      status: benchmarkMeasured ? "ready" : benchmarkMentioned ? "partial" : "missing",
      detail: benchmarkMeasured
        ? "已找到带数值的跑分或评测记录，引用时仍需标明测试方与配置。"
        : benchmarkMentioned
          ? "已找到评测线索，但缺少可核对的成绩或配置。"
          : "尚未找到可核对的跑分、榜单或第三方评测。",
    },
    {
      id: "safety",
      label: "安全与模型卡",
      status: safetyDocument ? "ready" : safetyMentioned ? "partial" : "missing",
      detail: safetyDocument
        ? "已找到系统卡、模型卡、安全报告或适用的技术报告。"
        : safetyMentioned
          ? "来源提到安全或模型卡，但仍缺可单独核对的正式文档。"
          : "尚未找到适用的系统卡、模型卡或安全说明。",
    },
    {
      id: "images",
      label: "可用图片",
      status: localImageCount >= 2 ? "ready" : imageCount > 0 ? "partial" : "missing",
      detail: localImageCount >= 2
        ? `已有 ${localImageCount} 张本地缓存图片。`
        : imageCount > 0
          ? `发现 ${imageCount} 张来源图片，但还需缓存并检查使用权。`
          : "尚未找到与事件直接相关的合格图片。",
    },
  ];
  const readyCount = facets.filter((facet) => facet.status === "ready").length;
  const missingLabels = facets.filter((facet) => facet.status === "missing").map((facet) => facet.label);
  const incompleteLabels = facets.filter((facet) => facet.status !== "ready").map((facet) => facet.label);
  const nextAction = incompleteLabels.length
    ? releaseStatus === "preview"
      ? `继续跟踪正式发布，并补齐${incompleteLabels.join("、")}。`
      : `优先补齐${incompleteLabels.join("、")}，再决定文章深度。`
    : "资料面已齐，可以进入详细介绍或横向比较。";
  return { releaseStatus, readyCount, totalCount: facets.length, facets, missingLabels, nextAction };
};

const storyFromCluster = (cluster: StoryCluster, now: string): StoryView => {
  const allRecords = [...cluster.records].sort((left, right) => timeFor(right) - timeFor(left));
  const storyVendor = [...allRecords]
    .filter((record) => record.candidate.evidenceRelation !== "research-material")
    .sort((left, right) => roleRank(right.candidate) - roleRank(left.candidate))
    .map((record) => modelResearchVendorFor(recordTitles(record).join(" "))
      ?? firstPartyModelVendorFor({
        sourceName: record.candidate.sourceName,
        url: record.candidate.canonicalUrl || record.candidate.url,
      }))
    .find(Boolean);
  // Historical evidence runs remain recoverable, but a first-party document
  // owned by another known model vendor cannot participate in this Story.
  const records = allRecords.filter((record) => {
    if (record.candidate.evidenceRelation !== "research-material" || !storyVendor) return true;
    const materialVendor = firstPartyModelVendorFor({
      sourceName: record.candidate.sourceName,
      url: record.candidate.canonicalUrl || record.candidate.url,
    });
    return !materialVendor || materialVendor === storyVendor;
  });
  const uniqueSignals = uniqueBy(records, (record) => `${record.runId}:${record.candidate.id}`);
  const factRecords = uniqueBy(
    records.filter((record) => isFactBearingCandidate(record.candidate)),
    (record) => normalizedUrl(record.candidate.canonicalUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const communityRecords = uniqueBy(
    records.filter((record) => isCommunityCandidate(record.candidate)),
    (record) => normalizedUrl(record.candidate.engagement?.discussionUrl || record.candidate.url) || record.candidate.sourceName,
  );
  const eventRecords = records.filter((record) => record.candidate.evidenceRelation !== "research-material");
  const primary = [...eventRecords].sort((left, right) =>
    roleRank(right.candidate) - roleRank(left.candidate)
      || briefingRank(right.candidate) - briefingRank(left.candidate)
      || right.candidate.recommendationScore - left.candidate.recommendationScore)[0]!;
  const bestBriefing = [...eventRecords].sort((left, right) =>
    briefingRank(right.candidate) - briefingRank(left.candidate)
      || roleRank(right.candidate) - roleRank(left.candidate))[0]!.candidate.briefing;
  const firstPartyLaunch = storyVendor
    ? [...eventRecords]
      .filter((record) => {
        const titles = recordTitles(record).join(" ");
        return record.candidate.sourceRole === "official"
          && firstPartyModelVendorFor({
            sourceName: record.candidate.sourceName,
            url: record.candidate.canonicalUrl || record.candidate.url,
          }) === storyVendor
          && modelReleaseTerms.test(titles)
          && launchHeadlineTerms.test(titles);
      })
      .sort((left, right) => {
        const headlineScore = (record: CandidateRecord) => {
          const titles = recordTitles(record).join(" ");
          return (supportingDocumentTerms.test(titles) ? 0 : 10)
            + briefingRank(record.candidate)
            + record.candidate.recommendationScore / 100;
        };
        return headlineScore(right) - headlineScore(left);
      })[0]
    : undefined;
  const headlinePrimary = firstPartyLaunch ?? primary;
  const technicalArticle = primary.candidate.technicalArticle;
  const bestInsight = records.find((record) => record.candidate.communityInsight)?.candidate.communityInsight;
  const images = uniqueEligibleEditorialImages(
    uniqueBy(records.flatMap((record) => record.candidate.images), (image) => normalizedUrl(image.url) || image.id),
  ).slice(0, 48);
  const localImages = images.filter(isLocalImageFileReady);
  const publishReadyImages = localImages.filter((image) => isNeutralImagePublishReady(image, now));
  const factualPublishedTimes = eventRecords
    .filter((record) => isFactBearingCandidate(record.candidate))
    .map((record) => Date.parse(record.candidate.publishedAt))
    .filter(Number.isFinite);
  const publishedTimes = factualPublishedTimes.length
    ? factualPublishedTimes
    : eventRecords.map((record) => Date.parse(record.candidate.publishedAt)).filter(Number.isFinite);
  const fetchedTimes = records.map(timeFor).filter(Number.isFinite);
  const fallbackTime = Date.parse(now);
  // `publishedAt` is the event's original factual publication time. Later
  // observations belong in `lastSeenAt`; letting them advance this timestamp
  // silently resurrects old Stories and lets sitemap build times distort rank.
  const publishedAt = new Date(publishedTimes.length ? Math.min(...publishedTimes) : fallbackTime).toISOString();
  const firstSeenAt = new Date(fetchedTimes.length ? Math.min(...fetchedTimes) : fallbackTime).toISOString();
  const lastSeenAt = new Date(fetchedTimes.length ? Math.max(...fetchedTimes) : fallbackTime).toISOString();
  const ageHours = Math.max(0, (Date.parse(now) - Date.parse(publishedAt)) / 3_600_000);
  const evidenceStrength = evidenceStrengthFor(factRecords);
  const communitySampleCount = Math.max(0, ...records.filter((record) => isCommunityCandidate(record.candidate)).map((record) => commentSamplesIn(record.candidate)));
  const protectedStory = records.some((record) => record.candidate.selected
    || record.candidate.status === "drafted"
    || record.candidate.userFeedback === "interested"
    || record.candidate.userFeedback === "published");
  const title = headlinePrimary.candidate.briefing?.titleZh
    || (headlinePrimary === primary ? bestBriefing?.titleZh : undefined)
    || headlinePrimary.candidate.title;
  const assignment = assignStory({
    technicalArticle,
    title,
    ageHours,
    evidenceStrength,
    factSourceCount: factRecords.length,
    communitySourceCount: communityRecords.length,
    communitySampleCount,
    longestExcerpt: Math.max(...records.map((record) => record.candidate.excerpt.length)),
    protected: protectedStory,
    now,
  });
  const id = `story_${createHash("sha1").update(cluster.identityKey).digest("hex").slice(0, 16)}`;
  const releaseDossier = technicalArticle ? undefined : releaseDossierFor(cluster, records, factRecords, images.length, localImages.length);
  const sourceCount = uniqueBy(records, (record) => `${record.candidate.sourceName}:${normalizedUrl(record.candidate.url)}`).length;
  const topicIds = [...new Set(records.flatMap((record) => record.candidate.topicIds ?? []))] as CollectionTopicId[];
  const signals: StorySignalView[] = uniqueSignals.map((record) => ({
    runId: record.runId,
    candidateId: record.candidate.id,
    sourceName: record.candidate.sourceName,
    sourceRole: record.candidate.sourceRole,
    sourceType: record.candidate.sourceType,
    title: record.candidate.title,
    titleZh: record.candidate.briefing?.titleZh,
    summaryZh: record.candidate.briefing?.summaryZh,
    briefingBasis: record.candidate.briefing?.basis,
    url: record.candidate.canonicalUrl || record.candidate.url,
    discussionUrl: record.candidate.engagement?.discussionUrl,
    author: record.candidate.author,
    publishedAt: record.candidate.publishedAt,
    publicationDateKnown: record.candidate.publicationDateKnown,
    fetchedAt: record.candidate.fetchedAt,
    isCommunity: isCommunityCandidate(record.candidate),
    factBearing: isFactBearingCandidate(record.candidate),
    linkedSource: hasLinkedCommunitySource(record.candidate),
    engagement: record.candidate.engagement ? {
      points: record.candidate.engagement.points,
      comments: record.candidate.engagement.comments,
    } : undefined,
    feedback: record.candidate.userFeedback,
    drafted: record.candidate.status === "drafted",
  }));
  return {
    id,
    title,
    originalTitle: headlinePrimary.candidate.title,
    technicalArticle,
    publicationDateKnown: headlinePrimary.candidate.publicationDateKnown,
    summary: bestBriefing?.summaryZh || primary.candidate.excerpt.slice(0, 240) || "等待补充来源摘要",
    whyImportant: assignment.audienceValue,
    communitySummary: bestInsight?.summaryZh,
    communityFocus: bestInsight?.focusZh ?? [],
    disagreement: bestInsight?.disagreementZh,
    explanation: explanationFor(records, primary, assignment),
    releaseDossier,
    topicIds,
    firstSeenAt,
    lastSeenAt,
    publishedAt,
    ageHours,
    recommendationScore: Math.max(...records.map((record) => record.candidate.recommendationScore)),
    evidenceStrength,
    sourceCount,
    factSourceCount: factRecords.length,
    communitySourceCount: communityRecords.length,
    communitySampleCount,
    images,
    imageCount: images.length,
    localImageCount: localImages.length,
    publishReadyImageCount: publishReadyImages.length,
    rightsReviewImageCount: localImages.length - publishReadyImages.length,
    selected: records.some((record) => record.candidate.selected),
    drafted: records.some((record) => record.candidate.status === "drafted"),
    published: records.some((record) => record.candidate.userFeedback === "published"),
    ignored: records.some((record) => record.candidate.userFeedback === "not_interested"),
    assignment,
    trend: trendFor(records),
    signals,
  };
};

const storyRank = (story: StoryView, focused = true) => {
  const evidence = story.evidenceStrength === "strong" ? 18 : story.evidenceStrength === "moderate" ? 9 : 0;
  const trend = story.trend.direction === "rising" ? 8 : story.trend.direction === "steady" ? 3 : 0;
  const images = Math.min(2, story.localImageCount ?? 0);
  const recency = Math.max(0, 16 - story.ageHours / 3);
  const release = story.releaseDossier
    ? story.releaseDossier.releaseStatus === "released" ? 14 : story.releaseDossier.releaseStatus === "preview" ? 10 : 4
    : 0;
  return story.recommendationScore + evidence + trend + images + recency + release
    + (story.technicalArticle?.priorityAdjustment ?? 0)
    + (story.preferenceAdjustment ?? 0)
    + (focused && story.opportunity ? opportunityPriority(story.opportunity) : 0);
};

export const buildStories = (state: WorkflowState, now = new Date().toISOString()) => {
  const cutoff = Date.parse(now) - 30 * 86_400_000;
  const feedback = state.candidateFeedback.filter((entry) => Date.parse(entry.createdAt) >= cutoff && Date.parse(entry.createdAt) <= Date.parse(now));
  const candidates = [...new Map(state.runs.flatMap((run) => run.candidates).map((candidate) => [candidate.id, candidate])).values()];
  const preferences = new Map(personalizeCandidates(candidates, feedback, state.settings.personalizationEnabled).map((candidate) => [candidate.id, candidate]));
  const focused = state.settings.recommendationMode !== "balanced";
  return clustersFor(state).map((cluster) => {
    const story = storyFromCluster(cluster, now);
    const opportunity = assessEditorialOpportunity(story.originalTitle, story.summary);
    if (story.releaseDossier?.releaseStatus === "released"
      && modelIdentityTerms.test(`${story.originalTitle} ${story.title}`)
      && !routineReleaseTerms.test(story.originalTitle)
      && story.signals.some(isFirstPartyModelAnnouncement)) {
      opportunity.lane = "important";
      opportunity.label = "重要发布";
      opportunity.reason = "有厂商发布来源，优先核对能力、价格与可用范围的变化。";
    }
    if (story.releaseDossier?.releaseStatus === "preview"
      && story.releaseDossier.facets.some((facet) => facet.id === "official" && facet.status === "ready")
      && !routineReleaseTerms.test(story.originalTitle)
      && story.signals.some((signal) => isFirstPartyModelSignal(signal)
        && /\b(?:preview|coming soon|on the way|preparing)\b|预告|即将/iu.test(`${signal.title} ${signal.titleZh ?? ""}`))) {
      opportunity.lane = "important";
      opportunity.label = "官方预告";
      opportunity.reason = "厂商已发布预告，正式上线时间和可用范围仍需核对。";
    }
    const strongest = story.signals.map((signal) => preferences.get(signal.candidateId)).filter((candidate) => candidate !== undefined)
      .sort((left, right) => Math.abs(right.personalizationScore ?? 0) - Math.abs(left.personalizationScore ?? 0))[0];
    const topicMatch = state.settings.editorialProfileEnabled !== false
      && state.editorialSystem.profile.preferredTopicIds.some((topic) => story.topicIds.includes(topic));
    return { ...story, opportunity, preferenceAdjustment: (strongest?.personalizationScore ?? 0) + (topicMatch ? 2 : 0),
      preferenceReasons: [...(strongest?.personalizationReasons ?? []), ...(topicMatch ? ["符合长期关注主题 +2"] : [])] };
  }).sort((left, right) => storyRank(right, focused) - storyRank(left, focused));
};

const diagnosticsFor = (sources: SourceConfig[]) => sources
  .filter((source) => source.selected && source.enabled && source.health && source.health !== "healthy")
  .map((source) => ({
    sourceId: source.id,
    name: source.name,
    kind: source.kind,
    role: source.role,
    status: source.health ?? "unknown",
    detail: source.lastHealthDetail || "来源需要检查",
    consecutiveFailures: source.consecutiveFailures ?? 0,
  }));

const standardTodayWindowHours = 48;
const confirmedModelLaunchCatchupHours = 7 * 24;

const isWithinTodayWindow = (story: StoryView) => {
  if (story.ageHours <= standardTodayWindowHours) return true;
  const officialFacet = story.releaseDossier?.facets.find((facet) => facet.id === "official");
  const hasKnownFirstPartyOwner = story.signals.some((signal) => signal.factBearing
    && signal.sourceRole === "official"
    && Boolean(firstPartyModelVendorFor({
      sourceName: signal.sourceName,
      url: signal.url,
    })));
  return story.ageHours <= confirmedModelLaunchCatchupHours
    && story.releaseDossier?.releaseStatus === "released"
    && officialFacet?.status === "ready"
    && hasKnownFirstPartyOwner
    && story.evidenceStrength !== "weak";
};

export const buildTodayView = (state: WorkflowState, now = new Date().toISOString()): TodayView => {
  const recommendationTarget = 8;
  const stories = buildStories(state, now);
  // Visibility is separate from evidence readiness: an indexed official
  // announcement deserves attention while its original page is being read.
  const releaseHighlights = stories.filter((story) => story.ageHours <= confirmedModelLaunchCatchupHours
    && !story.ignored && !story.published && story.releaseDossier
    && modelIdentityTerms.test(`${story.originalTitle} ${story.title}`)
    && !routineReleaseTerms.test(`${story.originalTitle} ${story.title}`)
    && story.signals.some(isFirstPartyModelAnnouncement))
    .sort((left, right) => Number(right.releaseDossier?.releaseStatus === "released")
      - Number(left.releaseDossier?.releaseStatus === "released") || left.ageHours - right.ageHours)
    .slice(0, 4);
  const knowledge = stories.filter((story) => story.technicalArticle && !story.ignored && !story.published)
    .sort((left, right) => Number(right.selected) - Number(left.selected)
      || (right.technicalArticle?.priorityAdjustment ?? 0) - (left.technicalArticle?.priorityAdjustment ?? 0)
      || Date.parse(right.firstSeenAt) - Date.parse(left.firstSeenAt));
  const active = stories.filter((story) => !story.technicalArticle && isWithinTodayWindow(story) && !story.ignored && !story.published);
  const focused = state.settings.recommendationMode !== "balanced";
  const eligible = (story: StoryView) => !focused || story.opportunity?.lane !== "routine" || story.selected
    || story.signals.some((signal) => signal.feedback === "interested");
  const ready = interleaveBySource(
    active.filter((story) => story.assignment.canDraft && !story.drafted && eligible(story)),
    (story) => story.signals.find((signal) => !signal.isCommunity)?.sourceName
      ?? story.signals[0]?.sourceName
      ?? "未知来源",
  );
  const watching = active.filter((story) => story.assignment.mode === "watch" && eligible(story)).slice(0, 6);
  const backlog = interleaveBySource(
    stories.filter((story) => !story.technicalArticle && !isWithinTodayWindow(story)
      && story.ageHours > standardTodayWindowHours
      && story.ageHours <= 7 * 24
      && !story.ignored
      && !story.published
      && !story.drafted
      && story.assignment.canDraft && eligible(story)),
    (story) => story.signals.find((signal) => !signal.isCommunity)?.sourceName
      ?? story.signals[0]?.sourceName
      ?? "未知来源",
  ).slice(0, 6);
  const drafts = state.drafts;
  const autoUsableMaterials = state.materials.filter((material) => isNeutralImagePublishReady(material, now));
  const sourceImageReadyCount = active.filter((story) => (story.localImageCount ?? 0) >= 2).length;
  const publishReadyStoryCount = active.filter((story) => (story.publishReadyImageCount ?? 0) >= 2).length;
  const interesting = focused ? ready.filter((story) => story.opportunity?.lane === "interesting").slice(0, 2) : [];
  const news = focused ? ready.filter((story) => story.opportunity?.lane !== "interesting") : ready;
  const visibleNews = news.slice(0, recommendationTarget - interesting.length);
  const visibleRecommendations = [...visibleNews, ...interesting];
  const diagnosticStories = stories.filter((story) => !story.technicalArticle && story.ageHours <= 7 * 24);
  const dropCounts = diagnosticStories.reduce((counts, story) => {
    if (story.ignored || story.published) counts["ignored-or-published"] += 1;
    else if (!isWithinTodayWindow(story)) counts["outside-window"] += 1;
    else if (story.drafted) counts["already-drafted"] += 1;
    else if (!story.assignment.canDraft) counts["evidence-blocked"] += 1;
    else if (!eligible(story)) counts["routine-update"] += 1;
    return counts;
  }, {
    "outside-window": 0,
    "already-drafted": 0,
    "evidence-blocked": 0,
    "ignored-or-published": 0,
    "routine-update": 0,
  });
  const recommendationDropReasons = [
    { code: "outside-window" as const, label: "超过常规 48 小时或模型发布 7 天窗口", count: dropCounts["outside-window"] },
    { code: "already-drafted" as const, label: "已经进入成稿流程", count: dropCounts["already-drafted"] },
    { code: "evidence-blocked" as const, label: "证据不足，暂留观察", count: dropCounts["evidence-blocked"] },
    { code: "ignored-or-published" as const, label: "已忽略或已发布", count: dropCounts["ignored-or-published"] },
    { code: "routine-update" as const, label: "常规动态，保留在全部候选", count: dropCounts["routine-update"] },
    {
      code: "below-display-limit" as const,
      label: "证据合格，本次精选未展示",
      count: Math.max(0, ready.length - visibleRecommendations.length),
    },
  ].filter((reason) => reason.count > 0);
  return {
    generatedAt: now,
    releaseHighlights,
    selectionMode: focused ? "focused" : "balanced",
    mustReads: visibleNews.slice(0, 3),
    knowledge,
    secondary: visibleNews.slice(3),
    interesting,
    backlog,
    watching,
    diagnostics: diagnosticsFor(state.sources),
    funnel: {
      candidateCount: state.runs.reduce((total, run) => total + run.candidates.length, 0),
      storyCount: stories.length,
      recommendationTarget,
      visibleRecommendationCount: visibleRecommendations.length,
      recommendationShortageCount: Math.max(0, recommendationTarget - visibleRecommendations.length),
      recommendationDropReasons,
      selectedCount: state.runs.reduce((total, run) => total + run.candidates.filter((candidate) => candidate.selected).length, 0),
      draftCount: drafts.length,
      syncedCount: drafts.filter((draft) => Boolean(draft.wechatDraft) || draft.status === "filled").length,
      publishedCount: drafts.filter((draft) => draft.publicationConfirmations
        ? hasCurrentPublication(draft)
        : draft.status === "published" && Boolean(draft.publicationConfirmedAt)).length,
      feedbackCount: state.candidateFeedback.length,
      materialLibraryTotal: state.materials.length,
      autoUsableMaterialCount: autoUsableMaterials.length,
      rightsReviewMaterialCount: state.materials.length - autoUsableMaterials.length,
      reusableMaterialCount: autoUsableMaterials.length,
    },
    coverage: {
      activeStoryCount: active.length,
      risingCount: active.filter((story) => story.trend.direction === "rising").length,
      sourceImageReadyCount,
      publishReadyStoryCount,
      imageReadyCount: sourceImageReadyCount,
      strongEvidenceCount: active.filter((story) => story.evidenceStrength === "strong").length,
      topicIds: [...new Set(active.flatMap((story) => story.topicIds))] as CollectionTopicId[],
    },
  };
};

export const storyById = (state: WorkflowState, storyId: string, now = new Date().toISOString()) =>
  buildStories(state, now).find((story) => story.id === storyId);
