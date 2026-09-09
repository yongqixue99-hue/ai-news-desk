import assert from "node:assert/strict";
import test from "node:test";
import {
  draftQualityWarningsFor,
  draftQualityFindingsFor,
  evaluateDraftPackageQuality,
  reconcileDraftFactEvidence,
  frozenFactSourceUrls,
} from "./editorial-quality-desk.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft } from "./types.js";

const contentPackage = (overrides: Partial<ContentPackage> = {}): ContentPackage => ({
  id: "package-golden",
  storyId: "story-golden",
  mode: "brief",
  intent: "news",
  title: "Open Executive",
  createdAt: "2026-09-01T00:00:00.000Z",
  facts: [{
    id: "fact-1",
    text: "Open Executive 由八个专职智能体组成。",
    status: "supported",
    sourceSignalIds: ["signal-github"],
    sourceUrls: ["https://github.com/example/open-executive"],
  }],
  communityFocus: [],
  discussionSamples: [],
  sourceSignalIds: ["signal-github", "signal-hn"],
  sources: [
    {
      signalId: "signal-github",
      label: "GitHub",
      url: "https://github.com/example/open-executive",
      role: "official",
      basis: "full-source",
      publishedAt: "2026-08-27T00:00:00.000Z",
      isCommunity: false,
    },
    {
      signalId: "signal-hn",
      label: "Hacker News",
      url: "https://news.ycombinator.com/item?id=1",
      role: "community",
      basis: "title",
      publishedAt: "2026-08-27T00:00:00.000Z",
      isCommunity: true,
    },
  ],
  imageIds: [],
  assets: [],
  uncertainties: [],
  suggestedAngles: [],
  communityEvidenceLabel: "社区只用于发现选题",
  status: "ready",
  blockers: [],
  ...overrides,
});

const draft = (overrides: Partial<ArticleDraft> = {}): ArticleDraft => ({
  id: "draft-golden",
  runId: "run-golden",
  candidateId: "candidate-golden",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  status: "editing",
  title: "Open Executive 用八个智能体组成虚拟高管团队",
  draftStrategy: "brief",
  paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面，对外提供一个统一入口。"],
  take: "",
  sources: [{ label: "GitHub", url: "https://github.com/example/open-executive", kind: "primary", verified: true }],
  factClaims: [{
    id: "claim-1",
    claim: "Open Executive 把八个专职智能体放进同一套管理界面，对外提供一个统一入口。",
    status: "full-source",
    sourceUrls: ["https://github.com/example/open-executive"],
    capturedAt: "2026-09-01T00:00:00.000Z",
  }],
  uncertainties: [],
  images: [],
  community: "",
  topics: [],
  provenance: {
    originalUrl: "https://github.com/example/open-executive",
    generatedBy: "golden-test",
    storyId: "story-golden",
    contentPackageId: "package-golden",
  },
  ...overrides,
});

const asset = (id: string): ContentPackage["assets"][number] => ({
  id: `asset-${id}`,
  sourceImageId: `image-${id}`,
  sourceImage: {
    id: `image-${id}`,
    url: `https://github.com/example/open-executive/raw/main/${id}.png`,
    localPath: `/managed/${id}.png`,
    publicPath: `/media/${id}.png`,
    caption: `项目截图 ${id}`,
    attribution: "GitHub",
    sourceUrl: "https://github.com/example/open-executive",
    selected: true,
    rights: "check-required",
    allowedPlatforms: [],
    entityTags: ["Open Executive"],
    fingerprint: `fingerprint-${id}`,
    editorialPriority: 1,
    editorialOrigin: "article-image",
  },
  url: `https://github.com/example/open-executive/raw/main/${id}.png`,
  caption: `项目截图 ${id}`,
  attribution: "GitHub",
  sourceUrl: "https://github.com/example/open-executive",
  rights: "check-required",
  rightsDecision: "blocked",
  rightsReason: "发布前确认图片权利",
  role: "product",
  origin: "source",
  editorialPriority: 1,
  editorialOrigin: "article-image",
  localReady: true,
});

test("DraftDesk quality gate blocks a community discovery channel from becoming the news headline", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({ title: "Open Executive 因 Hacker News 讨论再受关注" }),
  });

  assert.equal(report.ready, false);
  assert.equal(draftQualityFindingsFor(report)[0]?.dimension, "fact-safety");
  assert.deepEqual(report.blockers.map((item) => item.id), ["news-discovery-headline"]);
});

