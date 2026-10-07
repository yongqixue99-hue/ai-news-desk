import { randomUUID } from "node:crypto";
import type { DurableJobRecord, LocalDatabase } from "./local-database.js";

export interface JobContext {
  job: DurableJobRecord;
  signal: AbortSignal;
  throwIfAborted: () => void;
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
  /** A lease heartbeat does not reset these business-progress deadlines. */
  progressTimeoutMs?: number;
  totalTimeoutMs?: number;
  watchdogMs?: number;
  /**
   * A watchdog tick arriving this late means the process was suspended (the
   * computer slept), not that the handler stalled; that gap is not counted.
   */
  suspendGapMs?: number;
  now?: () => number;
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
  progressTimeoutMs = 15 * 60_000,
  totalTimeoutMs = 45 * 60_000,
  watchdogMs = 5_000,
  suspendGapMs = 30_000,
  now = Date.now,
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
        const controller = new AbortController();
        let startedAt = now();
        let progressedAt = startedAt;
        let watchedAt = startedAt;
        let lastProgress = job.progress;
        let lastStage = job.stage || "启动任务";
        const assertActive = () => {
          controller.signal.throwIfAborted();
          const current = database.getJob(job.id);
          if (current?.status !== "running" || current.leaseOwner !== workerId) {
            controller.abort(new ClassifiedJobError("任务已取消或租约失效，已停止后续处理", "repairable"));
            controller.signal.throwIfAborted();
          }
        };
        const recordProgress = (value?: number, stage?: string) => {
          const nextStage = stage?.trim() || lastStage;
          const nextProgress = value === undefined ? lastProgress : Math.max(0, Math.min(1, value));
          if (nextStage !== lastStage || nextProgress > lastProgress) progressedAt = now();
          lastStage = nextStage;
          lastProgress = nextProgress;
        };
        const watchdog = setInterval(() => {
          if (controller.signal.aborted) return;
          try {
            assertActive();
            const timestamp = now();
            const suspendedMs = timestamp - watchedAt - Math.max(5, watchdogMs);
            watchedAt = timestamp;
            if (suspendedMs >= Math.max(1, suspendGapMs)) {
              startedAt += suspendedMs;
              progressedAt += suspendedMs;
              database.recordWorkflowEvent({ type: "job.suspended", subjectType: "job", subjectId: job.id,
                payload: { jobType: job.type, suspendedMs, stage: lastStage } });
            }
            const idle = timestamp - progressedAt >= Math.max(1, progressTimeoutMs);
            const expired = timestamp - startedAt >= Math.max(1, totalTimeoutMs);
            if (!idle && !expired) return;
            const error = new ClassifiedJobError(expired
              ? `任务超过处理时限，已停止在“${lastStage}”；已保存的材料仍保留，可从原任务恢复`
              : `“${lastStage}”长时间没有实际进展，已停止等待；已保存的材料仍保留，可从原任务恢复`, "repairable");
            // No automatic retry while an old handler may still be unwinding.
            database.failJob(job.id, workerId, error.message, 0, false);
            database.recordWorkflowEvent({ type: "job.failed", subjectType: "job", subjectId: job.id,
              payload: { jobType: job.type, failureClass: "repairable", reason: expired ? "total-timeout" : "progress-timeout", stage: lastStage, error: error.message } });
            controller.abort(error);
          } catch (error) {
            if (!controller.signal.aborted) { controller.abort(error); onError(error); }
          }
        }, Math.max(5, watchdogMs));
        watchdog.unref();
        const heartbeatTimer = setInterval(() => {
          try {
            if (controller.signal.aborted) return;
            assertActive();
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
            signal: controller.signal,
            throwIfAborted: assertActive,
            progress: (value, stage) => {
              assertActive();
              recordProgress(value, stage);
              database.updateJobProgress(job.id, workerId, value, stage, leaseMs);
            },
            heartbeat: (stage) => {
              if (controller.signal.aborted) return;
              assertActive();
              recordProgress(undefined, stage);
              database.heartbeatJob(job.id, workerId, stage, leaseMs);
            },
          });
          assertActive();
        } finally {
          clearInterval(heartbeatTimer);
          clearInterval(watchdog);
        }
        database.completeJob(job.id, workerId, result);
        database.recordWorkflowEvent({
          type: "job.complete",
          subjectType: "job",
          subjectId: job.id,
          payload: { jobType: job.type, result },
        });
      } catch (error) {
        const current = database.getJob(job.id);
        if (current?.status !== "running" || current.leaseOwner !== workerId) return;
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
