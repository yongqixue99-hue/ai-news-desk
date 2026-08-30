export interface WeChatSyncCoordinator {
  run<T>(draftId: string, operation: () => Promise<T>): Promise<T>;
}

export const createWeChatSyncCoordinator = (): WeChatSyncCoordinator => {
  const inFlight = new Map<string, Promise<unknown>>();

  const run: WeChatSyncCoordinator["run"] = <T>(draftId: string, operation: () => Promise<T>) => {
    const existing = inFlight.get(draftId);
    if (existing) return existing as Promise<T>;
    const task = Promise.resolve().then(operation);
    inFlight.set(draftId, task);
    const release = () => {
      if (inFlight.get(draftId) === task) inFlight.delete(draftId);
    };
    void task.then(release, release);
    return task;
  };

  return { run };
};
