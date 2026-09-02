import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createHumanDraftInState } from "./draft-desk.js";
import { normalizeDraftCatalog } from "./draft-catalog.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft, SourceImage } from "./types.js";

const contentPackage: ContentPackage = {
  id: "package-human-first",
  storyId: "story-human-first",
  mode: "brief",
  intent: "news",
  title: "Acme 发布 Model X",
  createdAt: "2026-09-02T08:00:00.000Z",
  facts: [
    {
      id: "fact-release",
      text: "Acme 发布了 Model X。",
      status: "supported",
      sourceSignalIds: ["run-human:candidate-human"],
      sourceUrls: ["https://acme.example/model-x"],
      note: "Acme 官方页面已经确认。",
    },
    {
      id: "fact-price",
      text: "Model X 的价格尚未公开。",
      status: "unverified",
      sourceSignalIds: ["run-human:candidate-human"],
      sourceUrls: ["https://acme.example/model-x"],
      note: "原文没有给出价格。",
    },
  ],
  communitySummary: "开发者主要关心部署成本。",
  communityFocus: ["部署成本", "许可证"],
  discussionSamples: [],
  sourceSignalIds: ["run-human:candidate-human"],
  sources: [{
    signalId: "run-human:candidate-human",
    label: "Acme 官方",
    url: "https://acme.example/model-x",
    role: "official",
    basis: "full-source",
    publishedAt: "2026-09-02T07:30:00.000Z",
    isCommunity: false,
  }],
  imageIds: ["image-model-x"],
  assets: [],
  uncertainties: ["Model X 的价格尚未公开。"],
  suggestedAngles: ["Model X 对本地部署意味着什么", "API 与开放权重的差异"],
  communityEvidenceLabel: "有限样本",
  status: "ready",
  blockers: [],
};

const sourceImage: SourceImage = {
  id: "image-model-x",
  url: "https://acme.example/model-x.jpg",
  publicPath: "/media/model-x.jpg",
  localPath: "C:\\fixtures\\model-x.jpg",
  fingerprint: "a".repeat(64),
  caption: "Model X 官方产品图",
  attribution: "Acme",
  sourceUrl: "https://acme.example/model-x",
  selected: true,
  rights: "official",
  allowedPlatforms: ["wechat"],
};

test("human-first drafting opens one blank evidence-bound draft without calling a writer", () => {
  const state = createDefaultState();
  const first = createHumanDraftInState({
    state,
    contentPackage,
    images: [sourceImage],
    draftId: "draft-human-first",
    now: "2026-09-02T08:05:00.000Z",
  });

  assert.equal(first.reused, false);
  assert.equal(first.draft.title, contentPackage.title);
  assert.deepEqual(first.draft.paragraphs, []);
  assert.equal(first.draft.bodyHtml, "");
  assert.equal(first.draft.take, "");
  assert.equal(first.draft.provenance.generatedBy, "human");
  assert.equal(first.draft.provenance.authoringMode, "human-first");
  assert.equal(first.draft.provenance.contentPackageId, contentPackage.id);
  assert.deepEqual(first.draft.writingBrief?.suggestedAngles, contentPackage.suggestedAngles);
  assert.deepEqual(first.draft.writingBrief?.communityFocus, contentPackage.communityFocus);
  assert.deepEqual(first.draft.factClaims?.map((claim) => ({
    id: claim.id,
    factIds: claim.factIds,
    status: claim.status,
  })), [
    { id: "fact-release", factIds: ["fact-release"], status: "full-source" },
    { id: "fact-price", factIds: ["fact-price"], status: "unverified" },
  ]);
  assert.equal(first.draft.sources[0]?.verified, true);
  assert.equal(first.draft.images[0]?.afterParagraph, -1);
  assert.equal(first.draft.images[0]?.image.id, sourceImage.id);

  const second = createHumanDraftInState({
    state,
    contentPackage,
    images: [],
    draftId: "draft-must-not-be-created",
    now: "2026-09-02T08:06:00.000Z",
  });

  assert.equal(second.reused, true);
  assert.equal(second.draft.id, first.draft.id);
  assert.equal(state.drafts.filter((draft) => draft.provenance.authoringMode === "human-first").length, 1);
});

test("a human-first draft and an AI draft for the same package remain separately recoverable", () => {
  const state = createDefaultState();
  const manual = createHumanDraftInState({
    state,
    contentPackage,
    images: [],
    draftId: "draft-human-first",
    now: "2026-09-02T08:05:00.000Z",
  }).draft;
  const aiDraft: ArticleDraft = {
    ...structuredClone(manual),
    id: "draft-ai",
    title: "AI 生成草稿",
    paragraphs: ["Acme 发布了 Model X。"],
    bodyHtml: "<p>Acme 发布了 Model X。</p>",
    provenance: {
      ...manual.provenance,
      generatedBy: "openai-compatible",
      authoringMode: "ai-generated",
      generatorRevision: "source-first-v12",
    },
  };

  const normalized = normalizeDraftCatalog([aiDraft, manual]);

  assert.deepEqual(normalized.map((draft) => draft.status), ["editing", "editing"]);
  assert.equal(normalized.every((draft) => !draft.provenance.supersededByDraftId), true);
});
