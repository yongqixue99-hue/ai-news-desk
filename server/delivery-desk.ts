export type DeliveryChannel = "wechat" | "xiaoheihe";

export interface DeliveryRequest {
  draftId: string;
  channel: DeliveryChannel;
}

/**
 * DeliveryDesk is the channel-neutral delivery boundary. It serializes a
 * draft/channel pair so retries can update the same remote draft instead of
 * racing into duplicates. Channel adapters still own their own preflight and
 * structured receipt format; this layer never invokes a final publish API.
 */
export const createDeliveryDesk = () => {
  const inFlight = new Map<string, Promise<unknown>>();
  const sync = <T>(request: DeliveryRequest, operation: () => Promise<T>): Promise<T> => {
    const key = `${request.channel}:${request.draftId}`;
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
    const task = Promise.resolve().then(operation);
    inFlight.set(key, task);
    const release = () => {
      if (inFlight.get(key) === task) inFlight.delete(key);
    };
    void task.then(release, release);
    return task;
  };
  return { sync };
};

