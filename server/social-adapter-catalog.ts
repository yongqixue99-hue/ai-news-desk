/** Capabilities discovery may inspect many websites. It must not delay unrelated channels. */
export function createSocialAdapterCatalog(dependencies: { generation: () => number; fetch: () => Promise<unknown>; now?: () => number }) {
  const now = dependencies.now || Date.now;
  let generation = -1, value: unknown, readAt = 0, retryAt = 0, pending: Promise<unknown> | undefined;
  const current = () => {
    const next = dependencies.generation();
    if (next !== generation) { generation = next; value = undefined; readAt = 0; retryAt = 0; pending = undefined; }
    return next;
  };
  const read = (): Promise<unknown> => {
    const expected = current();
    if (value !== undefined && now() - readAt < 300_000) return Promise.resolve(value);
    if (pending) return pending;
    const task = dependencies.fetch().then(result => {
      if (expected !== dependencies.generation()) throw new Error("同步助手连接已变化，请重新交付");
      value = result; readAt = now(); return result;
    }).catch(error => { if (expected === dependencies.generation()) retryAt = now() + 10_000; throw error; })
      .finally(() => { if (pending === task) pending = undefined; });
    pending = task; return task;
  };
  const peek = () => {
    current();
    if (value !== undefined && now() - readAt < 300_000) return value;
    if (now() >= retryAt) void read().catch(() => undefined);
    return undefined;
  };
  return { read, peek };
}
