import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import {
  recordCandidateFeedback,
  recordPublishedCandidateFeedback,
  preferenceKeywordsFor,
  restoreCandidateFeedback,
} from "./candidate-feedback.js";
import { rawItemToCandidate } from "./scoring.js";

const candidateFor = (id: string, title = "OpenAI announces a new reasoning model") => {
  const candidate = rawItemToCandidate({
    id,
    source_type: "rss",
    title,
    url: `https://openai.com/index/${id}`,
    content: "The release includes a new API and benchmark results.",
    author: "OpenAI",
    published_at: "2026-08-13T10:00:00.000Z",
    fetched_at: "2026-08-13T11:00:00.000Z",
    metadata: { feed_name: "OpenAI" },
  }, 24, ["ai"]);
  return candidate;
};

test("preference snapshots keep useful Chinese and English title terms", () => {
  const keywords = preferenceKeywordsFor("OpenAI 与苹果发布端侧人工智能能力");
  assert.ok(keywords.includes("openai"));
  assert.ok(keywords.includes("苹果"));
  assert.ok(keywords.includes("人工"));
  assert.ok(keywords.includes("智能"));
});

test("explicit candidate feedback is persisted as a snapshot and can be restored", () => {
  const state = createDefaultState();
  const candidate = candidateFor("openai-feedback-1");
  state.runs.push({
    id: "run-feedback",
    createdAt: "2026-08-13T11:00:00.000Z",
    updatedAt: "2026-08-13T11:00:00.000Z",
    status: "ready",
    stage: "候选新闻",
    windowHours: 24,
    topicIds: ["ai"],
    sourceIds: ["openai"],
    scheduled: false,
    rawCount: 1,
    candidates: [candidate],
    logs: [],
  });

  const feedback = recordCandidateFeedback(state, {
    runId: "run-feedback",
    candidateId: candidate.id,
    kind: "not_interested",
    at: "2026-08-13T12:00:00.000Z",
  });

  assert.equal(feedback?.kind, "not_interested");
  assert.equal(state.candidateFeedback.length, 1);
  assert.equal(state.candidateFeedback[0].sourceName, "OpenAI");
  assert.deepEqual(state.candidateFeedback[0].topicIds, ["ai"]);
  assert.ok(state.candidateFeedback[0].keywords.includes("openai"));
  assert.equal(state.runs[0].candidates[0].userFeedback, "not_interested");

  assert.equal(restoreCandidateFeedback(state, candidate.id), true);
  assert.equal(state.candidateFeedback.length, 0);
  assert.equal(state.runs[0].candidates[0].userFeedback, undefined);
});

test("selection is not positive feedback; an explicit publication confirmation is", () => {
  const state = createDefaultState();
  const candidate = candidateFor("openai-published-1");
  candidate.selected = true;
  state.runs.push({
    id: "run-published",
    createdAt: "2026-08-13T11:00:00.000Z",
    updatedAt: "2026-08-13T11:00:00.000Z",
    status: "complete",
    stage: "成稿完成",
    windowHours: 24,
    topicIds: ["ai"],
    sourceIds: ["openai"],
    scheduled: false,
    rawCount: 1,
    candidates: [candidate],
    logs: [],
  });
  assert.equal(state.candidateFeedback.length, 0);
  state.drafts.push({
    id: "draft-published",
    runId: "run-published",
    candidateId: candidate.id,
    createdAt: "2026-08-13T11:30:00.000Z",
    updatedAt: "2026-08-13T11:30:00.000Z",
    status: "filled",
    title: candidate.title,
    paragraphs: [candidate.excerpt],
    take: "值得继续观察。",
    sources: [{ label: "OpenAI", url: candidate.url, kind: "original-report", verified: true }],
    uncertainties: [],
    images: [],
    community: "盒友杂谈",
    topics: ["OpenAI"],
    provenance: { originalUrl: candidate.url, generatedBy: "Codex" },
  });

  const feedback = recordPublishedCandidateFeedback(
    state,
    "draft-published",
    "2026-08-13T12:30:00.000Z",
  );

  assert.equal(feedback?.kind, "published");
  assert.equal(feedback?.draftId, "draft-published");
  assert.equal(state.candidateFeedback.length, 1);
});