test("DraftDesk quality gate requires a source fact in the lead of community-discovered news", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({
      paragraphs: [
        "8 月 27 日，Open Executive 因社区讨论重新受到注意。项目把八个专职智能体放进同一套管理界面。",
      ],
      factClaims: [{
        id: "claim-1",
        claim: "8 月 27 日，Open Executive 因社区讨论重新受到注意。项目把八个专职智能体放进同一套管理界面。",
        status: "full-source",
        sourceUrls: ["https://github.com/example/open-executive"],
        capturedAt: "2026-09-01T00:00:00.000Z",
      }],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["news-discovery-lead"]);
});

test("DraftDesk quality gate refuses to carry a community comment corpus into a news draft", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({
      discussionSamples: [{
        id: "comment-1",
        signalId: "signal-hn",
        platform: "Hacker News",
        author: "reader",
        permalink: "https://news.ycombinator.com/item?id=2",
        originalText: "Management may be easier to automate.",
        kind: "opinion",
      }],
    }),
    draft: draft(),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["news-comment-corpus"]);
});

test("DraftDesk quality gate keeps community discovery framing out of a news fact ledger", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({
      factClaims: [{
        id: "claim-discovery",
        claim: "一则 Hacker News 线索指向名为 Open Executive 的开源项目。",
        status: "full-source",
        sourceUrl: "https://github.com/example/open-executive",
        capturedAt: "2026-09-01T00:00:00.000Z",
      }],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["news-discovery-claim"]);
});

test("DraftDesk quality gate allows a later discovery note when it points only to the community source", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({
      paragraphs: [
        "Open Executive 把八个专职智能体放进同一套管理界面，对外提供一个统一入口。",
        "这条项目链接随后出现在 Hacker News，社区链接只用于说明发现路径。",
      ],
      factClaims: [
        {
          id: "claim-event",
          claim: "Open Executive 把八个专职智能体放进同一套管理界面，对外提供一个统一入口。",
          status: "full-source",
          sourceUrls: ["https://github.com/example/open-executive"],
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "claim-discovery-note",
          claim: "这条项目链接随后出现在 Hacker News，社区链接只用于说明发现路径。",
          status: "full-source",
          sourceUrls: ["https://news.ycombinator.com/item?id=1"],
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    }),
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
});

test("DraftDesk quality gate requires paragraph-level evidence for every news paragraph", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({
      paragraphs: [
        "Open Executive 把八个专职智能体放进同一套管理界面。",
        "项目已经在多家企业稳定投入生产。",
      ],
      factClaims: [{
        id: "claim-1",
        claim: "Open Executive 把八个专职智能体放进同一套管理界面。",
        status: "full-source",
        sourceUrls: ["https://github.com/example/open-executive"],
        capturedAt: "2026-09-01T00:00:00.000Z",
      }],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["paragraph-evidence-missing"]);
});

test("DraftDesk quality gate will not create a source working copy without a frozen original", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ intent: "source", mode: "curate", sourceMaterials: undefined }),
    draft: draft({
      draftStrategy: "curate",
      sourceMaterial: undefined,
      factClaims: [],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["source-material-missing"]);
});

test("DraftDesk quality gate keeps cached Top Comments out of a source working copy", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({
      intent: "source",
      mode: "curate",
      sourceMaterials: [{
        signalId: "signal-hn",
        sourceKind: "community-post",
        sourceLabel: "Hacker News",
        url: "https://news.ycombinator.com/item?id=1",
        author: "founder",
        originalTitle: "Show HN: A local AI reader",
        originalText: "I built a local AI reader for my own newsletter.",
        originalLanguage: "en",
        basis: "community-post",
        capturedAt: "2026-09-01T00:00:00.000Z",
        truncated: false,
        rightsNotice: "仅供私人编辑，发布前确认翻译与转载范围。",
      }],
    }),
    draft: draft({
      title: "我做了一个本地 AI 阅读器",
      draftStrategy: "curate",
      paragraphs: ["我为自己的 newsletter 做了一个本地 AI 阅读器。--- Top Comments --- 有人说这个项目没有价值。"],
      factClaims: [],
      sourceMaterial: {
        kind: "community",
        mode: "source",
        sourceUrl: "https://news.ycombinator.com/item?id=1",
        sourceLabel: "Hacker News",
        author: "founder",
        originalLanguage: "en",
        rights: "check-required",
        requiresEditorialReview: true,
      },
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["source-comment-leak"]);
});

