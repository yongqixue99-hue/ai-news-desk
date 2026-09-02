import { evaluateDraftPackageQuality } from "./editorial-quality-desk.js";
import type { AssignmentMode, ContentPackage, EditorialIntent } from "./product-types.js";
import type { ArticleDraft, DraftFactClaim, SourceImage } from "./types.js";

export type EditorialGoldenCategory = "news" | "community" | "source" | "visual" | "writing";

export interface EditorialGoldenCase {
  id: string;
  category: EditorialGoldenCategory;
  label: string;
  intent: EditorialIntent;
  title: string;
  paragraphs: string[];
  facts?: string[];
  paragraphFactIds?: string[][];
  communityDiscovery?: boolean;
  discussionSampleCount?: number;
  discussionBranchCount?: number;
  missingEvidence?: boolean;
  sourceMaterial?: boolean;
  sourceText?: string;
  localAssetCount?: number;
  insertedImageCount?: number;
  expectedReady: boolean;
  expectedBlockerIds: string[];
  expectedWarningIds?: string[];
}

const articleUrl = "https://github.com/SenteLabsAI/OpenExecutive";
const discussionUrl = "https://news.ycombinator.com/item?id=1";

/**
 * Manually labelled product failures and acceptable outputs. These are not
 * model-authored expectations: each literal describes the reader-visible
 * behavior the editor should accept or stop.
 */
