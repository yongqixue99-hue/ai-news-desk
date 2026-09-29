export interface CoalescedRefresh {
  request: (quiet?: boolean) => Promise<void>;
  dispose: () => void;
}

interface RefreshCallbacks<T> {
  read: () => Promise<T>;
  apply: (value: T, quiet: boolean) => void;
  onStart?: (quiet: boolean) => void;
  onSettled?: (quiet: boolean) => void;
}

interface RefreshBatch {
  quiet: boolean;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
}

function batchFor(quiet: boolean): RefreshBatch {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((ok, fail) => { resolve = ok; reject = fail; });
  return { quiet, promise, resolve, reject };
}

/** One read in flight and one trailing read. Explicit refreshes keep their display mode. */
export function createCoalescedRefresh<T>(callbacks: RefreshCallbacks<T>): CoalescedRefresh {
  let disposed = false;
  let active: RefreshBatch | undefined;
  let pending: RefreshBatch | undefined;

  const run = async (batch: RefreshBatch) => {
    active = batch;
    try {
      callbacks.onStart?.(batch.quiet);
      const value = await callbacks.read();
      if (!disposed) callbacks.apply(value, batch.quiet);
      batch.resolve();
    } catch (error) {
      batch.reject(error);
    } finally {
      active = undefined;
      if (!disposed) callbacks.onSettled?.(batch.quiet);
      const next = pending;
      pending = undefined;
      if (next && !disposed) void run(next);
    }
  };

  return {
    request(quiet = false) {
      if (disposed) return Promise.resolve();
      if (active) {
        pending ??= batchFor(quiet);
        pending.quiet &&= quiet;
        return pending.promise;
      }
      const batch = batchFor(quiet);
      void run(batch);
      return batch.promise;
    },
    dispose() {
      disposed = true;
      // A route change must not keep callers waiting for a slow response.
      active?.resolve();
      pending?.resolve();
      pending = undefined;
    },
  };
}