test("DraftDesk quality gate blocks consensus language when the community sample is small", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({
      intent: "community",
      mode: "community",
      discussionSamples: [{
        id: "comment-1",
        signalId: "signal-hn",
        platform: "Hacker News",
        author: "reader",
        permalink: "https://news.ycombinator.com/item?id=2",
        originalText: "Managers may be easier to automate.",
        kind: "opinion",
        branchId: "branch-1",
      }],
    }),
    draft: draft({
      draftStrategy: "community",
      paragraphs: [
        "Open Executive 把八个专职智能体放进同一套管理界面。",
        "社区普遍认为，管理岗位比开发岗位更容易被 AI 替代。",
      ],
      factClaims: [
        {
          id: "claim-event",
          claim: "Open Executive 把八个专职智能体放进同一套管理界面。",
          status: "full-source",
          sourceUrls: ["https://github.com/example/open-executive"],
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "claim-community",
          claim: "社区普遍认为，管理岗位比开发岗位更容易被 AI 替代。",
          status: "unverified",
          sourceUrls: ["https://news.ycombinator.com/item?id=1"],
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["community-false-consensus"]);
});

test("DraftDesk quality gate labels community observations drawn from fewer than five samples", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({
      intent: "community",
      mode: "community",
      discussionSamples: [{
        id: "comment-1",
        signalId: "signal-hn",
        platform: "Hacker News",
        author: "reader",
        permalink: "https://news.ycombinator.com/item?id=2",
        originalText: "Managers may be easier to automate.",
        kind: "opinion",
        branchId: "branch-1",
      }],
    }),
    draft: draft({
      draftStrategy: "community",
      paragraphs: [
        "Open Executive 把八个专职智能体放进同一套管理界面。",
        "有用户认为，管理岗位比开发岗位更容易被 AI 替代。",
      ],
      factClaims: [
        {
          id: "claim-event",
          claim: "Open Executive 把八个专职智能体放进同一套管理界面。",
          status: "full-source",
          sourceUrls: ["https://github.com/example/open-executive"],
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "claim-community",
          claim: "有用户认为，管理岗位比开发岗位更容易被 AI 替代。",
          status: "unverified",
          sourceUrls: ["https://news.ycombinator.com/item?id=1"],
          capturedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["community-limited-sample-label"]);
});

test("DraftDesk quality gate requires evidence links for the factual and discussion paragraphs of a community draft", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ intent: "community", mode: "community" }),
    draft: draft({
      draftStrategy: "community",
      paragraphs: ["Open Executive 把八个专职智能体放进同一套管理界面。"],
      factClaims: [],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["paragraph-evidence-missing"]);
});

test("DraftDesk quality gate keeps a repairable image shortfall as a visible warning", () => {
  const first = asset("one");
  const second = asset("two");
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ assets: [first, second], imageIds: [first.sourceImageId, second.sourceImageId] }),
    draft: draft({
      images: [{ id: "placement-one", image: first.sourceImage, afterParagraph: 0, caption: first.caption }],
    }),
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
  assert.deepEqual(report.warnings.map((item) => item.id), ["image-coverage-missing"]);
  assert.deepEqual(draftQualityWarningsFor(report), [{
    id: "image-coverage-missing",
    message: "素材包已有 2 张相关原图，私人草稿至少应插入 2 张。",
    blockId: "images",
    dimension: "images-rights",
  }]);
});

test("DraftDesk quality gate does not count responsive variants as two required visuals", () => {
  const first = asset("eu-flag-1152x648");
  first.sourceImage.url = "https://cdn.arstechnica.net/wp-content/uploads/2022/03/getty-eu-flag-1152x648.jpg";
  first.url = first.sourceImage.url;
  first.sourceImage.caption = "https://www.ft.com/content/example";
  const second = asset("eu-flag-1536x864");
  second.sourceImage.url = "https://cdn.arstechnica.net/wp-content/uploads/2022/03/getty-eu-flag-1536x864.jpg";
  second.url = second.sourceImage.url;
  second.sourceImage.caption = "A European Union flag blowing in the wind.";
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ assets: [first, second], imageIds: [first.sourceImageId, second.sourceImageId] }),
    draft: draft({
      images: [{ id: "placement-one", image: first.sourceImage, afterParagraph: 0, caption: first.caption }],
    }),
  });

  assert.equal(report.ready, true);
  assert.deepEqual(report.blockers, []);
});

