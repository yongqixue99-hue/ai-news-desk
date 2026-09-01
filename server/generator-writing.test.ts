import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptGeneratedReview,
  buildGeneratedFactClaims,
  parseGeneratedArticle,
  validateSourceFirstNewsFrame,
} from "./generator.js";

test("a factual brief may be one paragraph and does not need a forced opinion", () => {
  const article = parseGeneratedArticle(JSON.stringify({
    strategy: "brief",
    title: "OpenAI更新ChatGPT数据导出入口",
    paragraphs: ["OpenAI 周二更新帮助文档，欧盟用户可从 9 月 3 日起直接导出聊天记录。"],
    take: "",
    sources: [{
      label: "OpenAI Help Center",
      url: "https://help.openai.com/example",
      kind: "primary",
      verified: true,
    }],
    paragraphEvidence: [{
      paragraphIndex: 0,
      sourceUrls: ["https://help.openai.com/example"],
    }],
    uncertainties: [],
    imageSelections: [],
    discoveredImages: [],
    topics: [],
  }));

  assert.equal(article.strategy, "brief");
  assert.equal(article.title, "OpenAI 更新 ChatGPT 数据导出入口");
  assert.equal(article.paragraphs.length, 1);
  assert.equal(article.take, "");
  assert.deepEqual(article.paragraphEvidence, [{
    paragraphIndex: 0,
    sourceUrls: ["https://help.openai.com/example"],
  }]);
});

test("automatic review may compress list-like prose but cannot change evidence metadata", () => {
  const base = {
    strategy: "brief",
    title: "Open Executive 重新受到关注",
    paragraphs: ["Open Executive 由 8 个代理组成，覆盖战略、财务、人力、法务、运营、营销、产品和董事会沟通。"],
    take: "",
    sources: [{ label: "GitHub", url: "https://github.com/example/repo", kind: "primary", verified: true }],
    paragraphEvidence: [{ paragraphIndex: 0, sourceUrls: ["https://github.com/example/repo"] }],
    uncertainties: [],
    imageSelections: [],
    discoveredImages: [],
    topics: [],
  } as const;
  const original = parseGeneratedArticle(JSON.stringify(base));
  const reviewed = parseGeneratedArticle(JSON.stringify({
    ...base,
    paragraphs: ["Open Executive 由 8 个代理组成，负责公司的主要管理职能。"],
  }));
  const accepted = acceptGeneratedReview(original, reviewed);

  assert.equal(accepted.paragraphs[0], "Open Executive 由 8 个代理组成，负责公司的主要管理职能。");
  assert.deepEqual(accepted.sources, original.sources);
  assert.deepEqual(accepted.paragraphEvidence, original.paragraphEvidence);
});

test("automatic review is rejected when it drops a protected fact", () => {
  const payload = {
    strategy: "brief",
    title: "Open Executive 重新受到关注",
    paragraphs: ["Open Executive 由 8 个代理组成，覆盖战略、财务、人力、法务等职能。"],
    take: "",
    sources: [{ label: "GitHub", url: "https://github.com/example/repo", kind: "primary", verified: true }],
    paragraphEvidence: [{ paragraphIndex: 0, sourceUrls: ["https://github.com/example/repo"] }],
    uncertainties: [], imageSelections: [], discoveredImages: [], topics: [],
  };
  const original = parseGeneratedArticle(JSON.stringify(payload));
  const reviewed = parseGeneratedArticle(JSON.stringify({ ...payload, paragraphs: ["Open Executive 负责多项管理职能。"] }));

  assert.throws(() => acceptGeneratedReview(original, reviewed), /8/u);
});

test("paragraph claims keep their exact evidence links instead of inheriting one candidate URL", () => {
  const claims = buildGeneratedFactClaims({
    candidateId: "candidate-1",
    candidateSourceName: "GitHub",
    paragraphs: ["项目包含八个专职代理。", "项目在 8 月 27 日进入 Hacker News 首页。"],
    sources: [
      { label: "架构文档", url: "https://github.com/example/repo/blob/main/architecture.md", kind: "primary", verified: true },
      { label: "Hacker News", url: "https://news.ycombinator.com/item?id=1", kind: "supporting", verified: true },
    ],
    paragraphEvidence: [
      { paragraphIndex: 0, sourceUrls: ["https://github.com/example/repo/blob/main/architecture.md"] },
      { paragraphIndex: 1, sourceUrls: ["https://news.ycombinator.com/item?id=1"] },
    ],
    canonicalUrl: "https://github.com/example/repo",
    capturedAt: "2026-09-01T00:00:00.000Z",
  });

  assert.deepEqual(claims.map((claim) => ({ status: claim.status, sourceUrls: claim.sourceUrls })), [
    { status: "full-source", sourceUrls: ["https://github.com/example/repo/blob/main/architecture.md"] },
    { status: "full-source", sourceUrls: ["https://news.ycombinator.com/item?id=1"] },
  ]);
});

test("a source-first news draft cannot promote its community discovery channel into the headline or lead", () => {
  const context = { contentIntent: "news" as const, discoveredViaCommunity: true };
  assert.throws(() => validateSourceFirstNewsFrame({
    title: "Open Executive 因 Hacker News 讨论再受关注",
    paragraphs: ["Open Executive 是一个由八个智能体组成的虚拟高管团队。"],
  }, context), /社区发现渠道/u);

  assert.throws(() => validateSourceFirstNewsFrame({
    title: "Open Executive 由八个智能体组成虚拟高管团队",
    paragraphs: ["8 月 27 日，Open Executive 因社区讨论重新受到注意。"],
  }, context), /社区讨论写成了事件本身/u);

  assert.doesNotThrow(() => validateSourceFirstNewsFrame({
    title: "Open Executive 用八个智能体组成虚拟高管团队",
    paragraphs: ["开源项目 Open Executive 把八个专职智能体放进同一个管理界面，对外提供一个统一的虚拟高管入口。"],
  }, context));

  assert.doesNotThrow(() => validateSourceFirstNewsFrame({
    title: "开发者在 Hacker News 争论 AI 是否会替代管理岗位",
    paragraphs: ["一场社区讨论围绕 AI 与管理岗位展开。"],
  }, { contentIntent: "community", discoveredViaCommunity: true }));
});
