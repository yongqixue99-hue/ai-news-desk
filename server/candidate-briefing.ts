import type {
  Candidate,
  CandidateBriefing,
  CandidateBriefingBasis,
  CandidateCommunityInsight,
} from "./types.js";
import { assessWritingQuality } from "./writing-quality.js";

export interface CandidateBriefingEvidenceInput {
  candidateId: string;
  basis: CandidateBriefingBasis;
  text: string;
  community?: boolean;
}

export interface CandidateBriefingParseOptions {
  generatedAt: string;
  providerId: string;
}

export interface ParsedCandidateBriefing {
  candidateId: string;
  briefing: CandidateBriefing;
  communityInsight?: CandidateCommunityInsight;
}

interface RenderedBriefingItem {
  candidateId?: unknown;
  titleZh?: unknown;
  summaryZh?: unknown;
  communitySummaryZh?: unknown;
  communityFocusZh?: unknown;
  communityDisagreementZh?: unknown;
  whatHappenedZh?: unknown;
  readerBriefZh?: unknown;
  keyPointsZh?: unknown;
  whyItMattersZh?: unknown;
  affectedZh?: unknown;
  editorNoteZh?: unknown;
  unknownsZh?: unknown;
}

const communityCandidate = (candidate: Candidate) => {
  const identity = `${candidate.sourceRole || ""} ${candidate.sourceType} ${candidate.sourceName}`.toLocaleLowerCase();
  return candidate.sourceRole === "community"
    || /community|hackernews|hacker news|reddit|zhihu|知乎|twitter|\bx\b|threads|youtube|tiktok|instagram|last30days/u.test(identity)
    || Boolean(candidate.engagement?.discussionUrl);
};

export const buildCandidateBriefingEvidence = (
  candidates: Candidate[],
  extractedSourceText: ReadonlyMap<string, string> = new Map(),
): CandidateBriefingEvidenceInput[] => candidates.map((candidate) => {
  const extracted = extractedSourceText.get(candidate.id)?.replace(/\s+/g, " ").trim() ?? "";
  const excerpt = candidate.excerpt.replace(/\s+/g, " ").trim();
  const community = communityCandidate(candidate);
  const basis: CandidateBriefingBasis = extracted.length >= 80
    ? "full-source"
    : excerpt
      ? "excerpt"
      : "title";
  const sourceText = basis === "full-source" ? extracted : basis === "excerpt" ? excerpt : candidate.title;
  return {
    candidateId: candidate.id,
    basis,
    community,
    text: [
      `内容类型：${community ? "社区讨论线索" : "新闻或官方来源"}`,
      `原标题：${candidate.title}`,
      `来源：${candidate.sourceName}`,
      `发布时间：${candidate.publishedAt}`,
      `${basis === "full-source" ? "关联来源正文" : basis === "excerpt" ? community ? "社区讨论摘录" : "来源摘要" : "可用证据仅有标题"}：${sourceText.slice(0, community ? 4_800 : 2_400)}`,
      ...(community && basis === "full-source" && excerpt
        ? [`社区讨论摘录（只能用于归纳社区观点，不能当作已核验事实）：${excerpt.slice(0, 2_400)}`]
        : []),
    ].join("\n"),
  };
});

const withoutCodeFence = (rendered: string) => rendered
  .trim()
  .replace(/^```(?:json)?\s*/i, "")
  .replace(/\s*```$/, "");

const cleanText = (value: unknown, label: string, maxLength: number) => {
  if (typeof value !== "string") throw new Error(`${label}必须是字符串`);
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned.length > maxLength) throw new Error(`${label}长度不正确`);
  if (!/[\u3400-\u9fff]/u.test(cleaned)) throw new Error(`${label}必须包含中文`);
  return cleaned;
};

const optionalChineseText = (value: unknown, label: string, maxLength: number) => {
  if (value === undefined || value === null || value === "") return undefined;
  return cleanText(value, label, maxLength);
};

const communityFocus = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 3)
    .map((item, index) => optionalChineseText(item, `社区关注点 ${index + 1}`, 100))
    .filter((item): item is string => Boolean(item));
};

const chineseTextList = (value: unknown, label: string, maxItems: number, maxLength: number) => {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value
    .slice(0, maxItems)
    .map((item, index) => cleanText(item, `${label} ${index + 1}`, maxLength));
};

