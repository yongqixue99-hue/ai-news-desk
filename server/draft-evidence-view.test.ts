import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftEvidenceView } from "./draft-evidence-view.js";
import type { ArticleDraft } from "./types.js";

const sourceFirstDraft = (overrides: Partial<ArticleDraft> = {}): ArticleDraft => ({
  id: "draft-open-executive",
  runId: "run-open-executive",
  candidateId: "candidate-open-executive",
  createdAt: "2026-09-01T04:21:29.344Z",
  updatedAt: "2026-09-01T04:21:29.344Z",
  status: "editing",
  title: "SenteLabsAI 开源多代理高管项目 Open Executive",
  draftStrategy: "brief",
  paragraphs: ["Open Executive 是一个开源多代理项目。"],
  take: "",
  bodyHtml: '<p>Open Executive 是一个开源多代理项目。</p><img data-media-id="image-1"><img data-media-id="image-2">',
  sources: [
    { label: "github.com", url: "https://github.com/SenteLabsAI/OpenExecutive", kind: "primary", verified: true },
    { label: "Hacker News", url: "https://news.ycombinator.com/item?id=49458418", kind: "supporting", verified: true },
  ],
  factClaims: [
    {
      id: "claim-1",
      claim: "项目采用 Apache 2.0 许可。",
      status: "full-source",
      sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      capturedAt: "2026-09-01T04:21:29.344Z",
    },
    {
      id: "claim-2",
      claim: "项目由一个 Orchestrator 和八个专门 Agent 组成。",
      status: "full-source",
      sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      capturedAt: "2026-09-01T04:21:29.344Z",
    },
  ],
  uncertainties: [
    "仍未知：公开资料没有说明标题中的 CEO 指向哪家公司，也没有交代裁员经过",
    "仍未知：现有页面没有给出项目实际效果、用户规模或生产环境案例",
    "部分原图可进入私人编辑草稿，但公众号同步前会被预检拦截，需确认权利或替换",
  ],
  images: [
    {
      id: "image-1",
      afterParagraph: 0,
      caption: "仓库封面",
      image: {
        id: "asset-1",
        url: "/one.jpg",
        caption: "仓库封面",
        attribution: "SenteLabsAI",
        sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
        selected: true,
        rights: "check-required",
      },
    },
    {
      id: "image-2",
      afterParagraph: 0,
      caption: "产品界面",
      image: {
        id: "asset-2",
        url: "/two.jpg",
        caption: "产品界面",
        attribution: "SenteLabsAI",
        sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
        selected: true,
        rights: "check-required",
      },
    },
  ],
  community: "",
  topics: ["AI"],
  provenance: {
    originalUrl: "https://github.com/SenteLabsAI/OpenExecutive",
    generatedBy: "codex-cli",
    contentPackageId: "package-open-executive",
    generatorRevision: "source-first-v8",
  },
  ...overrides,
});

test("community discovery is separated from the event source and never becomes a user verification task", () => {
  const view = buildDraftEvidenceView(sourceFirstDraft());

  assert.deepEqual(view.eventSources.map((source) => source.label), ["github.com"]);
  assert.deepEqual(view.discoverySources.map((source) => source.label), ["Hacker News"]);
  assert.equal(view.automaticFactCount, 2);
  assert.equal(view.factDecisionCount, 0);
  assert.equal(view.sourceDecisionCount, 0);
});

test("unknown background and image rights are not mislabeled as facts the user must verify", () => {
  const view = buildDraftEvidenceView(sourceFirstDraft());

  assert.equal(view.contextNotes.length, 2);
  assert.equal(view.rightsNotes.length, 1);
  assert.equal(view.factUncertainties.length, 0);
  assert.equal(view.factDecisionCount, 0);
  assert.equal(view.imageDecisionCount, 2);
});

test("only an unsupported claim or explicit factual conflict asks for a decision", () => {
  const base = sourceFirstDraft();
  const view = buildDraftEvidenceView(sourceFirstDraft({
    factClaims: [
      ...(base.factClaims ?? []),
      {
        id: "claim-weak",
        claim: "项目已经被某家大型企业采用。",
        status: "unverified",
        sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
        capturedAt: "2026-09-01T04:21:29.344Z",
      },
    ],
    uncertainties: ["待核验：项目是否已经在生产环境部署"],
  }));

  assert.equal(view.factDecisionCount, 2);
  assert.deepEqual(view.factUncertainties, ["待核验：项目是否已经在生产环境部署"]);
  assert.deepEqual(view.attentionClaims.map((claim) => claim.id), ["claim-weak"]);
});

test("a cached community hot comment is isolated from factual evidence", () => {
  const view = buildDraftEvidenceView(sourceFirstDraft({
    factClaims: [{
      id: "comment-claim",
      claim: "--- 热门评论 --- [crnkofe]：领导岗位更容易被自动化。",
      status: "unverified",
      sourceUrl: "https://news.ycombinator.com/item?id=49458418",
      sourceExcerpt: "--- Top Comments --- leadership jobs are easier to automate",
      capturedAt: "2026-09-01T04:21:29.344Z",
    }],
    uncertainties: [],
  }));

  assert.equal(view.automaticFactCount, 0);
  assert.equal(view.factDecisionCount, 0);
  assert.equal(view.discussionNotes.length, 1);
});

test("a discovery-framed sentence cannot appear among an otherwise source-first fact ledger", () => {
  const view = buildDraftEvidenceView(sourceFirstDraft({
    factClaims: [{
      id: "discovery-claim",
      claim: "一则 Hacker News 线索指向名为 Open Executive 的开源项目。",
      status: "full-source",
      sourceUrl: "https://github.com/SenteLabsAI/OpenExecutive",
      capturedAt: "2026-09-01T04:21:29.344Z",
    }],
    uncertainties: [],
  }));

  assert.equal(view.automaticFactCount, 0);
  assert.equal(view.discussionNotes.length, 1);
});