test("DraftDesk quality gate keeps an underdeveloped but sourced brief as a visible warning", () => {
  const sourceUrl = "https://arstechnica.com/tech-policy/example-story/";
  const facts: ContentPackage["facts"] = [
    "欧盟委员会把三项服务列为超大型在线平台。",
    "三项服务在欧盟的月活用户都超过四千五百万。",
    "更严格的合规义务将在二〇二六年十二月底前生效。",
    "新增义务包括删除非法内容并加强未成年人保护。",
    "未履行义务的最高罚款可达全球营收的百分之六。",
  ].map((text, index) => ({
    id: `fact-${index}`,
    text,
    status: "supported" as const,
    sourceSignalIds: ["signal-ars"],
    sourceUrls: [sourceUrl],
  }));
  const paragraphs = [
    "欧盟委员会把 ChatGPT、Reddit 和 Roblox 纳入更严格的线上安全监管。",
    "三项服务的欧盟月活用户均超过四千五百万，新增义务将在二〇二六年十二月底前生效。",
    "平台需要删除非法内容并加强未成年人保护，违规最高可罚全球营收的百分之六。",
  ];
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ facts }),
    draft: draft({
      paragraphs,
      factClaims: paragraphs.map((claim, index) => ({
        id: `claim-${index}`,
        claim,
        status: "full-source",
        sourceUrls: [sourceUrl],
        capturedAt: "2026-09-01T00:00:00.000Z",
      })),
    }),
  });

  assert.equal(report.ready, true, JSON.stringify(report));
  assert.equal(report.blockers.some((item) => item.id === "brief-underdeveloped"), false);
  assert.ok(report.warnings.some((item) => item.id === "brief-underdeveloped"));
  const warning = draftQualityWarningsFor(report).find((item) => item.id === "brief-underdeveloped");
  assert.equal(warning?.dimension, "content-completeness");
  assert.equal(warning?.factCoverage?.legacyUnmapped, true);
});

test("DraftDesk quality report identifies unused supported facts and missing editorial dimensions", () => {
  const sourceUrl = "https://example.com/policy-update";
  const facts: ContentPackage["facts"] = [
    "欧盟委员会把三项服务列为超大型在线平台。",
    "三项服务在欧盟的月活用户都超过四千五百万。",
    "更严格的合规义务将在二〇二六年十二月底前生效。",
    "新增义务包括删除非法内容并加强未成年人保护。",
    "未履行义务的最高罚款可达全球营收的百分之六。",
  ].map((text, index) => ({
    id: `fact-${index + 1}`,
    text,
    status: "supported" as const,
    sourceSignalIds: ["signal-policy"],
    sourceUrls: [sourceUrl],
  }));
  const paragraphs = [
    "欧盟委员会把三项服务列为超大型在线平台。",
    "这些服务在欧盟的月活用户都超过四千五百万。",
    "更严格的合规义务将在二〇二六年十二月底前生效。",
  ];
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ facts }),
    draft: draft({
      paragraphs,
      factClaims: paragraphs.map((claim, index) => ({
        id: `claim-${index}`,
        claim,
        factIds: [`fact-${index + 1}`],
        status: "full-source" as const,
        sourceUrls: [sourceUrl],
        capturedAt: "2026-09-01T00:00:00.000Z",
      })),
    }),
  });

  const warning = report.warnings.find((item) => item.id === "brief-underdeveloped");
  assert.deepEqual(warning?.factCoverage, {
    usedFactIds: ["fact-1", "fact-2", "fact-3"],
    unusedFactIds: ["fact-4", "fact-5"],
    supportedFactCount: 5,
    ratio: 0.6,
  });
  assert.deepEqual(warning?.missingDimensions, ["impact"]);
});

test("DraftDesk quality gate accepts a short brief that covers every supported fact", () => {
  const sourceUrl = "https://example.com/complete-brief";
  const facts: ContentPackage["facts"] = [
    "公司发布新的本地模型。",
    "模型参数量为七十亿。",
    "产品从九月三日起开放。",
    "开发者必须先申请测试资格。",
    "首批测试仅面向企业用户。",
  ].map((text, index) => ({
    id: `complete-${index + 1}`,
    text,
    status: "supported" as const,
    sourceSignalIds: ["signal-complete"],
    sourceUrls: [sourceUrl],
  }));
  const paragraphs = [
    "公司发布了一款七十亿参数的本地模型。",
    "产品将从九月三日起开放，开发者需要先申请测试资格。",
    "首批测试仅面向企业用户。",
  ];
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ facts }),
    draft: draft({
      paragraphs,
      factClaims: [
        { id: "complete-claim-1", claim: paragraphs[0]!, factIds: ["complete-1", "complete-2"], status: "full-source", sourceUrls: [sourceUrl], capturedAt: "2026-09-01T00:00:00.000Z" },
        { id: "complete-claim-2", claim: paragraphs[1]!, factIds: ["complete-3", "complete-4"], status: "full-source", sourceUrls: [sourceUrl], capturedAt: "2026-09-01T00:00:00.000Z" },
        { id: "complete-claim-3", claim: paragraphs[2]!, factIds: ["complete-5"], status: "full-source", sourceUrls: [sourceUrl], capturedAt: "2026-09-01T00:00:00.000Z" },
      ],
    }),
  });

  assert.equal(report.ready, true, JSON.stringify(report));
  assert.equal(report.warnings.some((item) => item.id === "brief-underdeveloped"), false);
});

