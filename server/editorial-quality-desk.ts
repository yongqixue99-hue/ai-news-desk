import type { ContentPackage } from "./product-types.js";
import type {
  ArticleDraft,
  DraftCompletenessDimension,
  DraftFactClaim,
  DraftFactCoverage,
  DraftQualityWarning,
} from "./types.js";
import { uniqueEligibleEditorialImages } from "./editorial-image-policy.js";
import { isCommunityDiscoveryFraming } from "./editorial-source-policy.js";
import { assessWritingQuality } from "./writing-quality.js";

export interface EditorialQualityIssue {
  id: string;
  message: string;
  blockId: "title" | `paragraph:${number}` | "evidence" | "images" | "source-material";
  factCoverage?: DraftFactCoverage;
  missingDimensions?: DraftCompletenessDimension[];
}

export interface EditorialDraftQualityReport {
  ready: boolean;
  blockers: EditorialQualityIssue[];
  warnings: EditorialQualityIssue[];
}

export interface EditorialDraftQualityInput {
  contentPackage: ContentPackage;
  draft: ArticleDraft;
}

const qualityWarningForIssue = (issue: EditorialQualityIssue): DraftQualityWarning => ({
  id: issue.id,
  message: issue.message,
  blockId: issue.blockId,
  dimension: issue.blockId === "images"
    ? "images-rights"
    : issue.id === "brief-underdeveloped"
      ? "content-completeness"
      : issue.id.startsWith("writing-")
        ? "writing-quality"
        : "fact-safety",
  ...(issue.factCoverage ? { factCoverage: structuredClone(issue.factCoverage) } : {}),
  ...(issue.missingDimensions?.length ? { missingDimensions: [...issue.missingDimensions] } : {}),
});

export const draftQualityWarningsFor = (
  report: EditorialDraftQualityReport,
): DraftQualityWarning[] => report.warnings.map(qualityWarningForIssue);

export const draftQualityFindingsFor = (
  report: EditorialDraftQualityReport,
): DraftQualityWarning[] => [...report.blockers, ...report.warnings]
  .map(qualityWarningForIssue)
  .filter((finding, index, all) => all.findIndex((entry) =>
    entry.id === finding.id && entry.blockId === finding.blockId) === index);

const normalizedSourceUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    parsed.pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    return parsed.toString();
  } catch {
    return value.trim();
  }
};

/**
 * Rebinds fact ids added by an exact repair patch to the immutable package
 * sources. It never infers a fact id from prose and rejects ids outside the
 * package, so a client edit cannot manufacture evidence metadata.
 */
export const reconcileDraftFactEvidence = (
  contentPackage: Pick<ContentPackage, "facts" | "sources">,
  factClaims: DraftFactClaim[],
): DraftFactClaim[] => {
  const factById = new Map(contentPackage.facts.map((fact) => [fact.id, fact]));
  const sourceBySignalId = new Map(contentPackage.sources.map((source) => [source.signalId, source]));
  const sourceByUrl = new Map(contentPackage.sources.map((source) => [normalizedSourceUrl(source.url), source]));
  return factClaims.map((claim) => {
    if (!claim.factIds?.length) return structuredClone(claim);
    const facts = claim.factIds.map((factId) => {
      const fact = factById.get(factId);
      if (!fact) throw new Error(`草稿引用了素材包之外的事实：${factId}`);
      return fact;
    });
    const sourceUrls = [...new Set([
      ...(claim.sourceUrls ?? (claim.sourceUrl ? [claim.sourceUrl] : [])),
      ...facts.flatMap((fact) => [
        ...(fact.sourceUrls ?? []),
        ...fact.sourceSignalIds.flatMap((signalId) => {
          const source = sourceBySignalId.get(signalId);
          return source ? [source.url] : [];
        }),
      ]),
    ])];
    const labels = [...new Set(sourceUrls.flatMap((url) => {
      const source = sourceByUrl.get(normalizedSourceUrl(url));
      return source ? [source.label] : [];
    }))];
    const status = facts.some((fact) => fact.status === "unverified" || fact.status === "conflicted")
      ? "unverified" as const
      : facts.some((fact) => fact.status === "partially-supported")
        ? "excerpt-only" as const
        : sourceUrls.length >= 2
          ? "cross-confirmed" as const
          : "full-source" as const;
    return {
      ...structuredClone(claim),
      status,
      sourceUrl: sourceUrls[0],
      sourceUrls,
      sourceLabel: labels.join("；") || claim.sourceLabel,
    };
  });
};

