import { inspectXiaoheiheCover } from "./xiaoheihe-cover.js";
import { xiaoheiheSelection } from "./xiaoheihe-publishing.js";
import { createHash, randomUUID } from "node:crypto";
import { imagePostCapacity, imagePostEditorUrl, normalizePublisherTopics } from "./xiaoheihe-format.js";
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
export const MINIMUM_EXTENSION_VERSION = "0.1.24";
const XIAOHEIHE_ARTICLE_EDITOR_URL = "https://www.xiaoheihe.cn/creator/editor/draft/article";

export class UnsupportedExtensionVersionError extends Error {
  constructor(readonly version: string) {
    super(`填入助手版本 ${version || "unknown"} 过低，最低需要 ${MINIMUM_EXTENSION_VERSION}`);
    this.name = "UnsupportedExtensionVersionError";
  }
}

export class ExtensionPublisherProtocolError extends Error {
  constructor(readonly status: 401 | 403 | 409 | 410, message: string) {
    super(message);
    this.name = "ExtensionPublisherProtocolError";
  }
}

const compareExtensionVersions = (left: string, right: string) => {
  const parts = (value: string) => value.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
};
// Chrome throttles timers in background tabs. Keep the helper connected across
// that normal throttling interval while still expiring a genuinely closed tab.
const connectedWindowMs = 45_000;


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
  communities?: string[];
  publishing?: { contentFormat?: "article" | "image-post"; visibility: "public"; creationPlan: "none" | "standard" | "hot"; cover?: ExtensionPublisherImage };
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

interface AcceptedReport {
  clientId: string;
  fingerprint: string;
  expiresAt: number;
}

const normalizeReport = (report: ExtensionPublisherReport): ExtensionPublisherReport => ({
  pageUrl: typeof report.pageUrl === "string" ? report.pageUrl : undefined,
  steps: Array.isArray(report.steps)
    ? report.steps.map((step) => ({
      name: String(step.name || "页面操作").slice(0, 40),
      ok: Boolean(step.ok),
      detail: String(step.detail || "").slice(0, 500),
    }))
    : [],
});
const reportFingerprint = (report: ExtensionPublisherReport) => createHash("sha256")
  .update(JSON.stringify(report)).digest("hex");

const assertToken = (actual: string | undefined, expected: string) => {
  if (!actual || actual !== expected) throw new ExtensionPublisherProtocolError(401, "填入助手配对信息无效，请刷新工作台后重试");
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
  private acceptedReports = new Map<string, AcceptedReport>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly timeoutMs = 240_000,
  ) {}

  bootstrap() {
    return { token: this.token };
  }

  heartbeat(token: string | undefined, clientId: string, version: string) {
    assertToken(token, this.token);
    if (!clientId.trim()) throw new Error("缺少填入助手标识");
    if (compareExtensionVersions(version, MINIMUM_EXTENSION_VERSION) < 0) {
      throw new UnsupportedExtensionVersionError(version);
    }
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
      // A timed-out write is ambiguous; never silently re-run it in another tab.
      if (!pending.claimedBy) {
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
    for (const [id, accepted] of this.acceptedReports) {
      if (accepted.expiresAt <= this.now()) this.acceptedReports.delete(id);
    }
    const pending = this.jobs.get(jobId);
    const accepted = this.acceptedReports.get(jobId);
    if (!pending && !accepted) throw new ExtensionPublisherProtocolError(410, "发布任务已结束或不存在");
    if (accepted) {
      if (accepted.clientId !== clientId) throw new ExtensionPublisherProtocolError(403, "发布任务不属于当前填入助手");
      if (accepted.fingerprint !== reportFingerprint(normalizeReport(report))) {
        throw new ExtensionPublisherProtocolError(409, "重传回执与已接收结果不一致");
      }
      return { ok: true };
    }
    if (!pending) throw new ExtensionPublisherProtocolError(410, "发布任务已结束或不存在");
    if (pending.claimedBy !== clientId) throw new ExtensionPublisherProtocolError(403, "发布任务不属于当前填入助手");
    const normalized = normalizeReport(report);
    this.acceptedReports.set(jobId, {
      clientId, fingerprint: reportFingerprint(normalized), expiresAt: this.now() + 5 * 60_000,
    });
    while (this.acceptedReports.size > 100) {
      this.acceptedReports.delete(this.acceptedReports.keys().next().value!);
    }
    clearTimeout(pending.timer);
    this.jobs.delete(jobId);
    pending.resolve(normalized);
    return { ok: true };
  }
}

export const extensionPublisherBridge = new ExtensionPublisherBridge();

