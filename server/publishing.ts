import {
  fillViaChromeExtension,
  extensionPublisherStatus,
  openRegularChromePublisher,
} from "./publisher-extension.js";
import {
  fillXiaoheihe as fillViaCdp,
  launchPublisherChrome,
  publisherStatus as cdpPublisherStatus,
} from "./publisher.js";
import type { PublisherStatus, Settings } from "./types.js";

type PublisherSettings = Pick<
  Settings,
  "publisherMode" | "xiaoheiheEditorUrl" | "chromeDebugPort"
>;

/**
 * The product-facing publishing seam. Callers submit one operation while the
 * selected adapter hides whether regular Chrome or CDP performs the transfer.
 */
export const publisherStatus = async (settings: PublisherSettings): Promise<PublisherStatus> => {
  if (settings.publisherMode === "chrome-extension") return extensionPublisherStatus();
  const status = await cdpPublisherStatus(settings.chromeDebugPort);
  return { mode: "cdp", ok: status.ok, detail: status.detail };
};

export const openPublisher = async (settings: PublisherSettings) => {
  if (settings.publisherMode === "chrome-extension") {
    return openRegularChromePublisher(settings.xiaoheiheEditorUrl);
  }
  const status = await launchPublisherChrome(
    settings.xiaoheiheEditorUrl,
    settings.chromeDebugPort,
  );
  return { mode: "cdp" as const, ok: status.ok, detail: status.detail };
};

export const fillDraftInPublisher = async (draftId: string, settings: PublisherSettings) => {
  if (settings.publisherMode === "chrome-extension") {
    return fillViaChromeExtension(draftId, settings.xiaoheiheEditorUrl);
  }
  return fillViaCdp(draftId, settings.chromeDebugPort, settings.xiaoheiheEditorUrl);
};