test("an applied repair binds newly used fact ids to their frozen source URLs", () => {
  const packageData = contentPackage({
    facts: [
      { id: "fact-a", text: "产品发布。", status: "supported", sourceSignalIds: ["signal-github"] },
      { id: "fact-b", text: "首批仅面向企业。", status: "supported", sourceSignalIds: ["signal-official"] },
    ],
    sources: [
      ...contentPackage().sources,
      { signalId: "signal-official", label: "官方公告", url: "https://example.com/official", role: "official", basis: "full-source", publishedAt: "2026-09-02T00:00:00.000Z", isCommunity: false },
    ],
  });
  const claims = reconcileDraftFactEvidence(packageData, [{
    id: "claim-1",
    claim: "产品发布，首批仅面向企业。",
    factIds: ["fact-a", "fact-b"],
    status: "full-source",
    sourceUrls: ["https://github.com/example/open-executive"],
    capturedAt: "2026-09-02T00:00:00.000Z",
  }]);

  assert.deepEqual(claims[0]?.sourceUrls, [
    "https://github.com/example/open-executive",
    "https://example.com/official",
  ]);
  assert.equal(claims[0]?.sourceLabel, "GitHub；官方公告");
  assert.throws(() => reconcileDraftFactEvidence(packageData, [{
    ...claims[0]!,
    factIds: ["outside-package"],
  }]), /素材包之外/);
});

test("a community discovery sharing the original signal cannot become a second factual source", () => {
  const original = contentPackage().sources[0]!;
  const community = { ...contentPackage().sources[1]!, signalId: original.signalId };
  const packageData = contentPackage({ sources: [original, community] });
  const claims = reconcileDraftFactEvidence(packageData, [{
    id: "claim-1", claim: "原始项目由八个专职智能体组成。", factIds: ["fact-1"], status: "cross-confirmed",
    sourceUrls: [original.url, community.url, "https://unfrozen.example/news"], capturedAt: "2026-09-05T00:00:00Z",
  }]);
  assert.deepEqual(claims[0]?.sourceUrls, [original.url]);
  assert.equal(claims[0]?.sourceLabel, original.label);
  assert.equal(claims[0]?.status, "full-source");
});

test("a valid frozen fact id cannot endorse a changed price denominator or unit", () => {
  const sourceUrl = contentPackage().sources[0]!.url;
  for (const [fact, claim] of [
    ["输入价格为每百万 token 0.2 美元。", "输入价格为每千 token 0.2 美元。"],
    ["模型需要 16 GB 内存。", "模型需要 16 MB 内存。"],
    ["服务试用期为 7 天。", "服务试用期为 7 小时。"],
    ["产品从 2026 年 9 月 3 日开放。", "产品从 2026 年 9 月 8 日开放。"],
  ]) {
    const packageData = contentPackage({ facts: [{ id: "frozen", text: fact!, status: "supported", sourceSignalIds: ["signal-github"], sourceUrls: [sourceUrl] }] });
    const claimRecord = { id: "claim-integrity", claim: claim!, factIds: ["frozen"], status: "full-source" as const, sourceUrls: [sourceUrl], capturedAt: "2026-09-01T00:00:00Z" };
    const reconciled = reconcileDraftFactEvidence(packageData, [claimRecord]);
    assert.equal(reconciled[0]?.status, "unverified", `${fact} -> ${claim}`);
    const report = evaluateDraftPackageQuality({ contentPackage: packageData, draft: draft({ paragraphs: [claim!], factClaims: reconciled }) });
    assert.ok(report.blockers.some((issue) => issue.id === "frozen-fact-integrity"), JSON.stringify(report));
  }
});