export const editorialGoldenCases: EditorialGoldenCase[] = [
  {
    id: "news-source-first-open-executive",
    category: "news",
    label: "社区发现的项目直接讲产品事实",
    intent: "news",
    communityDiscovery: true,
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面，对外提供一个统一入口。"],
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "news-community-headline",
    category: "news",
    label: "社区平台不能成为新闻标题",
    intent: "news",
    communityDiscovery: true,
    title: "Open Executive 因 Hacker News 讨论再受关注",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    expectedReady: false,
    expectedBlockerIds: ["news-discovery-headline"],
  },
  {
    id: "news-community-lead",
    category: "news",
    label: "社区热度不能冒充新闻事件",
    intent: "news",
    communityDiscovery: true,
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 因社区讨论重新受到注意。项目把八个智能体放进同一套管理界面。"],
    expectedReady: false,
    expectedBlockerIds: ["news-discovery-lead"],
  },
  {
    id: "news-comment-corpus",
    category: "news",
    label: "新闻素材包不携带评论语料",
    intent: "news",
    communityDiscovery: true,
    discussionSampleCount: 1,
    discussionBranchCount: 1,
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    expectedReady: false,
    expectedBlockerIds: ["news-comment-corpus"],
  },
  {
    id: "news-missing-paragraph-evidence",
    category: "news",
    label: "新闻每段都要能回到来源",
    intent: "news",
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    missingEvidence: true,
    expectedReady: false,
    expectedBlockerIds: ["paragraph-evidence-missing"],
  },
  {
    id: "visual-two-originals-kept",
    category: "visual",
    label: "图片丰富来源至少插入两张原图",
    intent: "news",
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    localAssetCount: 2,
    insertedImageCount: 2,
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "news-later-discovery-attribution",
    category: "news",
    label: "发现渠道可以在事实之后有限说明",
    intent: "news",
    communityDiscovery: true,
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: [
      "Open Executive 把八个专职智能体放进同一套管理界面。",
      "这条项目链接随后出现在 Hacker News，社区链接只用于说明发现路径。",
    ],
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "writing-generic-title-warning",
    category: "writing",
    label: "抽象 AI 标题进入待改警告而非伪装合格",
    intent: "news",
    title: "AI 时代迎来重大变革",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    expectedReady: true,
    expectedBlockerIds: [],
    expectedWarningIds: ["writing-generic-title"],
  },
  {
    id: "writing-unnamed-authority",
    category: "writing",
    label: "匿名专家不能支撑结论",
    intent: "news",
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["有专家认为，Open Executive 会改变所有公司的管理方式。"],
    expectedReady: false,
    expectedBlockerIds: ["writing-unnamed-authority"],
  },
  {
    id: "writing-chat-residue",
    category: "writing",
    label: "正文不能残留聊天机器人话术",
    intent: "news",
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。如果你想了解更多，请告诉我。"],
    expectedReady: false,
    expectedBlockerIds: ["writing-chat-residue"],
  },
  {
    id: "community-limited-labelled",
    category: "community",
    label: "一条评论明确标成有限样本",
    intent: "community",
    discussionSampleCount: 1,
    discussionBranchCount: 1,
    title: "开发者讨论 AI 与管理岗位",
    paragraphs: [
      "Open Executive 把八个专职智能体放进同一套管理界面。",
      "有限样本中，一名用户提出，管理岗位也包含大量可自动化的协调工作。",
    ],
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "community-limited-unlabelled",
    category: "community",
    label: "少量评论不得省略样本边界",
    intent: "community",
    discussionSampleCount: 1,
    discussionBranchCount: 1,
    title: "开发者讨论 AI 与管理岗位",
    paragraphs: [
      "Open Executive 把八个专职智能体放进同一套管理界面。",
      "有用户认为，管理岗位也包含大量可自动化的协调工作。",
    ],
    expectedReady: false,
    expectedBlockerIds: ["community-limited-sample-label"],
  },
  {
    id: "community-five-false-consensus",
    category: "community",
    label: "五条评论不能概括社区共识",
    intent: "community",
    discussionSampleCount: 5,
    discussionBranchCount: 3,
    title: "开发者讨论 AI 与管理岗位",
    paragraphs: [
      "Open Executive 把八个专职智能体放进同一套管理界面。",
      "社区普遍认为，管理岗位比开发岗位更容易被自动化。",
    ],
    expectedReady: false,
    expectedBlockerIds: ["community-false-consensus"],
  },
  {
    id: "community-fifteen-five-branches",
    category: "community",
    label: "十五条五分支样本可以概括反复主题",
    intent: "community",
    discussionSampleCount: 15,
    discussionBranchCount: 5,
    title: "开发者讨论 AI 与管理岗位",
    paragraphs: [
      "Open Executive 把八个专职智能体放进同一套管理界面。",
      "讨论中反复出现的看法是，协调工作比创造性判断更容易自动化。",
    ],
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "community-fifteen-three-branches",
    category: "community",
    label: "评论数量够但分支不足仍不能说反复出现",
    intent: "community",
    discussionSampleCount: 15,
    discussionBranchCount: 3,
    title: "开发者讨论 AI 与管理岗位",
    paragraphs: [
      "Open Executive 把八个专职智能体放进同一套管理界面。",
      "讨论中反复出现的看法是，协调工作比创造性判断更容易自动化。",
    ],
    expectedReady: false,
    expectedBlockerIds: ["community-false-consensus"],
  },
  {
    id: "community-missing-evidence",
    category: "community",
    label: "社区稿的事实和观点段都要保存来源",
    intent: "community",
    discussionSampleCount: 5,
    discussionBranchCount: 3,
    title: "开发者讨论 AI 与管理岗位",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    missingEvidence: true,
    expectedReady: false,
    expectedBlockerIds: ["paragraph-evidence-missing"],
  },
  {
    id: "source-self-post-preserved",
    category: "source",
    label: "社区主帖可以生成带来源声明的私人工作副本",
    intent: "source",
    sourceMaterial: true,
    sourceText: "I built a local AI reader for my own newsletter.",
    title: "我做了一个本地 AI 阅读器",
    paragraphs: ["我为自己的 newsletter 做了一个本地 AI 阅读器。"],
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "source-top-comments-leak",
    category: "source",
    label: "原文工作副本不能混入 Top Comments",
    intent: "source",
    sourceMaterial: true,
    sourceText: "I built a local AI reader for my own newsletter.",
    title: "我做了一个本地 AI 阅读器",
    paragraphs: ["我做了一个本地 AI 阅读器。--- Top Comments --- 有人说这个项目没有价值。"],
    expectedReady: false,
    expectedBlockerIds: ["source-comment-leak"],
  },
  {
    id: "source-missing-snapshot",
    category: "source",
    label: "没有冻结原文就不能生成工作副本",
    intent: "source",
    sourceMaterial: false,
    title: "我做了一个本地 AI 阅读器",
    paragraphs: ["我为自己的 newsletter 做了一个本地 AI 阅读器。"],
    expectedReady: false,
    expectedBlockerIds: ["source-material-missing"],
  },
  {
    id: "visual-one-of-two-dropped",
    category: "visual",
    label: "少插一张相关原图进入待完善而不是丢弃草稿",
    intent: "news",
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
    localAssetCount: 2,
    insertedImageCount: 1,
    expectedReady: true,
    expectedBlockerIds: [],
    expectedWarningIds: ["image-coverage-missing"],
  },
  {
    id: "news-short-but-complete",
    category: "news",
    label: "短简讯覆盖全部事实时不按字数误伤",
    intent: "news",
    title: "公司发布七十亿参数本地模型，首批面向企业测试",
    facts: [
      "公司于九月二日发布新的本地模型。",
      "模型参数量为七十亿。",
      "开发者必须先申请测试资格。",
      "首批测试面向企业客户。",
      "个人用户开放时间尚未公布。",
    ],
    paragraphs: [
      "公司九月二日发布七十亿参数的本地模型。",
      "开发者必须先申请资格，首批测试面向企业客户。",
      "个人用户开放时间尚未公布。",
    ],
    paragraphFactIds: [["fact-1", "fact-2"], ["fact-3", "fact-4"], ["fact-5"]],
    expectedReady: true,
    expectedBlockerIds: [],
  },
  {
    id: "news-long-but-undercovered",
    category: "news",
    label: "长稿反复铺陈少数事实仍提示内容缺口",
    intent: "news",
    title: "公司发布七十亿参数本地模型",
    facts: [
      "公司于九月二日发布新的本地模型。",
      "模型参数量为七十亿。",
      "开发者必须先申请测试资格。",
      "首批测试面向企业客户。",
      "个人用户开放时间尚未公布。",
    ],
    paragraphs: [
      "公司在九月二日正式介绍这款新的本地模型，并在说明材料中多次展示模型已经发布、可以进入后续测试流程。发布信息占据了说明材料的大部分篇幅。",
      "这款模型的参数量为七十亿，官方介绍围绕七十亿参数反复解释产品定位和模型规模，但正文没有进一步交代申请条件、首批开放对象和仍未公布的信息。",
    ],
    paragraphFactIds: [["fact-1"], ["fact-2"]],
    expectedReady: true,
    expectedBlockerIds: [],
    expectedWarningIds: ["brief-underdeveloped"],
  },
];

