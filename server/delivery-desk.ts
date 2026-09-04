export type DeliveryChannel = "wechat" | "xiaoheihe";

export interface DeliveryRequest {
  draftId: string;
  channel: DeliveryChannel;
}

export type DeliveryPreparationStatus = "prepared" | "failed" | "skipped";

export interface DeliveryPreparationResult {
  outcome: "prepared" | "partial" | "failed";
  finalPublishAttempted: false;
  targets: Array<{
    id: DeliveryChannel;
    status: DeliveryPreparationStatus;
    detail: string;
  }>;
}

export interface DeliveryPreparationTarget {
  id: DeliveryChannel;
  available: boolean;
  unavailableReason?: string;
  prepare: () => Promise<string>;
}

interface PrepareDeliveryTargetsInput {
  save: () => Promise<unknown>;
  targets: DeliveryPreparationTarget[];
}

/**
 * Saves one mutable article snapshot, then prepares every available channel
 * independently. The interface deliberately has no final-publish callback.
 */
export const prepareDeliveryTargets = async ({
  save,
  targets,
}: PrepareDeliveryTargetsInput): Promise<DeliveryPreparationResult> => {
  await save();
  const prepared = await Promise.all(targets.map(async (target) => {
    if (!target.available) {
      return {
        id: target.id,
        status: "skipped" as const,
        detail: target.unavailableReason || "平台尚未连接",
      };
    }
    try {
      return {
        id: target.id,
        status: "prepared" as const,
        detail: await target.prepare(),
      };
    } catch (error) {
      return {
        id: target.id,
        status: "failed" as const,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }));
  const preparedCount = prepared.filter((target) => target.status === "prepared").length;

  return {
    outcome: preparedCount === prepared.length
      ? "prepared"
      : preparedCount === 0
        ? "failed"
        : "partial",
    finalPublishAttempted: false,
    targets: prepared,
  };
};

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

