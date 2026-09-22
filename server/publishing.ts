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
import type { ArticleDraft, PublisherStatus, Settings } from "./types.js";

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

export const fillDraftInPublisher = async (
  draftSnapshot: ArticleDraft,
  expectedRevisionHash: string,
  settings: PublisherSettings,
) => {
  if (draftSnapshot.contentFormat === "image-post" && settings.publisherMode !== "chrome-extension") throw new Error("图文图集请使用常用 Chrome 填入助手；CDP 备用通道目前仅支持文章");
  if (settings.publisherMode === "chrome-extension") {
    return fillViaChromeExtension(
      draftSnapshot,
      expectedRevisionHash,
      settings.xiaoheiheEditorUrl,
    );
  }
  return fillViaCdp(
    draftSnapshot,
    expectedRevisionHash,
    settings.chromeDebugPort,
    settings.xiaoheiheEditorUrl,
  );
};

/** Connecting is part of delivery, not a separate user task. */
export const ensurePublisherConnected = async (
  settings: PublisherSettings,
  dependencies: { status?: () => Promise<PublisherStatus>; open?: () => Promise<unknown>; wait?: () => Promise<void>; attempts?: number } = {},
) => {
  const status = dependencies.status ?? (() => publisherStatus(settings));
  if ((await status()).ok) return;
  await (dependencies.open ?? (() => openPublisher(settings)))();
  for (let attempt = 0; attempt < (dependencies.attempts ?? 20); attempt += 1) {
    await (dependencies.wait ?? (() => new Promise(resolve => setTimeout(resolve, 700))))();
    if ((await status()).ok) return;
  }
  throw new Error("已打开 Chrome，但新闻台助手尚未响应。首次使用请安装助手；已安装时请在 Chrome 扩展页重新加载，再点一次发送。");
};