const completenessDimensionForFact = (text: string): DraftCompletenessDimension => {
  if (/尚未|仍未|未公开|未知|限制|仅限|不包括|并非|暂未|例外|截止目前/iu.test(text)) return "limitations";
  if (/罚款|处罚|后果|影响|营收|成本|风险|受影响|面向.{0,8}(?:用户|消费者|开发者|企业)/iu.test(text)) return "impact";
  if (/义务|规定|规则|门槛|月活|超过|生效|要求|必须|不得|包括|机制|流程|标准|条件/iu.test(text)) return "mechanism";
  return "event";
};

const factCoverageFor = (
  contentPackage: ContentPackage,
  draft: ArticleDraft,
): { coverage: DraftFactCoverage; missingDimensions: DraftCompletenessDimension[] } => {
  const supportedFacts = contentPackage.facts.filter((claim) =>
    claim.status === "supported" || claim.status === "partially-supported");
  const supportedIds = new Set(supportedFacts.map((claim) => claim.id));
  const mappedIds = new Set((draft.factClaims ?? [])
    .flatMap((claim) => claim.factIds ?? [])
    .filter((factId) => supportedIds.has(factId)));
  const usedFactIds = supportedFacts.filter((claim) => mappedIds.has(claim.id)).map((claim) => claim.id);
  const unusedFactIds = supportedFacts.filter((claim) => !mappedIds.has(claim.id)).map((claim) => claim.id);
  const requiredDimensions = new Set(supportedFacts.map((claim) => completenessDimensionForFact(claim.text)));
  const usedDimensions = new Set(supportedFacts
    .filter((claim) => mappedIds.has(claim.id))
    .map((claim) => completenessDimensionForFact(claim.text)));
  const dimensionOrder: DraftCompletenessDimension[] = ["event", "mechanism", "impact", "limitations"];
  return {
    coverage: {
      usedFactIds,
      unusedFactIds,
      supportedFactCount: supportedFacts.length,
      ratio: supportedFacts.length ? Number((usedFactIds.length / supportedFacts.length).toFixed(2)) : 1,
    },
    missingDimensions: dimensionOrder.filter((dimension) =>
      requiredDimensions.has(dimension) && !usedDimensions.has(dimension)),
  };
};

const completenessDimensionLabels: Record<DraftCompletenessDimension, string> = {
  event: "事件",
  mechanism: "规则或机制",
  impact: "影响或后果",
  limitations: "限制或未知",
};

const consensusLanguagePattern = /(?:社区|评论区|讨论中|用户|开发者)?(?:普遍|多数|大多|一致)(?:认为|觉得|认同|支持)|形成(?:了)?共识|大家都|反复出现|多次出现/iu;
const communityObservationPattern = /(?:社区|评论区|讨论中|评论者|用户|开发者).{0,20}(?:认为|觉得|提出|表示|指出|分享|反对|支持)/iu;
const limitedSampleLabelPattern = /有限样本|少量样本|目前只看到|当前只看到|仅(?:有|看到).{0,8}(?:条|个|名|份)|只有.{0,8}(?:条|个|名|份)/iu;
const workflowCopyPattern = /(?:这份|本次|当前)?(?:输入资料|输入内容|输入里|证据文本|素材包)|讨论串标题|当前样本|Top Comment|供编辑|后续编辑|发布前(?:应|需|需要)|事实定稿|模型返回|任务数据/iu;

/**
 * DraftDesk's deterministic final gate. It compares the generated draft with
 * the immutable ContentPackage before the draft can enter the editor.
 */
