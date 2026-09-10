import type { LocalDatabase } from "./local-database.js";

/** Retrying source preparation never invokes draft delivery or publication. */
export const retryPackageJob = (database: LocalDatabase, jobId: string, storyTitle?: string) => {
  const failed = database.getJob(jobId);
  if (!failed || failed.status !== "failed" || !["build-content-package", "draft-from-package", "draft-from-editorial-intake", "draft-from-intake-review", "explain-story", "hydrate-story-assets", "supplement-story-evidence"].includes(failed.type)) throw new Error("这个任务不能从这里重试");
  if (!failed.payload || typeof failed.payload !== "object") throw new Error("任务缺少原选题");
  return database.enqueueJob({ type: failed.type, idempotencyKey: `recovery:${failed.id}`,
    payload: { ...failed.payload, ...(storyTitle ? { storyTitle } : {}), retryOf: failed.id }, maxAttempts: 2 });
};
