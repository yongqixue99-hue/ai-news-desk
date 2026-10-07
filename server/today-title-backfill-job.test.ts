import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { LocalDatabase } from "./local-database.js";
import { createJobDesk } from "./job-desk.js";
import { buildTodayView } from "./story-desk.js";
import { createTodayTitleBackfill, enqueueTodayTitleBackfill } from "./today-title-backfill.js";
import type { WorkflowRun, Candidate } from "./types.js";
import type { TodayView } from "./product-types.js";

const run = (purpose?: WorkflowRun["collectionPurpose"]): WorkflowRun => ({
  id: "run", status: "ready", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  stage: "完成", windowHours: 24, sourceIds: [], candidates: [], rawCount: 0, logs: [], scheduled: false,
  collectionPurpose: purpose,
});
const isolated = async (action: (db: LocalDatabase, root: string) => Promise<void>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "today-title-job-"));
  const db = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
  try { await action(db, root); } finally { db.close(); await rm(root, { recursive: true, force: true }); }
};

test("successful daily and official collections queue one persistent background job each", async () => {
  await isolated(async db => {
    const daily = run(), official = { ...run("official-monitor"), id: "official" };
    for (const completed of [daily, official, daily, official]) enqueueTodayTitleBackfill(db, completed, () => true);
    const jobs = db.listJobs(100);
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every(job => job.lane === "background" && job.type === "backfill-today-titles" && job.maxAttempts === 1));
    assert.deepEqual(new Set(jobs.map(job => job.idempotencyKey)), new Set(["backfill-today-titles:run", "backfill-today-titles:official"]));
    const queued = jobs[0]!;
    const claimed = db.claimNextJob({ workerId: "test", types: [queued.type], leaseMs: 10_000 })!;
    db.failJob(claimed.id, "test", "synthetic failure", 0, false);
    enqueueTodayTitleBackfill(db, { ...daily, id: (claimed.payload as { runId: string }).runId }, () => true);
    assert.equal(db.listJobs(100).length, 2);
    assert.equal(db.getJob(claimed.id)?.status, "failed");
  });
});

test("disabled, aggregation and unfinished collection paths enqueue nothing", async () => {
  await isolated(async db => {
    enqueueTodayTitleBackfill(db, run(), () => false);
    enqueueTodayTitleBackfill(db, run("aggregation"), () => true);
    enqueueTodayTitleBackfill(db, { ...run(), status: "failed" }, () => true);
    assert.equal(db.listJobs().length, 0);
    const backfill = createTodayTitleBackfill({ enabled: () => false,
      readView: async () => { throw new Error("must not read"); }, enrich: async () => { throw new Error("must not call provider"); } });
    assert.deepEqual(await backfill(), { requested: 0, completed: 0, failed: 0 });
  });
});

test("enqueue failure is logged without failing the already completed collection", () => {
  const events: unknown[] = [];
  const broken = { getJobByIdempotencyKey: () => undefined,
    enqueueJob: () => { throw new Error("synthetic SQLite failure"); }, recordWorkflowEvent: (event: unknown) => { events.push(event); } };
  assert.doesNotThrow(() => enqueueTodayTitleBackfill(broken as unknown as LocalDatabase, run(), () => true));
  assert.equal(events.length, 1);
  assert.equal((events[0] as { type: string }).type, "today-titles.enqueue-failed");
});

test("page and background share a single flight capped at twelve candidates", async () => {
  const stories = Array.from({ length: 30 }, (_, index) => ({ id: String(index), title: `English ${index}`, originalTitle: `English ${index}`,
    signals: [{ runId: "run", candidateId: String(index), title: `English ${index}`, isCommunity: false }] }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0, count = 0;
  const backfill = createTodayTitleBackfill({ enabled: () => true,
    readView: async () => ({ mustReads: stories, secondary: [] }) as unknown as TodayView,
    enrich: async (_runId, options) => { calls++; count = options.candidateIds.length; await gate; return { requested: count, completed: count, failed: 0 }; } });
  const page = backfill(), background = backfill();
  release();
  assert.deepEqual(await page, { requested: 12, completed: 12, failed: 0 });
  assert.deepEqual(await background, await page);
  assert.equal(calls, 1); assert.equal(count, 12);
});

test("provider failure reports bounded counts and cancellation remains cancellation", async () => {
  const view = { mustReads: [{ id: "s", title: "English", originalTitle: "English", signals: [{ runId: "run", candidateId: "c", title: "English", isCommunity: false }] }], secondary: [] } as unknown as TodayView;
  const backfill = createTodayTitleBackfill({ enabled: () => true, readView: async () => view,
    enrich: async () => { throw new Error("synthetic provider failure"); } });
  assert.deepEqual(await backfill(), { requested: 1, completed: 0, failed: 1 });
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  await assert.rejects(backfill(controller.signal), /cancelled/u);
});

test("headless persisted job makes Today's headline Chinese without changing the original", async () => {
  await isolated(async (db, root) => {
    const state = createDefaultState();
    const completed = run("official-monitor");
    const candidate: Candidate = { id: "c", rawId: "c", title: "Acme releases Model 3.5", sourceType: "rss", sourceName: "Example official", sourceRole: "official",
      url: "https://example.com/model", excerpt: "Weights are available for local use.", publishedAt: completed.createdAt, fetchedAt: completed.createdAt,
      score: 13, scoreBreakdown: { consequence: 3, novelty: 3, evidence: 3, relevance: 2, timeliness: 2, confirmation: 0, penalty: 0 },
      heatScore: 0, heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 }, recommendationScore: 80,
      clusterSize: 1, relatedSources: ["Example official"], evidence: "一手线索", imageCount: 0, images: [], selected: false, status: "candidate", topicIds: ["ai"] };
    completed.candidates.push(candidate); state.runs.push(completed);
    assert.equal(buildTodayView(state).radar?.[0]?.title, candidate.title);
    enqueueTodayTitleBackfill(db, completed, () => true);
    const reopened = await LocalDatabase.open({ workflowRoot: root, initialState: createDefaultState });
    let providerCalls = 0;
    const backfill = createTodayTitleBackfill({ enabled: () => true, readView: async () => buildTodayView(state),
      enrich: async (_runId, options) => {
        providerCalls++; assert.deepEqual(options.candidateIds, ["c"]);
        candidate.briefing = { titleZh: "示例模型开放本地运行", summaryZh: "权重可下载后在本地运行。", basis: "title", generatedAt: completed.createdAt, providerId: "example-only" };
        return { requested: 1, completed: 1, failed: 0 };
      } });
    try {
      await createJobDesk({ database: reopened, handlers: { "backfill-today-titles": (_payload, context) => backfill(context.signal) } }).tick();
      assert.equal(buildTodayView(state).radar?.[0]?.title, "示例模型开放本地运行");
      assert.equal(buildTodayView(state).radar?.[0]?.story?.originalTitle, "Acme releases Model 3.5");
      assert.equal(candidate.title, "Acme releases Model 3.5");
      assert.equal(providerCalls, 1);
      assert.equal(reopened.listJobs()[0]?.status, "complete");
      assert.deepEqual(await backfill(), { requested: 0, completed: 0, failed: 0 });
      assert.equal(providerCalls, 1);
    } finally { reopened.close(); }
  });
});
