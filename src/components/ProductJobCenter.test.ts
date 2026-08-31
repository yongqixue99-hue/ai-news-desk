import assert from "node:assert/strict";
import test from "node:test";
import type { ProductJob } from "../api.js";
import { jobActivitySummary, jobProgressPercent } from "./ProductJobCenter.js";

test("job progress converts the persisted zero-to-one fraction into a user-facing percentage", () => {
  assert.equal(jobProgressPercent(0), 0);
  assert.equal(jobProgressPercent(0.96), 96);
  assert.equal(jobProgressPercent(1), 100);
});

test("active job summary exposes the real stage, elapsed time and stale heartbeat", () => {
  const job: ProductJob = {
    id: "job-1",
    type: "draft-from-package",
    idempotencyKey: "package-1:draft",
    status: "running",
    payload: {},
    progress: 0.38,
    stage: "模型生成中",
    heartbeatAt: "2026-08-31T12:00:30.000Z",
    attempts: 1,
    maxAttempts: 3,
    createdAt: "2026-08-31T11:58:00.000Z",
    updatedAt: "2026-08-31T12:00:30.000Z",
  };

  assert.deepEqual(jobActivitySummary(job, Date.parse("2026-08-31T12:00:40.000Z")), {
    stage: "模型生成中",
    elapsed: "已运行 2 分钟",
    freshness: "刚刚有响应",
    stale: false,
  });
  assert.deepEqual(jobActivitySummary(job, Date.parse("2026-08-31T12:02:00.000Z")), {
    stage: "模型生成中",
    elapsed: "已运行 4 分钟",
    freshness: "超过 1 分钟没有响应，可能已中断",
    stale: true,
  });
});