const readerCopyQualityFlags = (
  titleZh: string,
  readerBriefZh: string,
  editorNoteZh: string | undefined,
  unknownsZh: string[],
) => {
  const assessment = assessWritingQuality({
    title: titleZh,
    paragraphs: [readerBriefZh, ...(editorNoteZh ? [editorNoteZh] : []), ...unknownsZh],
  });
  const flags = assessment.diagnostics.map((diagnostic) => diagnostic.id);
  const combined = `${titleZh}\n${readerBriefZh}\n${editorNoteZh || ""}\n${unknownsZh.join("\n")}`;
  const explicitChecks: Array<[string, RegExp]> = [
    ["ra-binary-contrast-shell", /(?:不是|并非).{1,90}而是|不在于.{1,90}而在于|不只是|不仅.{1,50}(?:还|更)/u],
    ["ra-fake-insight-marker", /真正|其实|本质上|核心在于|关键在于|说白了|归根结底|更重要的是/u],
    ["robot-evidence-shell", /现有证据显示|(?:当前)?(?:输入|证据文本)(?:中|里|未|没有|只|显示)|根据原标题|直接关系.{0,24}(?:体验|发展)|意义重大|值得关注/u],
    ["robot-calculated-date", /(?:后次日|翌日)|\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日后/u],
  ];
  for (const [id, pattern] of explicitChecks) if (pattern.test(combined)) flags.push(id);
  return [...new Set(flags)];
};

const explanationFrom = (item: RenderedBriefingItem, titleZh: string) => {
  const hasExplanation = [
    item.whatHappenedZh,
    item.readerBriefZh,
    item.keyPointsZh,
    item.whyItMattersZh,
    item.affectedZh,
    item.editorNoteZh,
    item.unknownsZh,
  ].some((value) => value !== undefined);
  if (!hasExplanation) return undefined;
  const keyPointsZh = chineseTextList(item.keyPointsZh, "讲解要点", 4, 180);
  if (!keyPointsZh.length) throw new Error("讲解要点至少需要一项");
  const readerBriefZh = cleanText(item.readerBriefZh, "编辑速读", 420);
  const editorNoteZh = optionalChineseText(item.editorNoteZh, "编辑备注", 180);
  const whyItMattersZh = optionalChineseText(item.whyItMattersZh, "实际影响", 360);
  const affectedZh = optionalChineseText(item.affectedZh, "影响对象", 220);
  const unknownsZh = chineseTextList(item.unknownsZh, "未知项", 2, 180);
  const qualityFlags = readerCopyQualityFlags(titleZh, readerBriefZh, editorNoteZh, unknownsZh);
  return {
    voiceVersion: 2 as const,
    whatHappenedZh: cleanText(item.whatHappenedZh, "事件讲解", 600),
    readerBriefZh,
    keyPointsZh,
    ...(whyItMattersZh ? { whyItMattersZh } : {}),
    ...(affectedZh ? { affectedZh } : {}),
    editorNoteZh,
    unknownsZh,
    ...(qualityFlags.length ? { qualityFlags } : {}),
  };
};

export const parseCandidateBriefings = (
  rendered: string,
  evidenceInputs: CandidateBriefingEvidenceInput[],
  options: CandidateBriefingParseOptions,
): ParsedCandidateBriefing[] => {
  const payload = JSON.parse(withoutCodeFence(rendered)) as { items?: RenderedBriefingItem[] };
  if (!payload || !Array.isArray(payload.items)) throw new Error("中文摘要结果缺少 items");

  const expected = new Map(evidenceInputs.map((input) => [input.candidateId, input]));
  if (expected.size !== evidenceInputs.length) throw new Error("中文摘要输入包含重复候选 ID");
  if (payload.items.length !== expected.size) throw new Error("中文摘要结果数量与候选数量不一致");

  const byId = new Map<string, ParsedCandidateBriefing>();
  for (const item of payload.items) {
    const candidateId = typeof item.candidateId === "string" ? item.candidateId.trim() : "";
    const evidence = expected.get(candidateId);
    if (!evidence) throw new Error(`中文摘要返回了未知候选：${candidateId || "空 ID"}`);
    if (byId.has(candidateId)) throw new Error(`中文摘要重复返回候选：${candidateId}`);
    const communitySummaryZh = optionalChineseText(item.communitySummaryZh, "社区摘要", 220);
    const focusZh = communityFocus(item.communityFocusZh);
    const disagreementZh = optionalChineseText(item.communityDisagreementZh, "社区分歧", 160);
    if (evidence.community && (!communitySummaryZh || !focusZh.length)) {
      throw new Error(`社区速读缺少讨论摘要或关注点：${candidateId}`);
    }
    const titleZh = cleanText(item.titleZh, "中文标题", 80);
    const explanation = explanationFrom(item, titleZh);
    byId.set(candidateId, {
      candidateId,
      briefing: {
        titleZh,
        summaryZh: cleanText(item.summaryZh, "中文摘要", 220),
        basis: evidence.basis,
        generatedAt: options.generatedAt,
        providerId: options.providerId,
        ...(explanation ? { explanation } : {}),
      },
      ...(communitySummaryZh ? {
        communityInsight: {
          summaryZh: communitySummaryZh,
          focusZh,
          disagreementZh,
          basis: "discussion-excerpt" as const,
          generatedAt: options.generatedAt,
          providerId: options.providerId,
        },
      } : {}),
    });
  }

  return evidenceInputs.map((input) => {
    const briefing = byId.get(input.candidateId);
    if (!briefing) throw new Error(`中文摘要漏掉候选：${input.candidateId}`);
    return briefing;
  });
};
