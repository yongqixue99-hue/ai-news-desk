import assert from "node:assert/strict";
import test from "node:test";
import { createDraftGenerationAttempt } from "./draft-generation-attempt.js";
import type { EditorialDraftQualityReport } from "./editorial-quality-desk.js";
import type { ArticleDraft } from "./types.js";

const draft: ArticleDraft = {
  id: "draft-attempt",
  runId: "run-1",
  candidateId: "candidate-1",
  createdAt: "2026-09-02T01:00:00.000Z",
  updatedAt: "2026-09-02T01:00:00.000Z",
  status: "editing",
  title: "Apple 更新桌面 Mac 产品线",
  draftStrategy: "brief",
  paragraphs: ["Apple 更新了 Mac mini 和 Mac Studio。"],
  take: "",
  sources: [],
  factClaims: [],
  uncertainties: [],
  images: [],
  community: "",
  topics: [],
  provenance: {
    originalUrl: "https://example.com/apple-mac",
    generatedBy: "codex",
    aiTraceId: "trace-1",
    contentPackageId: "package-1",
  },
};

test("a blocked generated draft is retained as an inspectable local attempt", () => {
  const qualityReport: EditorialDraftQualityReport = {
    ready: false,
    blockers: [{ id: "news-discovery-claim", blockId: "evidence", message: "社区发现过程不能进入事实账本。" }],
    warnings: [],
  };

  const attempt = createDraftGenerationAttempt({
    contentPackageId: "package-1",
    storyId: "story-1",
    generatorRevision: "source-first-v11",
    draft,
    qualityReport,
    now: "2026-09-02T01:01:00.000Z",
  });

  assert.equal(attempt.status, "blocked");
  assert.equal(attempt.draft.paragraphs[0], "Apple 更新了 Mac mini 和 Mac Studio。");
  assert.equal(attempt.qualityReport.blockers[0]?.id, "news-discovery-claim");
  assert.equal(attempt.aiTraceId, "trace-1");
  draft.paragraphs[0] = "mutated later";
  assert.equal(attempt.draft.paragraphs[0], "Apple 更新了 Mac mini 和 Mac Studio。");
});
