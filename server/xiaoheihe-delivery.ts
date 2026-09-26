import type { createDeliveryDesk } from "./delivery-desk.js";
import { publicationRevisionHash, PublicationRevisionConflictError } from "./publication-state.js";
import {
  completePublisherAttempt,
  createPublisherAttempt,
  type PublisherPreflightResult,
  type PublisherReceipt,
} from "./publisher-preflight.js";
import type { ArticleDraft, PublisherResult, Settings } from "./types.js";

interface XiaoheiheDeliveryDependencies {
  deliveryDesk: Pick<ReturnType<typeof createDeliveryDesk>, "sync">;
  connect: (settings: Settings) => Promise<void>;
  preflight: (draft: ArticleDraft, settings: Settings, revision: string) => Promise<PublisherPreflightResult>;
  fill: (draft: ArticleDraft, revision: string, settings: Settings) => Promise<PublisherResult>;
  record: (draftId: string, result: PublisherResult, receipt: PublisherReceipt) => Promise<{
    revision: string;
    updatedAt?: string;
  } | undefined>;
}

export type XiaoheiheDeliveryResponse = {
  status: 409;
  body: { error: string; preflight: PublisherPreflightResult; receipt: PublisherReceipt };
} | {
  status: 200;
  body: PublisherResult & { localDraftUpdatedAt: string };
};

/** Owns a complete fill attempt, including connection, preflight and receipts.
 * Only in-flight work is shared: a later request must inspect the platform again.
 */
export const createXiaoheiheDelivery = (dependencies: XiaoheiheDeliveryDependencies) => ({
  async deliver(draft: ArticleDraft, settings: Settings): Promise<XiaoheiheDeliveryResponse> {
    const snapshot = structuredClone(draft);
    const revision = publicationRevisionHash(snapshot, "xiaoheihe");
    return dependencies.deliveryDesk.sync<XiaoheiheDeliveryResponse>({ draftId: snapshot.id, channel: "xiaoheihe", revision }, async () => {
      await dependencies.connect(settings);
      const preflight = await dependencies.preflight(snapshot, settings, revision);
      const attempt = createPublisherAttempt(preflight);
      if (!preflight.canQueueFill) {
        const receipt = completePublisherAttempt(attempt, { steps: [] });
        receipt.revisionHash = revision;
        const result: PublisherResult = {
          at: receipt.completedAt, ok: false, revisionHash: revision, steps: [],
          warning: preflight.summary, preflight, receipt,
        };
        await dependencies.record(snapshot.id, result, receipt);
        return {
          status: 409,
          body: {
            error: preflight.blocking.filter(issue => !["login", "editor"].includes(issue.capability))
              .map(issue => issue.message).join("；") || preflight.summary,
            preflight, receipt,
          },
        };
      }
      const result = await dependencies.fill(snapshot, revision, settings);
      if (result.revisionHash !== revision) {
        throw new PublicationRevisionConflictError(snapshot.id, revision, result.revisionHash || "transport-unversioned");
      }
      const receipt = completePublisherAttempt(attempt, {
        pageUrl: result.pageUrl, diagnosticScreenshot: result.diagnosticScreenshot,
        steps: result.steps, completedAt: result.at,
      });
      receipt.revisionHash = revision;
      const enriched = { ...result, ok: receipt.outcome === "filled", preflight, receipt };
      const committed = await dependencies.record(snapshot.id, enriched, receipt);
      if (!committed?.updatedAt) {
        throw new PublicationRevisionConflictError(snapshot.id, revision, committed?.revision || "draft-missing");
      }
      return { status: 200 as const, body: { ...enriched, localDraftUpdatedAt: committed.updatedAt } };
    });
  },
});
