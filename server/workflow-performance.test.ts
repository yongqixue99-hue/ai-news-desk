import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { appendDraftRevision, snapshotDraft } from "./draft-revisions.js";
import { confirmDraftInState } from "./draft-confirmation.js";
import { buildWorkflowPerformance } from "./workflow-performance.js";
import type { DiscoveryTraceEntry, WorkflowRun } from "./types.js";

const now = "2026-10-02T03:00:00Z";
const run = (id: string, entries: DiscoveryTraceEntry[], at = "2026-10-02T01:00:00Z"): WorkflowRun => ({
  id, createdAt: at, updatedAt: at, collectedAt: at, status: "ready", stage: "完成", windowHours: 24,
  sourceIds: [], scheduled: false, rawCount: entries.length, candidates: [], logs: [], discoveryTrace: entries,
});
const trace = (id: string, patch: Partial<DiscoveryTraceEntry> = {}): DiscoveryTraceEntry => ({
  rawId: id, url: "https://example.com/news", title: "真实新闻", sourceId: "source:one", stage: "candidate",
  publishedAt: "2026-10-02T00:00:00Z", observedAt: "2026-10-02T01:00:00Z", dateBasis: "feed-published", ...patch,
});

test("discovery statistics separate actual failures, repeated polls, duplicates and unknown dates without mutating data", () => {
  const state = createDefaultState();
  state.runs = [run("first", [trace("one"), trace("dup", { stage: "duplicate-url" }), trace("index", { url: "https://example.com/index", dateBasis: "news-index" }), trace("missing", { url: "https://example.com/missing", sourceId: undefined, publishedAt: undefined })]),
    run("later", [trace("repeat", { publishedAt: "2026-10-02T01:59:00Z", observedAt: "2026-10-02T02:00:00Z" })], "2026-10-02T02:00:00Z")];
  state.runs[0]!.sourceResults = [{ sourceId: "source:one", sourceName: "来源一", status: "warning", healthImpact: "success", rawCount: 3, candidateCount: 1, detail: "部分路线失败", routes: [{ sourceId: "source:one", url: "https://example.com/feed", status: "error", rawCount: 0 }] }];
  state.runs[1]!.sourceResults = [{ sourceId: "source:one", sourceName: "来源一", status: "error", healthImpact: "failure", rawCount: 0, candidateCount: 0, detail: "连接失败" }];
  const before = JSON.stringify(state);
  const report = buildWorkflowPerformance(state, { now, benchmarkUrls: ["https://example.com/news?utm_source=test", "https://example.com/unseen"] });
  assert.equal(JSON.stringify(state), before);
  assert.equal(report.discovery.observedRows, 5);
  assert.equal(report.discovery.priorRunRepeats, 1);
  assert.equal(report.discovery.unattributedRows, 1);
  assert.equal(report.discovery.unknownDateRows, 2);
  assert.deepEqual(report.discovery.latency, { samples: 1, medianMs: 3_600_000, p95Ms: 3_600_000 });
  const source = report.discovery.sources[0]!;
  assert.equal(source.failedAttempts, 1); assert.equal(source.partialAttempts, 1); assert.equal(source.failureRate, 0.5);
  assert.equal(source.duplicateRows, 1); assert.equal(source.duplicateRowRate, 0.25);
  assert.equal(report.discovery.benchmark.recorded, 1);
  assert.equal(report.discovery.liveMissRate, null);
});

test("missing old trace records stay unmeasured, and distinct official changelog anchors remain distinct events", () => {
  const state = createDefaultState();
  const old = run("legacy", []); delete old.discoveryTrace;
  state.runs = [old, run("updates", [trace("a", { url: "https://api-docs.deepseek.com/updates/#2026-10-01" }), trace("b", { url: "https://api-docs.deepseek.com/updates/#2026-10-02" })])];
  const report = buildWorkflowPerformance(state, { now });
  assert.equal(report.discovery.runsWithTrace, 1);
  assert.equal(report.discovery.uniqueUrls, 2);
  assert.equal(report.discovery.sources[0]!.failureRate, null);
  assert.equal(buildWorkflowPerformance(createDefaultState(), { now }).drafts.medianInitialParagraphRetention, null);
});

test("first-draft edit metrics use a real unassisted confirmation and preserve ordered duplicate paragraphs", () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state);
  draft.provenance.authoringMode = "ai-generated";
  draft.title = "初稿"; draft.bodyHtml = "<p>第一段</p><p>第一段</p><p>最后段</p>";
  draft.editorialBaseline = { initial: { snapshot: snapshotDraft(draft), capturedAt: "2026-10-02T00:00:00Z", origin: "initial" } };
  appendDraftRevision(state, draft, "initial");
  draft.title = "定稿"; draft.bodyHtml = "<p>第一段</p><p>修改后的第二段</p><p>最后段</p>";
  confirmDraftInState(state, draft, draft.updatedAt, new Date("2026-10-02T02:00:00Z"));
  const report = buildWorkflowPerformance(state, { now });
  assert.equal(report.drafts.confirmedManualSamples, 1);
  assert.equal(report.drafts.samples[0]!.titleChanged, true);
  assert.equal(report.drafts.samples[0]!.retainedParagraphs, 2);
  assert.equal(report.drafts.medianInitialParagraphRetention, 2 / 3);
  draft.editorialBaseline.confirmed!.learningEligible = false;
  assert.equal(buildWorkflowPerformance(state, { now }).drafts.confirmedManualSamples, 0);
  draft.editorialBaseline.confirmed!.learningEligible = true;
  confirmDraftInState(state, Object.assign(draft, { title: "再次确认" }), draft.updatedAt, new Date("2026-10-02T02:30:00Z"));
  assert.equal(buildWorkflowPerformance(state, { now }).drafts.exclusions["first-confirmation-eligibility-unavailable"], 1);
});

test("later successful retries cannot turn a blocked first generation into a successful first attempt", () => {
  const state = createDefaultState(), draft = createBlankDraftInState(state);
  state.draftGenerationAttempts = ["blocked", "accepted"].map((status, index) => ({ id: `attempt-${index}`, contentPackageId: "same-package", storyId: "story", draftId: draft.id,
    createdAt: `2026-10-02T0${index}:00:00Z`, completedAt: `2026-10-02T0${index}:01:00Z`, generatorRevision: "test", status: status as "blocked" | "accepted", draft,
    qualityReport: { ready: status === "accepted", blockers: [], warnings: [] } }));
  const report = buildWorkflowPerformance(state, { now });
  assert.equal(report.drafts.generationAttempts, 2); assert.equal(report.drafts.firstAttempts, 1);
  assert.deepEqual(report.drafts.firstAttemptOutcomes, { accepted: 0, warning: 0, blocked: 1 });
  state.draftGenerationAttempts[0]!.createdAt = "2026-08-01T00:00:00Z";
  state.draftGenerationAttempts[0]!.completedAt = "2026-08-01T00:01:00Z";
  assert.equal(buildWorkflowPerformance(state, { now }).drafts.firstAttempts, 0);
});
