/** Bound even non-cancellable waits (notably DNS); never start work after cancellation. */
export function withAbort<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return work();
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve().then(() => { signal.throwIfAborted(); return work(); }).then(
      value => { signal.removeEventListener('abort', abort); signal.aborted ? reject(signal.reason) : resolve(value); },
      error => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

export const deadlineSignal = (milliseconds: number, parent?: AbortSignal | null) =>
  parent ? AbortSignal.any([parent, AbortSignal.timeout(milliseconds)]) : AbortSignal.timeout(milliseconds);
