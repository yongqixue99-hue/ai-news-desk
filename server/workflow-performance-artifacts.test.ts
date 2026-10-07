import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { artifactFixture, seedSchema6 } from "./run-artifact-fixture.js";

test("the read-only performance CLI still includes migrated discovery traces", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-artifact-report-"));
  const state = artifactFixture(); const now = new Date().toISOString();
  Object.assign(state.runs[0]!, { createdAt: now, collectedAt: now, updatedAt: now });
  await seedSchema6(root, state);
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ["--import", "tsx", path.resolve("server/workflow-performance-cli.ts")], {
      env: { ...process.env, AI_NEWS_DESK_WORKFLOW_ROOT: root }, timeout: 10_000,
    });
    const report = JSON.parse(stdout);
    assert.equal(report.discovery.runs, 1); assert.equal(report.discovery.runsWithTrace, 1); assert.equal(report.discovery.observedRows, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
