import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalDatabase } from "./local-database.js";

const withDatabase = async (run: (root: string, store: LocalDatabase) => Promise<void>) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-desk-db-"));
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify({ version: 11, marker: "legacy" }), "utf8");
  const store = await LocalDatabase.open({
    workflowRoot: root,
    legacyStatePath,
    initialState: () => ({ version: 11, marker: "default" }),
    now: () => "2026-08-30T00:00:00.000Z",
  });
  try {
    await run(root, store);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
};

test("SQLite imports legacy state once and keeps a recoverable migration snapshot", async () => {
  await withDatabase(async (root, store) => {
    assert.deepEqual(store.readState(), { version: 11, marker: "legacy" });
    const backup = JSON.parse(await readFile(path.join(root, "backups", "state-before-sqlite-v2.json"), "utf8"));
    assert.equal(backup.marker, "legacy");

    store.writeState({ version: 11, marker: "sqlite" });
    assert.deepEqual(store.readState(), { version: 11, marker: "sqlite" });
    assert.equal(JSON.parse(await readFile(path.join(root, "state.json"), "utf8")).marker, "legacy");
  });
});

test("durable jobs are idempotent and feedback events remain append-only", async () => {
  await withDatabase(async (_root, store) => {
    const first = store.enqueueJob({ type: "collect", idempotencyKey: "daily:2026-08-30", payload: { topic: "ai" } });
    const second = store.enqueueJob({ type: "collect", idempotencyKey: "daily:2026-08-30", payload: { topic: "technology" } });
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.job.id, first.job.id);
    assert.equal(store.listJobs().length, 1);

    const claimed = store.claimNextJob({ workerId: "test-worker" });
    assert.equal(claimed?.status, "running");
    assert.equal(claimed?.attempts, 1);
    store.updateJobProgress(first.job.id, "test-worker", 0.5);
    const completed = store.completeJob(first.job.id, "test-worker", { count: 3 });
    assert.equal(completed.status, "complete");
    assert.deepEqual(completed.result, { count: 3 });

    store.recordFeedback({ type: "opened", subjectType: "story", subjectId: "story-1" });
    store.recordFeedback({ type: "drafted", subjectType: "story", subjectId: "story-1" });
    assert.deepEqual(store.listFeedback("story", "story-1").map((event) => event.type), ["drafted", "opened"]);
  });
});

test("content packages are durable and addressable by both package and story", async () => {
  await withDatabase(async (_root, store) => {
    const contentPackage = {
      id: "package-1",
      storyId: "story-1",
      mode: "brief",
      createdAt: "2026-08-30T00:00:00.000Z",
      facts: [{ id: "claim-1", text: "事实" }],
    };
    store.saveContentPackage(contentPackage);
    assert.deepEqual(store.getContentPackage("package-1"), contentPackage);
    assert.deepEqual(store.latestContentPackageForStory("story-1"), contentPackage);
  });
});

test("editorial memory evidence is idempotent and can be disabled or deleted", async () => {
  await withDatabase(async (_root, store) => {
    const input = {
      kind: "shorter-introduction",
      label: "缩短导语",
      eventId: "edit-1",
      draftId: "draft-1",
      summary: "首段由 120 字缩短到 60 字。",
    };
    store.recordEditorialMemoryEvidence(input);
    store.recordEditorialMemoryEvidence(input);
    const memory = store.listEditorialMemories()[0];
    assert.equal(memory?.evidenceCount, 1);
    assert.equal(memory?.enabled, true);
    assert.equal(store.setEditorialMemoryEnabled(memory!.id, false)?.enabled, false);
    assert.equal(store.deleteEditorialMemory(memory!.id), true);
    assert.deepEqual(store.listEditorialMemories(), []);
  });
});

test("queued jobs can be cancelled and interrupted running jobs recover immediately on startup", async () => {
  await withDatabase(async (_root, store) => {
    const cancelled = store.enqueueJob({ type: "collect-run", idempotencyKey: "collect-run:cancel", payload: { runId: "cancel" } }).job;
    assert.equal(store.cancelQueuedJob("collect-run:cancel")?.status, "cancelled");
    assert.equal(store.getJob(cancelled.id)?.status, "cancelled");

    const resumable = store.enqueueJob({ type: "collect-run", idempotencyKey: "collect-run:resume", payload: { runId: "resume" } }).job;
    assert.equal(store.claimNextJob({ workerId: "old-process", leaseMs: 60_000 })?.id, resumable.id);
    assert.equal(store.recoverRunningJobs(), 1);
    const recovered = store.getJob(resumable.id);
    assert.equal(recovered?.status, "retrying");
    assert.equal(recovered?.leaseOwner, undefined);
    assert.equal(store.claimNextJob({ workerId: "new-process" })?.id, resumable.id);
  });
});

test("operational retention keeps active work and only the newest terminal history", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-desk-retention-db-"));
  let currentTime = "2026-08-27T00:00:00.000Z";
  const store = await LocalDatabase.open({
    workflowRoot: root,
    initialState: () => ({ version: 11 }),
    now: () => currentTime,
  });
  try {
    for (let index = 0; index < 3; index += 1) {
      currentTime = `2026-08-${27 + index}T00:00:00.000Z`;
      const job = store.enqueueJob({
        type: "collect",
        idempotencyKey: `terminal-${index}`,
        payload: { index },
      }).job;
      store.claimNextJob({ workerId: "retention-test" });
      store.completeJob(job.id, "retention-test");
      store.recordWorkflowEvent({
        type: "completed",
        subjectType: "run",
        subjectId: `run-${index}`,
      });
    }
    currentTime = "2026-08-30T00:00:00.000Z";
    store.enqueueJob({ type: "collect", idempotencyKey: "active", payload: {} });

    const removed = store.pruneOperationalHistory({
      terminalJobsOlderThan: "2026-01-01T00:00:00.000Z",
      workflowEventsOlderThan: "2026-01-01T00:00:00.000Z",
      maxTerminalJobs: 1,
      maxWorkflowEvents: 1,
    });

    assert.deepEqual(removed, { terminalJobs: 2, workflowEvents: 2 });
    assert.deepEqual(store.listJobs().map((job) => job.idempotencyKey).sort(), ["active", "terminal-2"]);
    assert.deepEqual(store.listWorkflowEvents().map((event) => event.subjectId), ["run-2"]);
  } finally {
    store.close();
    await rm(root, { recursive: true, force: true });
  }
});
