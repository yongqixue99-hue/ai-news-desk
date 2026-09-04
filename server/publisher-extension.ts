import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  insertedMediaIds,
  publisherImagePostBodyHtml,
  publisherBodyHtml,
  publisherImageCaptions,
} from "./article-html.js";
import { openRegularChrome } from "./chrome-launch.js";
import {
  assertPublicationRevision,
  PublicationRevisionConflictError,
} from "./publication-state.js";
import { inspectDraftImageFile } from "./published-materials.js";
import { updateState, workspacePath } from "./storage.js";
import type {
  ArticleDraft,
  PublisherResult,
  PublisherStatus,
  PublisherStep,
} from "./types.js";

const extensionInstallPath = workspacePath("chrome-extension");
export const MINIMUM_EXTENSION_VERSION = "0.1.22";
// Chrome throttles timers in background tabs. Keep the helper connected across
// that normal throttling interval while still expiring a genuinely closed tab.
const connectedWindowMs = 45_000;
const claimLeaseMs = 30_000;

export interface ExtensionPublisherImage {
  id: string;
  fileName: string;
  mimeType: string;
  dataUrl: string;
  caption: string;
}

export interface ExtensionPublisherJob {
  id: string;
  draftId: string;
  createdAt: string;
  editorUrl: string;
  contentFormat: "article" | "image-post";
  title: string;
  bodyHtml: string;
  community: string;
  topics: string[];
  images: ExtensionPublisherImage[];
}

export interface ExtensionPublisherReport {
  pageUrl?: string;
  steps: PublisherStep[];
}

export interface ExtensionPublisherFillDependencies {
  loadCurrentDraft?: (draftId: string) => Promise<ArticleDraft | undefined>;
  submit?: (job: ExtensionPublisherJob) => Promise<ExtensionPublisherReport>;
}

interface PendingJob {
  job: ExtensionPublisherJob;
  claimedBy?: string;
  claimedAt?: number;
  resolve: (report: ExtensionPublisherReport) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ExtensionClient {
  id: string;
  version: string;
  seenAt: number;
}

const assertToken = (actual: string | undefined, expected: string) => {
  if (!actual || actual !== expected) throw new Error("填入助手配对信息无效，请刷新工作台后重试");
};

/**
 * Runtime bridge between the local workbench and the installed Chrome helper.
 * The public publishing module is the only product caller; HTTP handlers below
 * expose the small transport protocol needed by the extension.
 */
export class ExtensionPublisherBridge {
  readonly token = randomUUID();
  private client?: ExtensionClient;
  private jobs = new Map<string, PendingJob>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 120_000,
  ) {}

  bootstrap() {
    return { token: this.token };
  }

  heartbeat(token: string | undefined, clientId: string, version: string) {
    assertToken(token, this.token);
    if (!clientId.trim()) throw new Error("缺少填入助手标识");
    this.client = {
      id: clientId.trim().slice(0, 160),
      version: version.trim().slice(0, 40) || "unknown",
      seenAt: this.now(),
    };
    return this.status();
  }

  status(): PublisherStatus {
    const connected = Boolean(
      this.client && this.now() - this.client.seenAt <= connectedWindowMs,
    );
    return {
      mode: "chrome-extension",
      ok: connected,
      detail: connected
        ? `常用 Chrome 填入助手已连接 · v${this.client?.version}`
        : "常用 Chrome 尚未连接填入助手",
      installPath: extensionInstallPath,
      connectedAt: this.client ? new Date(this.client.seenAt).toISOString() : undefined,
    };
  }

  submit(job: ExtensionPublisherJob) {
    if (!this.status().ok) {
      throw new Error("常用 Chrome 填入助手尚未连接。请先加载扩展并刷新工作台页面");
    }
    return new Promise<ExtensionPublisherReport>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.jobs.delete(job.id);
        reject(new Error("常用 Chrome 填入超时；请确认扩展仍启用，并保持工作台页面打开"));
      }, this.timeoutMs);
      this.jobs.set(job.id, { job, resolve, reject, timer });
    });
  }

  claim(token: string | undefined, clientId: string) {
    assertToken(token, this.token);
    if (!this.client || this.client.id !== clientId) throw new Error("填入助手尚未完成握手");
    const now = this.now();
    for (const pending of this.jobs.values()) {
      const leaseExpired = pending.claimedAt && now - pending.claimedAt > claimLeaseMs;
      if (!pending.claimedBy || leaseExpired) {
        pending.claimedBy = clientId;
        pending.claimedAt = now;
        return pending.job;
      }
    }
    return undefined;
  }

  complete(
    token: string | undefined,
    clientId: string,
    jobId: string,
    report: ExtensionPublisherReport,
  ) {
    assertToken(token, this.token);
    const pending = this.jobs.get(jobId);
    if (!pending) throw new Error("发布任务已结束或不存在");
    if (pending.claimedBy !== clientId) throw new Error("发布任务不属于当前填入助手");
    clearTimeout(pending.timer);
    this.jobs.delete(jobId);
    pending.resolve({
      pageUrl: typeof report.pageUrl === "string" ? report.pageUrl : undefined,
      steps: Array.isArray(report.steps)
        ? report.steps.map((step) => ({
          name: String(step.name || "页面操作").slice(0, 40),
          ok: Boolean(step.ok),
          detail: String(step.detail || "").slice(0, 500),
        }))
        : [],
    });
    return { ok: true };
  }
}

