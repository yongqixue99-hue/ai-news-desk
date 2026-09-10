import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ClassifiedJobError, createJobDesk } from "./job-desk.js";
import { LocalDatabase } from "./local-database.js";

test("JobDesk executes a persisted job and records durable progress", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-job-desk-"));
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify({ version: 11 }), "utf8");
  const database = await LocalDatabase.open({
    workflowRoot: root,
    legacyStatePath,
    initialState: () => ({ version: 11 }),
  });
  try {
    const queued = database.enqueueJob({
      type: "package",
      idempotencyKey: "story-1:brief",
      payload: { storyId: "story-1" },
    }).job;
    const desk = createJobDesk({
      database,
      handlers: {
        package: async (payload, context) => {
          context.progress(0.4, "正在采集正文");
          assert.deepEqual(payload, { storyId: "story-1" });
          return { packageId: "package-1" };
        },
      },
    });

    await desk.tick();

    const completed = database.getJob(queued.id);
    assert.equal(completed?.status, "complete");
    assert.equal(completed?.progress, 1);
    assert.equal(completed?.stage, "正在采集正文");
    assert.ok(completed?.heartbeatAt);
    assert.deepEqual(completed?.result, { packageId: "package-1" });
    assert.deepEqual(
      database.listWorkflowEvents(10).map((event) => event.type),
      ["job.complete", "job.running"],
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("JobDesk can run an interactive job while a long job is still active", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-job-desk-concurrency-"));
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify({ version: 11 }), "utf8");
  const database = await LocalDatabase.open({
    workflowRoot: root,
    legacyStatePath,
    initialState: () => ({ version: 11 }),
  });
  try {
    const slow = database.enqueueJob({
      type: "slow",
      idempotencyKey: "slow-1",
      payload: {},
    }).job;
    const interactive = database.enqueueJob({
      type: "interactive",
      idempotencyKey: "interactive-1",
      payload: {},
    }).job;
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const desk = createJobDesk({
      database,
      concurrency: 2,
      handlers: {
        slow: async () => {
          await slowGate;
          return { done: true };
        },
        interactive: async () => ({ opened: true }),
      },
    });

    const slowTick = desk.tick();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await desk.tick();

    assert.equal(database.getJob(slow.id)?.status, "running");
    assert.equal(database.getJob(interactive.id)?.status, "complete");
    releaseSlow();
    await slowTick;
    assert.equal(database.getJob(slow.id)?.status, "complete");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("JobDesk reports polling failures instead of leaking an unhandled rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-job-desk-errors-"));
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify({ version: 11 }), "utf8");
  const database = await LocalDatabase.open({
    workflowRoot: root,
    legacyStatePath,
    initialState: () => ({ version: 11 }),
  });
  try {
    const originalClaim = database.claimNextJob.bind(database);
    let shouldFail = true;
    database.claimNextJob = (input) => {
      if (shouldFail) {
        shouldFail = false;
        throw new Error("database temporarily unavailable");
      }
      return originalClaim(input);
    };
    const errors: string[] = [];
    const desk = createJobDesk({
      database,
      handlers: { noop: async () => ({ ok: true }) },
      onError: (error) => errors.push(error instanceof Error ? error.message : String(error)),
    });

    desk.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    desk.stop();

    assert.deepEqual(errors, ["database temporarily unavailable"]);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("JobDesk does not claim queued work while workspace maintenance is active", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-job-desk-maintenance-"));
  const database = await LocalDatabase.open({
    workflowRoot: root,
    initialState: () => ({ version: 11 }),
  });
  try {
    const queued = database.enqueueJob({ type: "noop", idempotencyKey: "maintenance", payload: {} }).job;
    let maintenanceActive = true;
    const desk = createJobDesk({
      database,
      canClaim: () => !maintenanceActive,
      handlers: { noop: async () => ({ ok: true }) },
    });

    await desk.tick();
    assert.equal(database.getJob(queued.id)?.status, "queued");
    maintenanceActive = false;
    await desk.tick();
    assert.equal(database.getJob(queued.id)?.status, "complete");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("JobDesk stops after one deterministic failure instead of scheduling identical retries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-job-desk-deterministic-"));
  const database = await LocalDatabase.open({
    workflowRoot: root,
    initialState: () => ({ version: 11 }),
  });
  try {
    const queued = database.enqueueJob({
      type: "draft",
      idempotencyKey: "package-1:draft",
      payload: { packageId: "package-1" },
      maxAttempts: 3,
    }).job;
    let calls = 0;
    const desk = createJobDesk({
      database,
      handlers: {
        draft: async () => {
          calls += 1;
          throw new ClassifiedJobError("草稿质量门未通过", "deterministic");
        },
      },
    });

    await desk.tick();
    await desk.tick();

    const failed = database.getJob(queued.id);
    assert.equal(calls, 1);
    assert.equal(failed?.status, "failed");
    assert.equal(failed?.attempts, 1);
    assert.equal(failed?.nextAttemptAt, undefined);
    const latestPayload = database.listWorkflowEvents(10)[0]?.payload as { failureClass?: string } | undefined;
    assert.equal(latestPayload?.failureClass, "deterministic");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("maintenance cannot occupy the capacity reserved for a later user task", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-priority-"));
  const database = await LocalDatabase.open({ workflowRoot: root, initialState: () => ({ version: 11 }) });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let first: Promise<void> | undefined;
  const desk = createJobDesk({ database, concurrency: 2, handlers: { background: async () => gate, foreground: async () => ({ done: true }) } });
  try {
    database.enqueueJob({ type: "background", idempotencyKey: "bg-1", payload: {}, lane: "background" });
    const second = database.enqueueJob({ type: "background", idempotencyKey: "bg-2", payload: {}, lane: "background" }).job;
    first = desk.tick();
    await desk.tick();
    assert.equal(database.getJob(second.id)?.status, "queued");
    const user = database.enqueueJob({ type: "foreground", idempotencyKey: "user", payload: {} }).job;
    await desk.tick();
    assert.equal(database.getJob(user.id)?.status, "complete");
    assert.equal(database.getJob(second.id)?.status, "queued");
  } finally { release(); await first; desk.stop(); database.close(); await rm(root, { recursive: true, force: true }); }
});
