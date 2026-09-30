export interface CoalescedRefresh<T = unknown> {
  request: (quiet?: boolean) => Promise<void>;
  requestValue: (quiet?: boolean) => Promise<T | undefined>;
  dispose: () => void;
}

interface RefreshCallbacks<T> {
  read: () => Promise<T>;
  apply: (value: T, quiet: boolean) => void;
  onStart?: (quiet: boolean) => void;
  onSettled?: (quiet: boolean) => void;
}

interface RefreshBatch<T> {
  quiet: boolean;
  promise: Promise<T | undefined>;
  resolve: (value?: T) => void;
  reject: (error: unknown) => void;
}

function batchFor<T>(quiet: boolean): RefreshBatch<T> {
  let resolve!: (value?: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T | undefined>((ok, fail) => { resolve = ok; reject = fail; });
  return { quiet, promise, resolve, reject };
}

/** One read in flight and one trailing read. Explicit refreshes keep their display mode. */
export function createCoalescedRefresh<T>(callbacks: RefreshCallbacks<T>): CoalescedRefresh<T> {
  let disposed = false;
  let active: RefreshBatch<T> | undefined;
  let pending: RefreshBatch<T> | undefined;

  const run = async (batch: RefreshBatch<T>) => {
    active = batch;
    try {
      callbacks.onStart?.(batch.quiet);
      const value = await callbacks.read();
      if (!disposed) callbacks.apply(value, batch.quiet);
      batch.resolve(value);
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

  const requestValue = (quiet = false): Promise<T | undefined> => {
    if (disposed) return Promise.resolve(undefined);
    if (active) {
      pending ??= batchFor<T>(quiet);
      pending.quiet &&= quiet;
      return pending.promise;
    }
    const batch = batchFor<T>(quiet);
    void run(batch);
    return batch.promise;
  };
  return {
    request: (quiet = false) => requestValue(quiet).then(() => undefined),
    requestValue,
    dispose() {
      disposed = true;
      // A route change must not keep callers waiting for a slow response.
      active?.resolve();
      pending?.resolve();
      pending = undefined;
    },
  };
}
