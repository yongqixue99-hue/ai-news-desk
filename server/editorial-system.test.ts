import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState, upgradeState } from "./defaults.js";
import {
  buildEditorialBrief,
  buildEditorialMemory,
  buildEditorialSuggestions,
  buildEditorialSystemView,
  buildAutomaticSourceReading,
  decideEditorialSuggestion,
  updateEditorialProfile,
} from "./editorial-system.js";
import type { Candidate, WorkflowRun } from "./types.js";

const candidate = (
  id: string,
  title: string,
  publishedAt: string,
  sourceName = "OpenAI",
): Candidate => ({
  id,
  rawId: id,
  sourceType: "rss",
  sourceName,
  title,
  url: `https://example.com/${id}`,
  excerpt: `${title} 的正文摘要`,
  publishedAt,
  fetchedAt: publishedAt,
  score: 12,
  scoreBreakdown: { consequence: 4, novelty: 3, evidence: 3, relevance: 1, timeliness: 1, confirmation: 0, penalty: 0 },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 80,
  topicIds: ["ai"],
  clusterSize: 1,
  relatedSources: [sourceName],
  evidence: "一手来源",
  imageCount: 0,
  images: [],
  selected: false,
  status: "candidate",
});

test("automatic source reading exposes only enabled selected sources and its last scheduled run", () => {
  const state = createDefaultState();
  state.settings.scheduleEnabled = true;
  state.settings.scheduleTime = "07:30";
  state.sources.forEach((source) => {
    source.enabled = false;
    source.selected = false;
  });
  state.sources[0].enabled = true;
  state.sources[0].selected = true;
  state.sources[1].enabled = false;
  state.sources[1].selected = true;
  state.sources[2].enabled = true;
  state.sources[2].selected = false;
  const scheduled = completedRun("scheduled-read", []);
  scheduled.scheduled = true;
  state.runs = [scheduled];

  const reading = buildAutomaticSourceReading(state);

  assert.equal(reading.enabled, true);
  assert.equal(reading.scheduleTime, "07:30");
  assert.deepEqual(reading.sourceIds, [state.sources[0].id]);
  assert.equal(reading.lastRunId, "scheduled-read");
  assert.equal(reading.lastStatus, "complete");
  assert.equal(reading.lastReadAt, scheduled.completedAt);
});

test("source suggestions stay inert until adopted and an ignored decision persists", () => {
  const state = createDefaultState();
  const source = state.sources.find((entry) => !entry.selected)!;
  source.enabled = false;
  state.candidateFeedback = [
    {
      id: "signal-1",
      candidateId: "candidate-1",
      runId: "run-1",
      kind: "published",
      title: "值得持续关注的来源",
      sourceName: source.name,
      topicIds: ["ai"],
      keywords: ["来源"],
      createdAt: "2026-08-17T08:00:00.000Z",
    },
    {
      id: "signal-2",
      candidateId: "candidate-2",
      runId: "run-2",
      kind: "interested",
      title: "同一来源的另一条好内容",
      sourceName: source.name,
      topicIds: ["ai"],
      keywords: ["来源"],
      createdAt: "2026-08-16T08:00:00.000Z",
    },
  ];
  const now = new Date("2026-08-18T12:00:00.000Z");
  const suggestion = buildEditorialSuggestions(state, now)
    .find((entry) => entry.kind === "source-promote" && entry.targetId === source.id);

  assert.ok(suggestion);
  assert.equal(source.selected, false);
  assert.equal(source.enabled, false);

  decideEditorialSuggestion(state, suggestion.id, "ignored", { now: () => now });
  assert.equal(source.selected, false);
  assert.equal(buildEditorialSuggestions(state, now).find((entry) => entry.id === suggestion.id)?.status, "ignored");

  decideEditorialSuggestion(state, suggestion.id, "adopted", { now: () => now });
  assert.equal(source.selected, true);
  assert.equal(source.enabled, true);
});

