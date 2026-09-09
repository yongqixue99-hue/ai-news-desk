import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { inspectEditorialIntake } from "./editorial-intake.js";
import { buildContentPackage } from "./package-desk.js";
import { originalCommunityPostText, loadSourceMaterialSnapshots } from "./source-material.js";
import { buildStories } from "./story-desk.js";
import type { Candidate, WorkflowRun } from "./types.js";

const now = "2026-09-01T08:00:00.000Z";

const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "community-source",
  rawId: "community-source",
  sourceType: "hackernews",
  sourceName: "Hacker News",
  sourceRole: "community",
  title: "How I replaced a brittle agent queue",
  url: "https://news.ycombinator.com/item?id=42",
  canonicalUrl: "https://news.ycombinator.com/item?id=42",
  author: "alice",
  excerpt: "I spent three months rebuilding our agent queue after retries caused duplicate work. The useful change was a lease per job, an idempotency key, and a visible retry time. We still keep human approval before any external action.\n\n--- Top Comments ---\n[bob]: This reply must never become part of Alice's original post.",
  publishedAt: "2026-09-01T06:00:00.000Z",
  fetchedAt: "2026-09-01T06:05:00.000Z",
  score: 8,
  scoreBreakdown: { consequence: 2, novelty: 2, evidence: 1, relevance: 1, timeliness: 2, confirmation: 0, penalty: 0 },
  heatScore: 12,
  heatBreakdown: { engagement: 4, sourceReach: 2, crossSource: 1, freshness: 5 },
  recommendationScore: 70,
  clusterSize: 1,
  relatedSources: ["Hacker News"],
  evidence: "社区主帖",
  briefing: {
    titleZh: "一名开发者复盘智能体任务队列",
    summaryZh: "作者复盘了重复任务问题和自己的解决办法。",
    basis: "excerpt",
    generatedAt: "2026-09-01T06:10:00.000Z",
    providerId: "codex",
  },
  engagement: { points: 120, comments: 1, discussionUrl: "https://news.ycombinator.com/item?id=42" },
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
  topicIds: ["ai"],
  ...overrides,
});

const run = (item: Candidate): WorkflowRun => ({
  id: "run-source",
  createdAt: "2026-09-01T06:05:00.000Z",
  updatedAt: "2026-09-01T06:05:00.000Z",
  status: "ready",
  stage: "完成",
  windowHours: 24,
  sourceIds: [],
  scheduled: false,
  rawCount: 1,
  candidates: [item],
  logs: [],
});

test("self-contained community posts recommend a source working copy without inventing consensus", async () => {
  const state = createDefaultState();
  state.runs = [run(candidate())];
  const view = inspectEditorialIntake(state, { runId: "run-source", candidateId: "community-source" }, now);

  assert.equal(view.story.assignment.canDraft, false, "the post alone is not verified news");
  assert.equal(view.intake.sourceKind, "self-contained-community");
  assert.equal(view.intake.recommendedIntent, "source");
  assert.equal(view.intake.options.find((option) => option.intent === "source")?.available, true);
  assert.equal(view.intake.options.find((option) => option.intent === "community")?.available, false);

  const materials = await loadSourceMaterialSnapshots(state, view.story.id);
  assert.equal(materials.length, 1);
  assert.equal(materials[0]?.sourceKind, "community-post");
  assert.equal(materials[0]?.author, "alice");
  assert.doesNotMatch(materials[0]?.originalText ?? "", /bob|Top Comments/u);

  const contentPackage = buildContentPackage(state, {
    storyId: view.story.id,
    intent: "source",
    mode: "curate",
    sourceMaterials: materials,
    now,
  });
  assert.equal(contentPackage.status, "ready");
  assert.equal(contentPackage.facts.length, 0);
  assert.equal(contentPackage.sourceMaterials?.[0]?.originalText, materials[0]?.originalText);
  assert.match(contentPackage.uncertainties.join(" "), /私有编辑工作副本/u);
});

test("cached top comments are removed from the author's original post", () => {
  assert.equal(
    originalCommunityPostText(candidate()),
    "I spent three months rebuilding our agent queue after retries caused duplicate work. The useful change was a lease per job, an idempotency key, and a visible retry time. We still keep human approval before any external action.",
  );
});

test("linked community source mode freezes the external article, not the discussion text", async () => {
  const linked = candidate({
    title: "Discussion title",
    url: "https://example.com/original-report",
    canonicalUrl: "https://example.com/original-report",
    excerpt: "--- Top Comments --- [bob]: cached discussion text",
    engagement: { points: 300, comments: 80, discussionUrl: "https://news.ycombinator.com/item?id=99" },
    briefing: {
      titleZh: "原始报道中文讲解",
      summaryZh: "原始报道已经读取。",
      basis: "full-source",
      generatedAt: "2026-09-01T06:10:00.000Z",
      providerId: "codex",
    },
  });
  const state = createDefaultState();
  state.runs = [run(linked)];
  const story = buildStories(state, now)[0]!;
  const sourceText = "This is the external article body. ".repeat(20);
  const materials = await loadSourceMaterialSnapshots(state, story.id, {
    readExternalSource: async ({ url }) => ({
      page: { url, canonicalUrl: url, title: "Original report", text: sourceText, images: [] },
      capturedAt: now,
      fromCache: true,
    }),
  });

  assert.equal(materials[0]?.sourceKind, "linked-page");
  assert.equal(materials[0]?.url, "https://example.com/original-report");
  assert.equal(materials[0]?.fromCache, true);
  assert.match(materials[0]?.originalText ?? "", /external article body/u);
  assert.doesNotMatch(materials[0]?.originalText ?? "", /cached discussion/u);
});

test("a cached partial block list cannot discard complete source text or its pricing conditions", async () => {
  const linked = candidate({ sourceType: "rss", sourceRole: "official", sourceName: "Publisher", engagement: undefined,
    url: "https://example.com/original-report", canonicalUrl: "https://example.com/original-report" });
  const state = createDefaultState();
  state.runs = [run(linked)];
  const story = buildStories(state, now)[0]!;
  const introduction = "The source explains how the model tools operate and how they are configured. ".repeat(5);
  const text = `${introduction}\n\nPreview pricing ends on December 31, 2026. Production use requires a separate license.`;
  for (const blockText of [introduction, "Original report"]) {
    const materials = await loadSourceMaterialSnapshots(state, story.id, {
      readExternalSource: async ({ url }) => ({
        page: { url, canonicalUrl: url, title: "Original report", text,
          blocks: [{ kind: "paragraph", text: blockText }], images: [] },
        capturedAt: now, fromCache: true,
      }),
    });
    assert.equal(materials[0]?.originalText, text);
    assert.equal(materials[0]?.blocks, undefined);
    assert.equal(materials[0]?.truncated, false, "the complete text was retained");
    assert.match(materials[0]?.extractionWarnings?.join(" ") ?? "", /结构/u);
  }
});
