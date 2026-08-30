import { randomUUID } from "node:crypto";
import type { DurableJobRecord, LocalDatabase } from "./local-database.js";

export interface JobContext {
  job: DurableJobRecord;
  progress: (value: number) => void;
}

export type DurableJobHandler = (payload: unknown, context: JobContext) => Promise<unknown>;

export interface JobDeskOptions {
  database: LocalDatabase;
  handlers: Record<string, DurableJobHandler>;
  pollMs?: number;
  leaseMs?: number;
  /**
   * A small amount of concurrency keeps short, interactive work (for example
   * opening a Story brief) from waiting behind a long article generation.
   */
  concurrency?: number;
}

/**
 * JobDesk is the process-independent execution boundary for slow work. SQLite
 * owns idempotency, attempts and leases; handlers only implement one operation.
 * An expired lease is automatically retried after a crash or forced restart.
 */
export const createJobDesk = ({
  database,
  handlers,
  pollMs = 1_000,
  leaseMs = 10 * 60_000,
  concurrency = 1,
}: JobDeskOptions) => {
  const workerId = `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
  const maxConcurrency = Math.max(1, Math.min(4, Math.floor(concurrency)));
  let activeJobs = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (activeJobs >= maxConcurrency || stopped) return;
    activeJobs += 1;
    try {
      const job = database.claimNextJob({ workerId, types: Object.keys(handlers), leaseMs });
      if (!job) return;
      const handler = handlers[job.type];
      if (!handler) {
        database.failJob(job.id, workerId, `没有注册任务处理器：${job.type}`, 60_000);
        return;
      }
      database.recordWorkflowEvent({
        type: "job.running",
        subjectType: "job",
        subjectId: job.id,
        payload: { jobType: job.type, attempt: job.attempts },
      });
      try {
        const result = await handler(job.payload, {
          job,
          progress: (value) => database.updateJobProgress(job.id, workerId, value),
        });
        database.completeJob(job.id, workerId, result);
        database.recordWorkflowEvent({
          type: "job.complete",
          subjectType: "job",
          subjectId: job.id,
          payload: { jobType: job.type, result },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const delay = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, job.attempts - 1));
        const failed = database.failJob(job.id, workerId, message, delay);
        database.recordWorkflowEvent({
          type: failed.status === "failed" ? "job.failed" : "job.retrying",
          subjectType: "job",
          subjectId: job.id,
          payload: { jobType: job.type, attempt: failed.attempts, error: message.slice(0, 1_000) },
        });
      }
    } finally {
      activeJobs -= 1;
    }
  };

  return {
    workerId,
    start() {
      if (timer || stopped) return;
      void tick();
      timer = setInterval(() => void tick(), Math.max(250, pollMs));
      timer.unref();
    },
    stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
};