test("recent editorial memory rolls up explicit 30-day feedback as soft signals", () => {
  const state = createDefaultState();
  state.candidateFeedback = [
    {
      id: "published",
      candidateId: "published",
      runId: "run-1",
      kind: "published",
      title: "OpenAI 发布新模型",
      sourceName: "OpenAI",
      topicIds: ["ai"],
      keywords: ["openai"],
      createdAt: "2026-08-17T08:00:00.000Z",
    },
    {
      id: "interested",
      candidateId: "interested",
      runId: "run-2",
      kind: "interested",
      title: "OpenAI API 定价变化",
      sourceName: "OpenAI",
      topicIds: ["ai", "business"],
      keywords: ["openai", "api"],
      createdAt: "2026-08-16T08:00:00.000Z",
    },
    {
      id: "disliked",
      candidateId: "disliked",
      runId: "run-3",
      kind: "not_interested",
      title: "没有新增事实的观点帖",
      sourceName: "Example Blog",
      topicIds: ["ai"],
      keywords: ["观点"],
      createdAt: "2026-08-15T08:00:00.000Z",
    },
    {
      id: "too-old",
      candidateId: "too-old",
      runId: "run-old",
      kind: "published",
      title: "过期历史记录",
      sourceName: "Old Source",
      topicIds: ["technology"],
      keywords: ["历史"],
      createdAt: "2026-06-01T08:00:00.000Z",
    },
  ];

  const memory = buildEditorialMemory(state, new Date("2026-08-18T12:00:00.000Z"));

  assert.equal(memory.windowDays, 30);
  assert.equal(memory.feedbackCount, 3);
  assert.equal(memory.publishedCount, 1);
  assert.equal(memory.preferredSources[0]?.name, "OpenAI");
  assert.equal(memory.avoidedSources[0]?.name, "Example Blog");
  assert.deepEqual(memory.recentPublishedTitles, ["OpenAI 发布新模型"]);
});

const completedRun = (id: string, candidates: Candidate[]): WorkflowRun => ({
  id,
  createdAt: "2026-08-18T10:00:00.000Z",
  updatedAt: "2026-08-18T11:30:00.000Z",
  completedAt: "2026-08-18T11:30:00.000Z",
  status: "complete",
  stage: "完成",
  windowHours: 48,
  topicIds: ["ai"],
  sourceIds: ["openai-official"],
  scheduled: false,
  rawCount: candidates.length,
  candidates,
  logs: [],
});

test("the user-owned editorial profile is normalized once and never rewritten by derived views", () => {
  const state = createDefaultState();
  const saved = updateEditorialProfile(state, {
    positioning: "  为普通读者解释重要科技变化  ",
    audience: " 对 AI 感兴趣、但不追逐术语的读者 ",
    goals: ["解释影响", "提供可核验来源", "解释影响"],
    preferredTopicIds: ["ai", "technology", "ai"],
    voiceGuidelines: ["先说结论", "不使用震惊体"],
    redLines: ["不把传闻写成事实"],
  }, { now: () => new Date("2026-08-18T04:00:00.000Z") });

  assert.deepEqual(saved, {
    positioning: "为普通读者解释重要科技变化",
    audience: "对 AI 感兴趣、但不追逐术语的读者",
    goals: ["解释影响", "提供可核验来源"],
    preferredTopicIds: ["ai", "technology"],
    voiceGuidelines: ["先说结论", "不使用震惊体"],
    redLines: ["不把传闻写成事实"],
    updatedAt: "2026-08-18T04:00:00.000Z",
  });

  const before = structuredClone(state.editorialSystem.profile);
  buildEditorialSystemView(state, new Date("2026-08-18T05:00:00.000Z"));
  assert.deepEqual(state.editorialSystem.profile, before);
});

test("an empty long-term topic list stays empty instead of inventing an AI preference", () => {
  const state = createDefaultState();
  state.editorialSystem.profile.preferredTopicIds = [];

  upgradeState(state);

  assert.deepEqual(state.editorialSystem.profile.preferredTopicIds, []);
});

test("the short-lived v9 migration bug is repaired before the user has saved a profile", () => {
  const state = createDefaultState();
  state.editorialSystem.profile.preferredTopicIds = ["ai"];

  upgradeState(state);

  assert.deepEqual(state.editorialSystem.profile.preferredTopicIds, []);
});

test("the editorial brief enforces 48 hours and keeps one item per event", () => {
  const state = createDefaultState();
  state.runs = [completedRun("run-today", [
    candidate("primary", "OpenAI launches GPT-6 API for developers", "2026-08-18T11:00:00.000Z"),
    candidate("support", "OpenAI launches GPT-6 API for developers - Reuters", "2026-08-18T10:30:00.000Z", "Reuters"),
    candidate("other", "Anthropic releases a new safety evaluation", "2026-08-18T09:00:00.000Z", "Anthropic"),
    candidate("stale", "A useful but old AI workflow", "2026-08-15T08:00:00.000Z", "Example Weekly"),
  ])];

  const brief = buildEditorialBrief(state, new Date("2026-08-18T12:00:00.000Z"));

  assert.equal(brief.hardWindowHours, 48);
  assert.equal(brief.mustReads.length, 2);
  assert.ok(brief.mustReads.every((item) => item.ageHours <= 48 && item.eventId));
  assert.equal(brief.mustReads.find((item) => item.title.includes("GPT-6"))?.supporting.length, 1);
  assert.equal(brief.excludedDuplicateCount, 1);
  assert.equal(brief.excludedStaleCount, 1);
});
