import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCommunityArticleInput,
  extractLinkedCommunitySource,
  mergeDraftSources,
  validateReaderFacingCommunityArticle,
} from "./community-draft.js";
import type { Candidate, ExtractedPage } from "./types.js";

const hackerNewsCandidate = {
  id: "hn-open-executive",
  rawId: "hackernews:story:49458418",
  sourceType: "hackernews",
  sourceName: "Hacker News",
  sourceRole: "community",
  title: "CEO fired developers to make room for AI. Developers create open source AI CEO",
  url: "https://github.com/SenteLabsAI/OpenExecutive",
  canonicalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
  excerpt: "--- Top Comments --- [crnkofe]: I think leadership jobs may be easier to automate.",
  publishedAt: "2026-08-27T01:46:22.000Z",
  fetchedAt: "2026-08-27T14:30:14.000Z",
  score: 11,
  scoreBreakdown: { consequence: 4, novelty: 3, evidence: 1, relevance: 2, timeliness: 1, confirmation: 0, penalty: 0 },
  heatScore: 50,
  heatBreakdown: { engagement: 50, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 86,
  topicIds: ["ai"],
  engagement: {
    points: 805,
    comments: 546,
    discussionUrl: "https://news.ycombinator.com/item?id=49458418",
  },
  clusterSize: 1,
  relatedSources: ["Hacker News"],
  evidence: "待交叉核验",
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
} satisfies Candidate;

const linkedSourcePage: ExtractedPage = {
  url: "https://github.com/SenteLabsAI/OpenExecutive",
  canonicalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
  title: "SenteLabsAI/OpenExecutive",
  text: [
    "OpenExecutive is an open-source virtual executive team.",
    "It presents one executive persona backed by eight specialist agents.",
    "The project uses FastAPI and Next.js and is licensed under Apache-2.0.",
  ].join(" "),
  blocks: [
    { kind: "heading", text: "OpenExecutive" },
    { kind: "paragraph", text: "OpenExecutive is an open-source virtual executive team." },
    { kind: "paragraph", text: "It presents one executive persona backed by eight specialist agents." },
    { kind: "paragraph", text: "The project uses FastAPI and Next.js and is licensed under Apache-2.0." },
  ],
  images: [],
};

test("a linked community story builds the article from the linked source, not one cached comment", () => {
  const input = buildCommunityArticleInput(hackerNewsCandidate, linkedSourcePage);

  assert.equal(input.candidate.sourceName, "GitHub");
  assert.equal(input.candidate.sourceRole, "discovery");
  assert.equal(input.candidate.sourceType, "web");
  assert.equal(input.candidate.publishedAt, "");
  assert.equal(input.canonicalUrl, "https://github.com/SenteLabsAI/OpenExecutive");
  assert.match(input.extractedText, /eight specialist agents/u);
  assert.doesNotMatch(input.extractedText, /crnkofe|Top Comments|leadership jobs/u);
  assert.doesNotMatch(input.candidate.excerpt, /crnkofe|Top Comments/u);
});

test("linked source reading retries once and never substitutes a supporting candidate", async () => {
  let attempts = 0;
  const page = await extractLinkedCommunitySource(
    hackerNewsCandidate,
    4,
    async (url) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary upstream reset");
      assert.equal(url, "https://github.com/SenteLabsAI/OpenExecutive");
      return linkedSourcePage;
    },
    0,
  );

  assert.equal(attempts, 2);
  assert.equal(page.canonicalUrl, linkedSourcePage.canonicalUrl);
});

test("source-first drafts merge duplicate discussion links without losing verification", () => {
  const sources = mergeDraftSources([
    { label: "GitHub · 关联来源", url: "https://github.com/example/repo/", kind: "primary", verified: false },
    { label: "仓库", url: "https://github.com/example/repo", kind: "supporting", verified: true },
    { label: "Hacker News", url: "https://news.ycombinator.com/item?id=1", kind: "supporting", verified: true },
    { label: "社区讨论", url: "https://news.ycombinator.com/item?id=1", kind: "supporting", verified: false },
  ]);

  assert.equal(sources.length, 2);
  assert.deepEqual(sources.map(({ kind, verified }) => ({ kind, verified })), [
    { kind: "primary", verified: true },
    { kind: "supporting", verified: true },
  ]);
});

test("reader-facing article guard blocks workflow notes from leaking into the draft", () => {
  assert.throws(() => validateReaderFacingCommunityArticle([
    "这份输入资料来自 Hacker News，讨论串标题是某某。",
    "当前输入里只看到 1 条 Top Comment，后续编辑需要继续核验。",
  ]), /后台处理语言/u);

  assert.throws(() => validateReaderFacingCommunityArticle([
    "它这次进入新闻窗口的原因不是新版本上线。",
    "项目文档列出了现有功能。",
  ]), /模板化翻案/u);

  assert.throws(() => validateReaderFacingCommunityArticle([
    "Hacker News 社区用户集中讨论了管理岗位能否被替代，评论区给出了多种看法。",
    "社区讨论的主要分歧也围绕岗位替代展开，高赞评论继续分析了开发者和管理者的差别。",
  ]), /社区讨论主导/u);

  assert.doesNotThrow(() => validateReaderFacingCommunityArticle([
    "Sente Labs 开源了 OpenExecutive。这个项目把八个专职智能体放在同一套管理界面里，对外表现为一个虚拟管理团队。",
    "项目采用 FastAPI 和 Next.js，代码使用 Apache 2.0 许可证。仓库目前展示的是产品方案和演示，实际效果仍要看部署后的任务完成情况。",
  ]));

  assert.doesNotThrow(() => validateReaderFacingCommunityArticle([
    "Sente Labs 的开源项目 OpenExecutive 在 8 月 27 日因一条 Hacker News 帖子重新受到关注。项目把用户入口统一成一个 Executive 角色，背后由八个专业代理协同工作。",
    "项目会把企业文档送入检索层，再保存跨会话的决策记录。官网把它定位为可自托管的开源虚拟高管团队，最后的判断仍由人完成。",
    "项目早在 6 月 30 日公开发布。8 月 27 日的 Hacker News 讨论把它重新带回读者视野，仓库和官网都没有说明帖子标题里的裁员说法指向哪家公司。",
  ]));
});