export const evaluateDraftPackageQuality = ({
  contentPackage,
  draft,
}: EditorialDraftQualityInput): EditorialDraftQualityReport => {
  const blockers: EditorialQualityIssue[] = [];
  const warnings: EditorialQualityIssue[] = [];
  const discoveredViaCommunity = contentPackage.sources.some((source) => source.isCommunity)
    && contentPackage.sources.some((source) => !source.isCommunity);
  const communitySourceUrls = new Set(contentPackage.sources
    .filter((source) => source.isCommunity)
    .map((source) => source.url));

  if (contentPackage.intent === "news" && discoveredViaCommunity && isCommunityDiscoveryFraming(draft.title)) {
    blockers.push({
      id: "news-discovery-headline",
      blockId: "title",
      message: "社区只是发现渠道，新闻标题必须直接说明项目、产品或公司事实。",
    });
  }
  const firstSentence = draft.paragraphs[0]?.split(/(?<=[。！？!?])/u)[0]?.trim() ?? "";
  if (contentPackage.intent === "news" && discoveredViaCommunity && isCommunityDiscoveryFraming(firstSentence)) {
    blockers.push({
      id: "news-discovery-lead",
      blockId: "paragraph:0",
      message: "社区讨论不能充当新闻事件，首句必须先交代来源支持的主体和动作。",
    });
  }
  if (contentPackage.intent === "news" && contentPackage.discussionSamples.length > 0) {
    blockers.push({
      id: "news-comment-corpus",
      blockId: "evidence",
      message: "新闻素材包不能携带评论语料；社区只保留为发现来源。",
    });
  }
  const discoveryFactClaim = contentPackage.intent === "news" && discoveredViaCommunity
    && !isCommunityDiscoveryFraming(firstSentence)
    ? (draft.factClaims ?? []).find((claim) => {
      if (!isCommunityDiscoveryFraming(claim.claim)) return false;
      const claimUrls = claim.sourceUrls?.length ? claim.sourceUrls : claim.sourceUrl ? [claim.sourceUrl] : [];
      return !claimUrls.length || claimUrls.some((url) => !communitySourceUrls.has(url));
    })
    : undefined;
  if (discoveryFactClaim) {
    blockers.push({
      id: "news-discovery-claim",
      blockId: "evidence",
      message: "事实账本只能保存事件事实，不能把社区发现过程写成事实。",
    });
  }
  if (contentPackage.intent === "news" || contentPackage.intent === "community") {
    const claims = draft.factClaims ?? [];
    const everyParagraphHasEvidence = claims.length >= draft.paragraphs.length
      && draft.paragraphs.every((_paragraph, index) => Boolean(claims[index]?.sourceUrls?.length || claims[index]?.sourceUrl));
    if (!everyParagraphHasEvidence) {
      blockers.push({
        id: "paragraph-evidence-missing",
        blockId: "evidence",
        message: "新闻正文的每一段都必须保存可回指的来源链接。",
      });
    }
  }
  const supportedFactCount = contentPackage.facts.filter((claim) =>
    claim.status === "supported" || claim.status === "partially-supported").length;
  const bodyCharacterCount = draft.paragraphs.join("").replace(/\s/gu, "").length;
  const completeness = factCoverageFor(contentPackage, draft);
  if (
    contentPackage.intent === "news"
    && contentPackage.mode === "brief"
    && draft.draftStrategy === "brief"
    && supportedFactCount >= 5
    && (completeness.coverage.ratio < 0.8 || completeness.missingDimensions.length > 0)
  ) {
    const missingText = completeness.missingDimensions.length
      ? `，还缺少${completeness.missingDimensions.map((dimension) => completenessDimensionLabels[dimension]).join("、")}`
      : "";
    warnings.push({
      id: "brief-underdeveloped",
      blockId: "evidence",
      message: `素材包有 ${supportedFactCount} 条正文级事实，正文明确覆盖 ${completeness.coverage.usedFactIds.length} 条（${Math.round(completeness.coverage.ratio * 100)}%）${missingText}；当前正文 ${bodyCharacterCount} 字，可只用未覆盖事实做定向补写。`,
      factCoverage: completeness.coverage,
      missingDimensions: completeness.missingDimensions,
    });
  }
  if (contentPackage.intent === "source" && (!contentPackage.sourceMaterials?.length || !draft.sourceMaterial)) {
    blockers.push({
      id: "source-material-missing",
      blockId: "source-material",
      message: "原文工作副本必须同时保留冻结原文和草稿来源声明。",
    });
  }
  if (contentPackage.intent === "source" && draft.paragraphs.some((paragraph) => /Top Comments|热门评论|高赞评论|---\s*(?:Comments?|评论)/iu.test(paragraph))) {
    blockers.push({
      id: "source-comment-leak",
      blockId: "source-material",
      message: "原文工作副本只能处理作者正文，不能混入缓存评论或热评。",
    });
  }
  if (contentPackage.intent === "community") {
    const branchCount = new Set(contentPackage.discussionSamples.map((sample) => sample.branchId).filter(Boolean)).size;
    const consensusParagraph = draft.paragraphs.findIndex((paragraph) => consensusLanguagePattern.test(paragraph));
    if (consensusParagraph >= 0 && (contentPackage.discussionSamples.length < 15 || branchCount < 5)) {
      blockers.push({
        id: "community-false-consensus",
        blockId: `paragraph:${consensusParagraph}`,
        message: "社区样本不足 15 条或未覆盖 5 个分支，不能声称多数、共识或反复出现。",
      });
    }
    const unlabeledLimitedSample = contentPackage.discussionSamples.length < 5
      ? draft.paragraphs.findIndex((paragraph) => communityObservationPattern.test(paragraph) && !limitedSampleLabelPattern.test(paragraph))
      : -1;
    if (unlabeledLimitedSample >= 0 && consensusParagraph < 0) {
      blockers.push({
        id: "community-limited-sample-label",
        blockId: `paragraph:${unlabeledLimitedSample}`,
        message: "少于 5 条有效评论时，观点必须明确写成有限样本，不能省略样本边界。",
      });
    }
  }
  const relevantLocalAssetCount = uniqueEligibleEditorialImages(contentPackage.assets
    .filter((asset) => asset.localReady && asset.role !== "decorative")
    .map((asset) => asset.sourceImage)).length;
  const expectedInsertedImages = Math.min(2, relevantLocalAssetCount);
  const insertedImageCount = draft.images.filter((placement) => placement.afterParagraph >= 0).length;
  if (expectedInsertedImages > 0 && insertedImageCount < expectedInsertedImages) {
    warnings.push({
      id: "image-coverage-missing",
      blockId: "images",
      message: `素材包已有 ${relevantLocalAssetCount} 张相关原图，私人草稿至少应插入 ${expectedInsertedImages} 张。`,
    });
  }
  const workflowParagraph = contentPackage.intent === "source"
    ? -1
    : draft.paragraphs.findIndex((paragraph) => workflowCopyPattern.test(paragraph));
  if (workflowParagraph >= 0) {
    blockers.push({
      id: "workflow-copy-leak",
      blockId: `paragraph:${workflowParagraph}`,
      message: "正文出现了素材处理或模型工作语言，不能交给普通读者。",
    });
  }
  const writingAssessment = assessWritingQuality({
    title: draft.title,
    paragraphs: draft.paragraphs,
    take: draft.take,
  });
  for (const diagnostic of writingAssessment.diagnostics) {
    const issue: EditorialQualityIssue = {
      id: `writing-${diagnostic.id}`,
      blockId: diagnostic.blockId === "title"
        ? "title"
        : diagnostic.blockId?.startsWith("paragraph:")
          ? diagnostic.blockId as `paragraph:${number}`
          : "evidence",
      message: diagnostic.message,
    };
    if (diagnostic.severity === "error") blockers.push(issue);
    else warnings.push(issue);
  }

  return { ready: blockers.length === 0, blockers, warnings };
};