export const extensionPublisherBridge = new ExtensionPublisherBridge();

const jobImages = async (draft: ArticleDraft): Promise<ExtensionPublisherImage[]> => {
  const inserted = [...insertedMediaIds(draft)];
  if (draft.contentFormat === "image-post" && inserted.length !== 1) {
    throw new Error(`图文稿必须恰好包含 1 张待上传图片，当前为 ${inserted.length} 张`);
  }
  const captions = publisherImageCaptions(draft);
  const placements = new Map(draft.images.map((placement) => [placement.id, placement]));
  const results: ExtensionPublisherImage[] = [];
  for (const placementId of inserted) {
    const placement = placements.get(placementId);
    if (!placement) throw new Error(`正文图片 ${placementId} 没有对应的草稿图片记录`);
    const inspected = await inspectDraftImageFile(placement, true);
    if (!inspected.available || !inspected.bytes || !inspected.contentType) {
      throw new Error(`正文图片 ${placementId} 无法安全读取：${inspected.reason || "图片数据不完整"}`);
    }
    if (!placement.image.fingerprint || inspected.fingerprint !== placement.image.fingerprint) {
      throw new Error(`正文图片 ${placementId} 的文件指纹与预检记录不一致，请重新插入图片`);
    }
    results.push({
      id: placement.id,
      fileName: path.basename(placement.image.localPath!),
      mimeType: inspected.contentType,
      dataUrl: `data:${inspected.contentType};base64,${inspected.bytes.toString("base64")}`,
      caption: captions.get(placement.id)
        || placement.caption.trim()
        || placement.image.caption.trim()
        || "配图",
    });
  }
  if (results.length !== inserted.length) {
    throw new Error(`发布图片载荷不完整：正文需要 ${inserted.length} 张，实际准备 ${results.length} 张`);
  }
  return results;
};

export const prepareJob = async (draft: ArticleDraft, editorUrl: string): Promise<ExtensionPublisherJob> => ({
  id: `publish_${randomUUID()}`,
  draftId: draft.id,
  createdAt: new Date().toISOString(),
  editorUrl,
  contentFormat: draft.contentFormat === "image-post" ? "image-post" : "article",
  title: draft.title,
  bodyHtml: draft.contentFormat === "image-post"
    ? publisherImagePostBodyHtml(draft)
    : publisherBodyHtml(draft),
  community: draft.community,
  topics: [...draft.topics],
  images: await jobImages(draft),
});

export const extensionPublisherStatus = () => extensionPublisherBridge.status();

export const openRegularChromePublisher = async (editorUrl: string) => {
  await openRegularChrome(editorUrl);
  return extensionPublisherStatus();
};

export const fillViaChromeExtension = async (
  draftSnapshot: ArticleDraft,
  expectedRevisionHash: string,
  editorUrl: string,
  dependencies: ExtensionPublisherFillDependencies = {},
): Promise<PublisherResult> => {
  assertPublicationRevision(draftSnapshot, "xiaoheihe", expectedRevisionHash);
  const job = await prepareJob(draftSnapshot, editorUrl);
  // Wait behind any pending state mutation and compare again immediately
  // before the job becomes visible to the Chrome helper.
  const currentDraft = await (dependencies.loadCurrentDraft
    ? dependencies.loadCurrentDraft(draftSnapshot.id)
    : updateState((state) => {
      const draft = state.drafts.find((entry) => entry.id === draftSnapshot.id);
      return draft ? structuredClone(draft) : undefined;
    }));
  if (!currentDraft) {
    throw new PublicationRevisionConflictError(
      draftSnapshot.id,
      expectedRevisionHash,
      "draft-missing",
    );
  }
  assertPublicationRevision(currentDraft, "xiaoheihe", expectedRevisionHash);

  const report = await (dependencies.submit
    ? dependencies.submit(job)
    : extensionPublisherBridge.submit(job));
  const allStepsOk = ["标题", "正文", "配图", "分区", "话题"].every(
    (name) => report.steps.find((step) => step.name === name)?.ok === true,
  ) && report.steps.every((step) => step.ok);
  const result: PublisherResult = {
    at: new Date().toISOString(),
    ok: allStepsOk,
    revisionHash: expectedRevisionHash,
    pageUrl: report.pageUrl,
    community: draftSnapshot.community,
    topics: [...draftSnapshot.topics],
    steps: report.steps,
    warning: "内容通过常用 Chrome 填入；系统不会点击最终发布。请检查正文、图片、分区和话题。",
  };
  return result;
};