const jobImages = async (draft: ArticleDraft): Promise<ExtensionPublisherImage[]> => {
  const inserted = [...insertedMediaIds(draft)];
  if (draft.contentFormat === "image-post" && (inserted.length < 1 || inserted.length > imagePostCapacity)) {
    throw new Error(`工作台图文支持 1–${imagePostCapacity} 张图片，当前为 ${inserted.length} 张`);
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
      fileName: `${placement.id}-${path.basename(placement.image.localPath!)}`,
      mimeType: inspected.contentType,
      dataUrl: `data:${inspected.contentType};base64,${inspected.bytes.toString("base64")}`,
      caption: captions.get(placement.id)
        ?? (placement.caption.trim() || placement.image.caption.trim() || "配图"),
    });
  }
  if (results.length !== inserted.length) {
    throw new Error(`发布图片载荷不完整：正文需要 ${inserted.length} 张，实际准备 ${results.length} 张`);
  }
  return results;
};

export const prepareJob = async (draft: ArticleDraft, _editorUrl: string): Promise<ExtensionPublisherJob> => {
  const selection = draft.xiaoheiheOptions ? xiaoheiheSelection(draft) : undefined;
  const coverId = selection?.options.creationPlan !== "none" ? selection?.options.coverPlacementId : undefined;
  let cover: ExtensionPublisherImage | undefined;
  if (coverId) {
    const placement = draft.images.find(image => image.id === coverId);
    if (!placement) throw new Error("创作计划封面不存在，请重新选择");
    const inspected = await inspectXiaoheiheCover(placement);
    if (!inspected.available || !inspected.bytes || !inspected.contentType || !placement.image.fingerprint || inspected.fingerprint !== placement.image.fingerprint) throw new Error(inspected.reason || "创作计划封面文件校验失败，请重新上传");
    cover = { id: placement.id, fileName: `${placement.id}-${path.basename(placement.image.localPath!)}`, mimeType: inspected.contentType,
      dataUrl: `data:${inspected.contentType};base64,${inspected.bytes.toString("base64")}`, caption: placement.caption };
  }
  if (selection && selection.options.creationPlan !== "none" && !cover) throw new Error("参加创作计划需要选择封面");
  return {
    id: `publish_${randomUUID()}`, draftId: draft.id, createdAt: new Date().toISOString(),
    editorUrl: draft.contentFormat === "image-post" ? imagePostEditorUrl : XIAOHEIHE_ARTICLE_EDITOR_URL,
    contentFormat: draft.contentFormat === "image-post" ? "image-post" : "article",
    title: draft.title, bodyHtml: draft.contentFormat === "image-post" ? publisherImagePostBodyHtml(draft) : publisherBodyHtml(draft),
    community: selection?.community ?? draft.community.trim(), communities: selection?.communities,
    topics: selection?.topics ?? normalizePublisherTopics(draft.topics), images: await jobImages(draft),
    publishing: selection ? { contentFormat: draft.contentFormat ?? "article", visibility: "public", creationPlan: selection.options.creationPlan, cover } : undefined,
  };
};

export const extensionPublisherStatus = () => extensionPublisherBridge.status();

export const openRegularChromePublisher = async (
  _editorUrl: string,
  dependencies: { open?: (url: string) => Promise<void>; status?: () => PublisherStatus } = {},
) => {
  const status = dependencies.status ?? extensionPublisherStatus;
  const connected = status().ok;
  // The installed helper pairs through its content script on the local workbench.
  // Opening only Xiaoheihe never establishes that connection for the desktop app.
  await (dependencies.open ?? openRegularChrome)(connected
    ? XIAOHEIHE_ARTICLE_EDITOR_URL
    : "http://127.0.0.1:4317/#drafts");
  const result = status();
  return !result.ok ? { ...result, detail: "已在常用 Chrome 打开连接页。等待助手连接后即可返回 App；若仍离线，请检查新闻台浏览器助手是否启用" } : result;
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
  const allStepsOk = ["标题", "正文", "配图", "分区", "话题", ...(job.publishing ? ["可见范围", "创作计划", "内容封面"] : [])].every(
    (name) => report.steps.find((step) => step.name === name)?.ok === true,
  ) && report.steps.every((step) => step.ok);
  const result: PublisherResult = {
    at: new Date().toISOString(),
    ok: allStepsOk,
    revisionHash: expectedRevisionHash,
    pageUrl: report.pageUrl,
    community: draftSnapshot.community,
    topics: job.topics,
    steps: report.steps,
    warning: "内容通过常用 Chrome 填入；系统不会点击最终发布。请检查正文、图片、分区和话题。",
  };
  return result;
};
