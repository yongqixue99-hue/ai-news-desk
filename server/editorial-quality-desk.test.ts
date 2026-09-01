import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDraftPackageQuality } from "./editorial-quality-desk.js";
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

test("DraftDesk quality gate preserves two relevant source images in a private draft", () => {
  const first = asset("one");
  const second = asset("two");
  const report = evaluateDraftPackageQuality({
    contentPackage: contentPackage({ assets: [first, second], imageIds: [first.sourceImageId, second.sourceImageId] }),
    draft: draft({
      images: [{ id: "placement-one", image: first.sourceImage, afterParagraph: 0, caption: first.caption }],
    }),
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.blockers.map((item) => item.id), ["image-coverage-missing"]);
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
