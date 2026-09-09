import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LocalDatabase } from "./local-database.js";
import { retryPackageJob } from "./job-recovery.js";

test("recovery preserves the failed package job, original selection, and single-flight retry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-recovery-"));
  const database = await LocalDatabase.open({ workflowRoot: root, legacyStatePath: path.join(root, "state.json"), initialState: () => ({ version: 11 }) });
  try {
    const payload = { storyId: "original-story", mode: "brief", minimumImages: 2 };
    const original = database.enqueueJob({ type: "build-content-package", idempotencyKey: "original-package", payload }).job;
    database.claimNextJob({ workerId: "test" });
    database.failJob(original.id, "test", "HTTP 403", 0, false);
    const first = retryPackageJob(database, original.id);
    const second = retryPackageJob(database, original.id);
    assert.notEqual(first.job.id, original.id);
    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(second.job.id, first.job.id);
    assert.deepEqual(first.job.payload, { ...payload, retryOf: original.id });
    assert.equal(database.getJob(original.id)?.status, "failed");
    assert.equal(database.getJob(original.id)?.error, "HTTP 403");
    assert.throws(() => retryPackageJob(database, first.job.id), /不能/u);
    const publication = database.enqueueJob({ type: "publish", idempotencyKey: "publication", payload }).job;
    assert.throws(() => retryPackageJob(database, publication.id), /不能/u);
    assert.equal(database.listJobs().filter((job) => job.type === "build-content-package").length, 2);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});
