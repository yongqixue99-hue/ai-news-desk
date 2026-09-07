import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createDefaultState } from "../../server/defaults.js";
import type { EditorialSystemView } from "../../server/types.js";
import { EditorialSystemPage } from "./EditorialSystemPage.js";

test("content strategy hands real-time selection off to the Today desk instead of duplicating candidate cards", () => {
  const state = createDefaultState();
  state.aiSettings.completionProviderId = "";
  const now = new Date().toISOString();
  const view: EditorialSystemView = {
    profile: state.editorialSystem.profile,
    brief: {
      generatedAt: now,
      hardWindowHours: 48,
      mustReads: [{
        eventId: "event-1",
        runId: "run-1",
        candidateId: "candidate-1",
        title: "A duplicated real-time candidate title",
        url: "https://example.com/candidate",
        sourceName: "Example News",
        publishedAt: now,
        ageHours: 2,
        excerpt: "This candidate belongs on the Today desk.",
        topicIds: ["ai"],
        recommendationScore: 91,
        evidence: "官方一手来源",
        supporting: [],
      }],
      coverageGaps: ["science"],
      excludedDuplicateCount: 3,
      excludedStaleCount: 2,
      excludedUndatedCount: 0,
    },
    memory: {
      generatedAt: now,
      windowDays: 30,
      feedbackCount: 0,
      publishedCount: 0,
      preferredSources: [],
      avoidedSources: [],
      topicSignals: [],
      recentPublishedTitles: [],
    },
    suggestions: [],
    automaticReading: {
      enabled: false,
      scheduleTime: state.settings.scheduleTime,
      sourceIds: [],
      sourceNames: [],
    },
    writingMemories: {
      effectiveEditCount: 0,
      applicationThreshold: 5,
      applicationUnlocked: false,
      memories: [],
    },
    qualityBaseline: {
      version: "editorial-golden/v1",
      total: 20,
      passed: 20,
      failed: 0,
      categoryCounts: { news: 6, community: 6, source: 3, visual: 2, writing: 3 },
    },
  };

  const markup = renderToStaticMarkup(createElement(EditorialSystemPage, {
    view,
    settings: state.settings,
    aiSettings: state.aiSettings,
    busy: false,
    onSaveProfile: async () => undefined,
    onDecision: async () => undefined,
    onSettings: async () => undefined,
    onReadNow: async () => undefined,
    onOpenSources: () => undefined,
    onOpenRun: () => undefined,
    onToggleWritingMemory: async () => undefined,
    onDeleteWritingMemory: async () => undefined,
  }));

  assert.match(markup, /href="#today"/u);
  assert.match(markup, /去选今天的题/u);
  assert.doesNotMatch(markup, /A duplicated real-time candidate title/u);
  assert.doesNotMatch(markup, /当前值得处理的事件|>进入候选池</u);
  assert.match(markup, /规则检查/u);
  assert.match(markup, /20 \/ 20/u);
  assert.match(markup, /aria-label="应用写作档案"/u);
  assert.match(markup, /aria-label="应用写作记忆"/u);
  assert.match(markup, /请先在 AI 设置中选择一个 Tab 补全模型/u);
});