const modeFor = (intent: EditorialIntent): Exclude<AssignmentMode, "watch" | "skip"> =>
  intent === "source" ? "curate" : intent === "community" ? "community" : "brief";

const sourceImage = (index: number): SourceImage => ({
  id: `golden-image-${index}`,
  url: `${articleUrl}/raw/main/golden-${index}.png`,
  localPath: `/managed/golden-${index}.png`,
  publicPath: `/media/golden-${index}.png`,
  caption: `项目原图 ${index}`,
  attribution: "GitHub",
  sourceUrl: articleUrl,
  selected: true,
  rights: "check-required",
  editorialPriority: 1,
  editorialOrigin: "article-image",
});

const materialize = (golden: EditorialGoldenCase): { contentPackage: ContentPackage; draft: ArticleDraft } => {
  const hasCommunity = golden.intent === "community" || golden.intent === "source" || golden.communityDiscovery;
  const sources: ContentPackage["sources"] = [
    ...(golden.intent === "source" ? [] : [{
      signalId: "signal-official",
      label: "GitHub",
      url: articleUrl,
      role: "official" as const,
      basis: "full-source" as const,
      publishedAt: "2026-08-27T00:00:00.000Z",
      isCommunity: false,
    }]),
    ...(hasCommunity ? [{
      signalId: "signal-community",
      label: "Hacker News",
      url: discussionUrl,
      role: "community" as const,
      basis: golden.intent === "source" ? "full-source" as const : "title" as const,
      publishedAt: "2026-08-27T00:00:00.000Z",
      isCommunity: true,
    }] : []),
  ];
  const discussionSamples: ContentPackage["discussionSamples"] = Array.from(
    { length: golden.discussionSampleCount ?? 0 },
    (_value, index) => ({
      id: `sample-${index}`,
      signalId: "signal-community",
      platform: "Hacker News",
      author: `author-${index}`,
      permalink: `${discussionUrl}#${index}`,
      originalText: `Community sample ${index}`,
      kind: "opinion" as const,
      branchId: `branch-${index % Math.max(1, golden.discussionBranchCount ?? 1)}`,
    }),
  );
  const images = Array.from({ length: golden.localAssetCount ?? 0 }, (_value, index) => sourceImage(index));
  const assets: ContentPackage["assets"] = images.map((image, index) => ({
    id: `asset-${index}`,
    sourceImageId: image.id,
    sourceImage: image,
    url: image.url,
    caption: image.caption,
    attribution: image.attribution,
    sourceUrl: image.sourceUrl,
    rights: image.rights,
    rightsDecision: "blocked",
    rightsReason: "发布前确认图片权利",
    role: "product",
    origin: "source",
    editorialPriority: 1,
    editorialOrigin: "article-image",
    localReady: true,
  }));
  const sourceMaterials: ContentPackage["sourceMaterials"] = golden.sourceMaterial ? [{
    signalId: "signal-community",
    sourceKind: "community-post",
    sourceLabel: "Hacker News",
    url: discussionUrl,
    author: "founder",
    originalTitle: golden.title,
    originalText: golden.sourceText ?? golden.paragraphs.join("\n"),
    originalLanguage: "en",
    basis: "community-post",
    capturedAt: "2026-09-01T00:00:00.000Z",
    truncated: false,
    rightsNotice: "仅供私人编辑，发布前确认翻译与转载范围。",
  }] : undefined;
  const factTexts = golden.facts ?? [golden.paragraphs[0] ?? golden.title];
  const contentPackage: ContentPackage = {
    id: `package-${golden.id}`,
    storyId: `story-${golden.id}`,
    mode: modeFor(golden.intent),
    intent: golden.intent,
    title: golden.title,
    createdAt: "2026-09-01T00:00:00.000Z",
    facts: golden.intent === "source" ? [] : factTexts.map((text, index) => ({
      id: `fact-${index + 1}`,
      text,
      status: "supported" as const,
      sourceSignalIds: ["signal-official"],
      sourceUrls: [articleUrl],
    })),
    communityFocus: [],
    discussionSamples,
    sourceSignalIds: sources.map((source) => source.signalId),
    sources,
    sourceMaterials,
    imageIds: images.map((image) => image.id),
    assets,
    uncertainties: [],
    suggestedAngles: [],
    communityEvidenceLabel: golden.intent === "community" ? "按样本门槛整理" : "社区只用于发现选题",
    status: "ready",
    blockers: [],
  };
  const factClaims: DraftFactClaim[] = golden.missingEvidence || golden.intent === "source"
    ? []
    : golden.paragraphs.map((paragraph, index) => ({
      id: `claim-${index}`,
      claim: paragraph,
      factIds: golden.paragraphFactIds?.[index] ?? (index === 0 ? ["fact-1"] : []),
      status: index > 0 && golden.intent === "community" ? "unverified" : "full-source",
      sourceUrls: [index > 0 && (golden.intent === "community" || /Hacker News|Reddit|V2EX|知乎|社区/u.test(paragraph))
        ? discussionUrl
        : articleUrl],
      capturedAt: "2026-09-01T00:00:00.000Z",
    }));
  const draft: ArticleDraft = {
    id: `draft-${golden.id}`,
    runId: "run-golden",
    candidateId: golden.id,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    status: "editing",
    title: golden.title,
    draftStrategy: modeFor(golden.intent),
    paragraphs: golden.paragraphs,
    take: "",
    sources: sources.map((source) => ({
      label: source.label,
      url: source.url,
      kind: source.isCommunity ? "supporting" as const : "primary" as const,
      verified: !source.isCommunity,
    })),
    factClaims,
    uncertainties: [],
    images: images.slice(0, golden.insertedImageCount ?? 0).map((image, index) => ({
      id: `placement-${index}`,
      image,
      afterParagraph: Math.min(index, Math.max(0, golden.paragraphs.length - 1)),
      caption: image.caption,
    })),
    community: "",
    topics: [],
    provenance: {
      originalUrl: sources[0]?.url ?? discussionUrl,
      generatedBy: "editorial-golden-set",
      storyId: contentPackage.storyId,
      contentPackageId: contentPackage.id,
    },
    ...(golden.sourceMaterial ? {
      sourceMaterial: {
        kind: "community" as const,
        mode: "source" as const,
        sourceUrl: discussionUrl,
        sourceLabel: "Hacker News",
        author: "founder",
        originalLanguage: "en",
        rights: "check-required" as const,
        requiresEditorialReview: true as const,
      },
    } : {}),
  };
  return { contentPackage, draft };
};

