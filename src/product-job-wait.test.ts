import test from "node:test";
import assert from "node:assert/strict";
import { waitForProductJob } from "./product-job-wait";
import type { ProductJob } from "./api";

test("ending a foreground wait preserves the durable job identity and running state", async () => {
  const job = { id: "same-job", status: "running" } as ProductJob;
  const ids: string[] = [];
  const result = await waitForProductJob(job, { attempts: 2, wait: async () => {}, read: async (id) => { ids.push(id); return job; } });
  assert.equal(result.deferred, true);
  assert.equal(result.job, job);
  assert.deepEqual(ids, ["same-job", "same-job"]);
  const recovered = await waitForProductJob(job, { wait: async () => {}, read: async () => ({ ...job, status: "complete", result: { draftId: "one-draft" } }) });
  assert.equal(recovered.deferred, false);
  assert.equal(recovered.job.id, job.id);
});