test("final quality checks the actual edited paragraph rather than trusting an old claim snapshot", () => {
  const sourceUrl = contentPackage().sources[0]!.url;
  const correct = "模型需要 16 GB 内存。";
  const packageData = contentPackage({ facts: [{ id: "frozen", text: correct, status: "supported", sourceSignalIds: ["signal-github"], sourceUrls: [sourceUrl] }] });
  const report = evaluateDraftPackageQuality({ contentPackage: packageData, draft: draft({
    paragraphs: ["模型需要 16 MB 内存。"],
    factClaims: [{ id: "claim-integrity", claim: correct, factIds: ["frozen"], status: "full-source", sourceUrls: [sourceUrl], capturedAt: "2026-09-01T00:00:00Z" }],
  }) });
  assert.ok(report.blockers.some((issue) => issue.id === "frozen-fact-integrity" && issue.blockId === "paragraph:0"));
});

test("final quality rejects invented quantities and dates in the title using supported frozen facts", () => {
  const sourceUrl = contentPackage().sources[0]!.url;
  for (const [fact, title] of [
    ["模型需要 16 GB 内存。", "新模型只需 32 GB 内存"],
    ["产品于 2026 年 9 月 3 日开放。", "新产品 2026 年 9 月 8 日开放"],
    ["服务目前仅限预览测试。", "新服务已正式商用"],
  ]) {
    const packageData = contentPackage({ facts: [{ id: "frozen", text: fact!, status: "supported", sourceSignalIds: ["signal-github"], sourceUrls: [sourceUrl] }] });
    const report = evaluateDraftPackageQuality({ contentPackage: packageData, draft: draft({ title: title!, paragraphs: [fact!],
      factClaims: [{ id: "claim", claim: fact!, factIds: ["frozen"], status: "full-source", sourceUrls: [sourceUrl], capturedAt: "2026-09-01T00:00:00Z" }],
    }) });
    assert.ok(report.blockers.some((issue) => issue.id === "frozen-fact-integrity" && issue.blockId === "title"), JSON.stringify(report));
  }
});

test("frozen fact provenance preserves distinct official update sections", () => {
  const urls = ["https://ai.google.dev/gemini-api/docs/changelog#09-01-2026", "https://ai.google.dev/gemini-api/docs/changelog#09-02-2026"];
  const fact = { id: "two-updates", text: "两个日期有不同更新。", status: "supported" as const, sourceSignalIds: ["a", "b"], sourceUrls: urls };
  const packageData = contentPackage({ facts: [fact], sources: urls.map((url, index) => ({
    signalId: index ? "b" : "a", label: index ? "第二日更新" : "第一日更新", url, role: "official", basis: "full-source", publishedAt: "2026-09-01T00:00:00Z", isCommunity: false,
  })) });
  assert.deepEqual(frozenFactSourceUrls(packageData, fact), urls);
  const claims = reconcileDraftFactEvidence(packageData, [{ id: "claim", claim: fact.text, factIds: [fact.id], status: "full-source", capturedAt: "2026-09-03T00:00:00Z" }]);
  assert.equal(claims[0]?.sourceLabel, "第一日更新；第二日更新");
  assert.deepEqual(claims[0]?.sourceUrls, urls);
});

test("DraftDesk quality gate keeps a genuinely small one-fact brief concise", () => {
  const report = evaluateDraftPackageQuality({ contentPackage: contentPackage(), draft: draft() });

  assert.equal(report.ready, true);
  assert.equal(report.blockers.some((item) => item.id === "brief-underdeveloped"), false);
});

test("DraftDesk quality gate blocks unnamed authority claims from generated copy", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({
      paragraphs: ["有专家认为，Open Executive 会显著改变所有公司的管理方式。"],
      factClaims: [{
        id: "claim-1",
        claim: "有专家认为，Open Executive 会显著改变所有公司的管理方式。",
        status: "full-source",
        sourceUrls: ["https://github.com/example/open-executive"],
        capturedAt: "2026-09-01T00:00:00.000Z",
      }],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["writing-unnamed-authority"]);
});

test("DraftDesk quality gate blocks internal workflow language from reader copy", () => {
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage(),
    draft: draft({
      paragraphs: ["这份输入资料来自 GitHub，当前素材包已经核验了八个智能体。"],
      factClaims: [{
        id: "claim-1",
        claim: "这份输入资料来自 GitHub，当前素材包已经核验了八个智能体。",
        status: "full-source",
        sourceUrls: ["https://github.com/example/open-executive"],
        capturedAt: "2026-09-01T00:00:00.000Z",
      }],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["workflow-copy-leak"]);
});
