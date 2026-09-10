import type { ProductJob } from "./api";

export const isActiveProductJob = (job: ProductJob) => ["queued", "running", "retrying"].includes(job.status);

/** A UI wait budget never changes, cancels or retries the durable job. */
export const waitForProductJob = async (job: ProductJob, options: {
  read: (id: string) => Promise<ProductJob>;
  wait?: () => Promise<void>;
  attempts?: number;
  current?: () => boolean;
}) => {
  let latest = job;
  for (let attempt = 0; attempt < (options.attempts ?? 150) && isActiveProductJob(latest); attempt += 1) {
    if (options.current && !options.current()) break;
    await (options.wait?.() ?? new Promise((resolve) => setTimeout(resolve, 1_000)));
    if (options.current && !options.current()) break;
    latest = await options.read(latest.id);
  }
  return { job: latest, deferred: isActiveProductJob(latest) };
};

export const deferredJobMessage = (job: ProductJob) => `任务仍在${job.status === "queued" ? "排队" : "后台处理"}，可以继续使用；刷新后可在“任务进度”查看同一任务（${job.id.slice(-8)}）。`;
