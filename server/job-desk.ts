import { randomUUID } from "node:crypto";
import type { DurableJobRecord, LocalDatabase } from "./local-database.js";

export interface JobContext {
  job: DurableJobRecord;
  progress: (value: number, stage?: string) => void;
  heartbeat: (stage?: string) => void;
}

export type DurableJobHandler = (payload: unknown, context: JobContext) => Promise<unknown>;

export type JobFailureClass = "transient" | "repairable" | "deterministic";

export class ClassifiedJobError extends Error {
  constructor(
    message: string,
    readonly failureClass: JobFailureClass,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ClassifiedJobError";
  }
}

const failureClassFor = (error: unknown): JobFailureClass =>
  error instanceof ClassifiedJobError ? error.failureClass : "transient";

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
  /** Prevent new leases while an exclusive workspace operation is active. */
  canClaim?: () => boolean;
  onError?: (error: unknown) => void;
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
  canClaim = () => true,
  onError = (error) => console.error("JobDesk polling failed", error),
}: JobDeskOptions) => {
  const workerId = `worker_${process.pid}_${randomUUID().slice(0, 8)}`;
  const maxConcurrency = Math.max(1, Math.min(4, Math.floor(concurrency)));
  let activeJobs = 0;
  let activeBackgroundJobs = 0;
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (activeJobs >= maxConcurrency || stopped || !canClaim()) return;
    activeJobs += 1;
    let background = false;
    try {
      const job = database.claimNextJob({ workerId, types: Object.keys(handlers), leaseMs, foregroundOnly: maxConcurrency > 1 && activeBackgroundJobs >= maxConcurrency - 1 });
      if (!job) return;
      background = job.lane === "background";
      if (background) activeBackgroundJobs += 1;
      const handler = handlers[job.type];
      if (!handler) {
        database.failJob(job.id, workerId, `没有注册任务处理器：${job.type}`, 60_000, false);
        return;
      }
      database.recordWorkflowEvent({
        type: "job.running",
        subjectType: "job",
        subjectId: job.id,
        payload: { jobType: job.type, attempt: job.attempts },
      });
      try {
        const heartbeatTimer = setInterval(() => {
          try {
            database.heartbeatJob(job.id, workerId, undefined, leaseMs);
          } catch {
            // Completion or lease recovery can race one final timer tick.
          }
        }, Math.max(5_000, Math.min(15_000, Math.floor(leaseMs / 3))));
        heartbeatTimer.unref();
        let result: unknown;
        try {
          result = await handler(job.payload, {
            job,
            progress: (value, stage) => database.updateJobProgress(job.id, workerId, value, stage, leaseMs),
            heartbeat: (stage) => database.heartbeatJob(job.id, workerId, stage, leaseMs),
          });
        } finally {
          clearInterval(heartbeatTimer);
        }
        database.completeJob(job.id, workerId, result);
        database.recordWorkflowEvent({
          type: "job.complete",
          subjectType: "job",
          subjectId: job.id,
          payload: { jobType: job.type, result },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failureClass = failureClassFor(error);
        const delay = Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, job.attempts - 1));
        const failed = database.failJob(job.id, workerId, message, delay, failureClass === "transient");
        database.recordWorkflowEvent({
          type: failed.status === "failed" ? "job.failed" : "job.retrying",
          subjectType: "job",
          subjectId: job.id,
          payload: { jobType: job.type, attempt: failed.attempts, failureClass, error: message.slice(0, 1_000) },
        });
      }
    } finally {
      activeJobs -= 1;
      if (background) activeBackgroundJobs -= 1;
    }
  };

  return {
    workerId,
    start() {
      if (timer || stopped) return;
      void tick().catch(onError);
      timer = setInterval(() => void tick().catch(onError), Math.max(250, pollMs));
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