export interface EditorialGoldenSetFailure {
  id: string;
  label: string;
  expectedReady: boolean;
  actualReady: boolean;
  expectedBlockerIds: string[];
  actualBlockerIds: string[];
  expectedWarningIds: string[];
  actualWarningIds: string[];
}

export interface EditorialGoldenSetReport {
  version: "editorial-golden/v1";
  total: number;
  passed: number;
  failed: number;
  failures: EditorialGoldenSetFailure[];
  categoryCounts: Record<EditorialGoldenCategory, number>;
}

const sameIds = (left: string[], right: string[]) =>
  JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());

export const runEditorialGoldenSet = (): EditorialGoldenSetReport => {
  const failures: EditorialGoldenSetFailure[] = [];
  for (const golden of editorialGoldenCases) {
    const report = evaluateDraftPackageQuality(materialize(golden));
    const actualBlockerIds = report.blockers.map((issue) => issue.id);
    const actualWarningIds = report.warnings.map((issue) => issue.id);
    const expectedWarningIds = golden.expectedWarningIds ?? [];
    if (
      report.ready !== golden.expectedReady
      || !sameIds(actualBlockerIds, golden.expectedBlockerIds)
      || !sameIds(actualWarningIds, expectedWarningIds)
    ) {
      failures.push({
        id: golden.id,
        label: golden.label,
        expectedReady: golden.expectedReady,
        actualReady: report.ready,
        expectedBlockerIds: golden.expectedBlockerIds,
        actualBlockerIds,
        expectedWarningIds,
        actualWarningIds,
      });
    }
  }
  const categoryCounts = editorialGoldenCases.reduce((counts, golden) => ({
    ...counts,
    [golden.category]: counts[golden.category] + 1,
  }), { news: 0, community: 0, source: 0, visual: 0, writing: 0 });
  return {
    version: "editorial-golden/v1",
    total: editorialGoldenCases.length,
    passed: editorialGoldenCases.length - failures.length,
    failed: failures.length,
    failures,
    categoryCounts,
  };
};
