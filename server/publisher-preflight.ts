import { imagePostCapacity, normalizePublisherTopics } from "./xiaoheihe-format.js";
import { randomUUID } from "node:crypto";

export type PublisherAdapterMode = "chrome-extension" | "cdp";
export type PublisherCapabilityId =
  | "transport"
  | "protocol"
  | "login"
  | "editor"
  | "title"
  | "body"
  | "images"
  | "captions"
  | "community"
  | "topics";

export type PublisherCapabilityStatus = "pass" | "warning" | "blocked" | "unknown";

export interface PublisherRuntimeSnapshot {
  mode: PublisherAdapterMode;
  connected: boolean;
  detail?: string;
  protocolVersion?: string;
  loggedIn?: boolean;
  editorReady?: boolean;
  pageUrl?: string;
}

export interface PublisherStatusSnapshot {
  mode: PublisherAdapterMode;
  ok: boolean;
  detail: string;
  connectedAt?: string;
}

export type PublisherLiveProbe = Pick<
  PublisherRuntimeSnapshot,
  "loggedIn" | "editorReady" | "pageUrl"
>;

export interface PublisherPreflightImage {
  id: string;
  available: boolean;
  caption?: string;
}

export interface PublisherPreflightDraft {
  id: string;
  contentFormat?: "article" | "image-post";
  title: string;
  bodyHtml: string;
  community: string;
  topics: string[];
  images: PublisherPreflightImage[];
}

export interface PublisherPreflightInput {
  checkedAt?: string;
  /** Immutable local publication revision represented by this preflight. */
  expectedRevisionHash?: string;
  minimumProtocolVersion?: string;
  runtime: PublisherRuntimeSnapshot;
  draft: PublisherPreflightDraft;
}

export interface PublisherCapability {
  id: PublisherCapabilityId;
  label: string;
  status: PublisherCapabilityStatus;
  required: boolean;
  detail: string;
  issueCode?: string;
  action?: string;
}

export interface PublisherPreflightIssue {
  code: string;
  capability: PublisherCapabilityId;
  severity: "blocking" | "warning";
  message: string;
  action?: string;
}

export interface PublisherPreflightResult {
  checkedAt: string;
  draftId: string;
  mode: PublisherAdapterMode;
  protocolVersion?: string;
  /** Image placement ids frozen at preflight time for a later audited receipt. */
  draftImageIds: string[];
  /** Immutable local publication revision represented by this preflight. */
  expectedRevisionHash?: string;
  minimumProtocolVersion: string;
  canQueueFill: boolean;
  publishReady: boolean;
  requiresLiveProbe: boolean;
  capabilities: PublisherCapability[];
  blocking: PublisherPreflightIssue[];
  warnings: PublisherPreflightIssue[];
  summary: string;
  finalPublish: {
    manualOnly: true;
    willClickPublish: false;
    detail: string;
  };
}

export interface EditorialReadinessSnapshot {
  ready: boolean;
  blockers: string[];
  warnings: string[];
}

/** Keep platform/runtime failures visible when editorial checks add blockers. */
export const appendEditorialReadiness = (
  preflight: PublisherPreflightResult,
  readiness: EditorialReadinessSnapshot,
) => {
  for (const blocker of readiness.blockers) {
    const capability: PublisherCapabilityId = blocker.startsWith("图片：") ? "images" : "body";
    const action = capability === "images"
      ? "到图片面板补齐版权来源、授权状态和平台许可。"
      : "到资料面板核验事实或降低结论强度。";
    preflight.blocking.push({
      code: "PREFLIGHT_EDITORIAL_READINESS",
      capability,
      severity: "blocking",
      message: blocker,
      action,
    });
    const capabilityRow = preflight.capabilities.find((entry) => entry.id === capability);
    if (capabilityRow) {
      capabilityRow.status = "blocked";
      capabilityRow.detail = blocker;
      capabilityRow.issueCode = "PREFLIGHT_EDITORIAL_READINESS";
      capabilityRow.action = action;
    }
  }
  for (const warning of readiness.warnings) {
    preflight.warnings.push({
      code: "PREFLIGHT_EDITORIAL_WARNING",
      capability: "images",
      severity: "warning",
      message: warning,
    });
  }
  if (!readiness.ready) {
    preflight.canQueueFill = false;
    preflight.publishReady = false;
    preflight.summary = `有 ${preflight.blocking.length} 项阻止填入，请逐项处理`;
  }
  return preflight;
};

export interface PublisherAttemptOptions {
  attemptId?: string;
  startedAt?: string;
}

export interface PublisherAttemptRecord {
  schemaVersion: "publisher-attempt/v1";
  id: string;
  draftId: string;
  mode: PublisherAdapterMode;
  status: "blocked" | "running";
  startedAt: string;
  preflight: PublisherPreflightResult;
  safety: {
    operation: "fill-only";
    finalPublishAllowed: false;
  };
}

export interface PublisherReportedStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PublisherAttemptReport {
  completedAt?: string;
  pageUrl?: string;
  diagnosticScreenshot?: string;
  steps: PublisherReportedStep[];
}

export interface PublisherReceiptCheck {
  id: PublisherCapabilityId;
  label: string;
  ok: boolean;
  source: "preflight" | "extension-report" | "fill-inference";
  detail: string;
}

export interface PublisherReceipt {
  schemaVersion: "publisher-receipt/v1";
  attemptId: string;
  draftId: string;
  mode: PublisherAdapterMode;
  protocolVersion?: string;
  startedAt: string;
  completedAt: string;
  /** Local publishable revision represented by this fill attempt. */
  revisionHash?: string;
  outcome: "blocked" | "failed" | "partial" | "filled";
  pageUrl?: string;
  diagnosticScreenshot?: string;
  checks: PublisherReceiptCheck[];
  blocking: Array<{ id: PublisherCapabilityId; detail: string }>;
  warnings: PublisherPreflightIssue[];
  /** Exact draft placement ids confirmed by the platform adapter's image step. */
  usedImageIds?: string[];
  safety: {
    operation: "fill-only";
    finalPublishAttempted: false;
    finalPublishPerformed: false;
  };
  summary: string;
}

const textFromHtml = (html: string) => html
  .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&amp;/gi, "&")
  .replace(/\s+/g, " ")
  .trim();

const versionFromRuntime = (runtime: PublisherRuntimeSnapshot) => runtime.protocolVersion
  || runtime.detail?.match(/(?:^|\s|·)v(\d+(?:\.\d+){1,3}(?:[-+][\w.-]+)?)/i)?.[1];

export const publisherRuntimeFromStatus = (
  status: PublisherStatusSnapshot,
  liveProbe: PublisherLiveProbe = {},
): PublisherRuntimeSnapshot => {
  const runtime: PublisherRuntimeSnapshot = {
    mode: status.mode,
    connected: status.ok,
    detail: status.detail,
    ...liveProbe,
  };
  const protocolVersion = versionFromRuntime(runtime);
  return protocolVersion ? { ...runtime, protocolVersion } : runtime;
};

const compareVersions = (left: string, right: string) => {
  const parts = (value: string) => value.split(/[.+-]/, 3).map((part) => Number.parseInt(part, 10) || 0);
  const leftParts = parts(left);
  const rightParts = parts(right);
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

export const evaluatePublisherPreflight = (
  input: PublisherPreflightInput,
): PublisherPreflightResult => {
  const minimumProtocolVersion = input.minimumProtocolVersion || "0.1.14";
  const isImagePost = input.draft.contentFormat === "image-post";
  const protocolVersion = versionFromRuntime(input.runtime);
  const protocolRequired = input.runtime.mode === "chrome-extension";
  const bodyText = textFromHtml(input.draft.bodyHtml);
  const topics = normalizePublisherTopics(input.draft.topics);
  const capabilities: PublisherCapability[] = [
    {
      id: "transport",
      label: "填入通道",
      status: input.runtime.connected ? "pass" : "blocked",
      required: true,
      detail: input.runtime.connected ? "填入助手已连接" : "填入助手未连接",
      issueCode: input.runtime.connected ? undefined : "PREFLIGHT_TRANSPORT_DISCONNECTED",
      action: input.runtime.connected ? undefined : "确认 Chrome 扩展已启用，并刷新工作台让填入助手重新握手。",
    },
    {
      id: "protocol",
      label: "扩展协议",
      status: !protocolRequired
        ? "pass"
        : protocolVersion && compareVersions(protocolVersion, minimumProtocolVersion) >= 0
          ? "pass"
          : "blocked",
      required: protocolRequired,
      detail: !protocolRequired
        ? "CDP 模式不适用扩展协议版本检查"
        : protocolVersion
          ? `当前 v${protocolVersion}，最低要求 v${minimumProtocolVersion}`
          : `未收到扩展版本，最低要求 v${minimumProtocolVersion}`,
      issueCode: !protocolRequired
        ? undefined
        : protocolVersion
          ? compareVersions(protocolVersion, minimumProtocolVersion) >= 0
            ? undefined
            : "PREFLIGHT_PROTOCOL_OUTDATED"
          : "PREFLIGHT_PROTOCOL_UNKNOWN",
      action: protocolRequired ? `重新加载不低于 v${minimumProtocolVersion} 的填入助手。` : undefined,
    },
    {
      id: "login",
      label: "登录状态",
      status: input.runtime.loggedIn === true ? "pass" : input.runtime.loggedIn === false ? "blocked" : "unknown",
      required: true,
      detail: input.runtime.loggedIn === true
        ? "已确认登录"
        : input.runtime.loggedIn === false
          ? "尚未登录"
          : "尚未探测；填入时自动确认登录状态",
      issueCode: input.runtime.loggedIn === true
        ? undefined
        : input.runtime.loggedIn === false
          ? "PREFLIGHT_LOGIN_REQUIRED"
          : "PREFLIGHT_LOGIN_UNKNOWN",
      action: input.runtime.loggedIn === false
        ? "在常用 Chrome 中登录小黑盒后重试。"
        : "若填入时跳转登录页，在常用 Chrome 完成登录后重试。",
    },
    {
      id: "editor",
      label: isImagePost ? "图文编辑器" : "文章编辑器",
      status: input.runtime.editorReady === true ? "pass" : input.runtime.editorReady === false ? "blocked" : "unknown",
      required: true,
      detail: input.runtime.editorReady === true
        ? `${isImagePost ? "图文" : "文章"}编辑器已就绪`
        : input.runtime.editorReady === false
          ? `当前不在${isImagePost ? "图文" : "文章"}编辑器`
          : `尚未探测；填入时自动打开并确认${isImagePost ? "图文" : "文章"}编辑器`,
      issueCode: input.runtime.editorReady === true
        ? undefined
        : input.runtime.editorReady === false
          ? "PREFLIGHT_EDITOR_NOT_READY"
          : "PREFLIGHT_EDITOR_UNKNOWN",
      action: input.runtime.editorReady === false
        ? `打开小黑盒“${isImagePost ? "发布图文" : "发布文章"}”编辑器后重试。`
        : "填入助手会自动打开对应编辑器，无需提前处理。",
    },
    {
      id: "title",
      label: "标题",
      status: input.draft.title.trim() && input.draft.title.trim().length <= 30 ? "pass" : "blocked",
      required: true,
      detail: !input.draft.title.trim()
        ? "标题为空"
        : input.draft.title.trim().length > 30
          ? `标题 ${input.draft.title.trim().length} 字，超过平台 30 字上限`
          : `标题 ${input.draft.title.trim().length} 字`,
      issueCode: !input.draft.title.trim()
        ? "PREFLIGHT_TITLE_MISSING"
        : input.draft.title.trim().length > 30
          ? "PREFLIGHT_TITLE_TOO_LONG"
          : undefined,
      action: "将标题调整到 1–30 字，并保留主要新闻点。",
    },
    {
      id: "body",
      label: "正文",
      status: bodyText.length >= 20 ? "pass" : "blocked",
      required: true,
      detail: bodyText.length >= 20 ? `正文 ${bodyText.length} 字` : "正文不足 20 字",
      issueCode: bodyText.length >= 20 ? undefined : "PREFLIGHT_BODY_TOO_SHORT",
      action: "补全正文后再填入，避免平台编辑器只收到空壳内容。",
    },
    {
      id: "images",
      label: "图片",
      status: isImagePost && (input.draft.images.length < 1 || input.draft.images.length > imagePostCapacity)
        ? "blocked"
        : input.draft.images.length === 0
          ? "warning"
          : input.draft.images.every((image) => image.available)
            ? "pass"
            : "blocked",
      required: isImagePost || input.draft.images.length > 0,
      detail: isImagePost && (input.draft.images.length < 1 || input.draft.images.length > imagePostCapacity)
        ? `工作台图文支持 1–18 张图片，当前为 ${input.draft.images.length} 张`
        : input.draft.images.length
          ? `${input.draft.images.filter((image) => image.available).length}/${input.draft.images.length} 张可读取`
          : "本稿未配置图片",
      issueCode: isImagePost && (input.draft.images.length < 1 || input.draft.images.length > imagePostCapacity)
        ? "PREFLIGHT_IMAGE_POST_IMAGE_COUNT"
        : input.draft.images.length === 0
          ? "PREFLIGHT_IMAGES_EMPTY"
          : input.draft.images.every((image) => image.available)
            ? undefined
            : "PREFLIGHT_IMAGES_MISSING",
      action: isImagePost && (input.draft.images.length < 1 || input.draft.images.length > imagePostCapacity)
        ? "在图集选择 1–18 张原图，并确认顺序。"
        : input.draft.images.length === 0
          ? "建议从原文或已核验素材库补充至少一张配图。"
          : "重新下载缺失图片，或从正文中移除对应图片位置。",
    },
    {
      id: "captions",
      label: "图注",
      status: input.draft.images.every((image) => image.caption?.trim()) ? "pass" : "blocked",
      required: input.draft.images.length > 0,
      detail: input.draft.images.length
        ? `${input.draft.images.filter((image) => image.caption?.trim()).length}/${input.draft.images.length} 张有图注`
        : "无图片，无需图注",
      issueCode: input.draft.images.every((image) => image.caption?.trim())
        ? undefined
        : "PREFLIGHT_CAPTIONS_MISSING",
      action: "为每张待上传图片填写可读图注，避免平台出现“请输入图片描述”。",
    },
    {
      id: "community",
      label: "关联社区",
      status: input.draft.community.trim() ? "pass" : "blocked",
      required: true,
      detail: input.draft.community.trim() || "尚未选择社区",
      issueCode: input.draft.community.trim() ? undefined : "PREFLIGHT_COMMUNITY_MISSING",
      action: "先选择一个真实存在的小黑盒社区。",
    },
    {
      id: "topics",
      label: "关联话题",
      status: topics.length > 5
        ? "blocked"
        : topics.length > 0
          ? "pass"
          : isImagePost
            ? "warning"
            : "blocked",
      required: !isImagePost,
      detail: topics.length > 5
        ? `已选 ${topics.length} 个，平台最多 5 个`
        : topics.length
          ? `已选 ${topics.length} 个`
          : isImagePost
            ? "本篇未选择话题；不会自动生成标签"
            : "尚未选择话题",
      issueCode: topics.length > 5
        ? "PREFLIGHT_TOPICS_TOO_MANY"
        : topics.length === 0 && !isImagePost
          ? "PREFLIGHT_TOPICS_MISSING"
          : topics.length === 0
            ? "PREFLIGHT_TOPICS_SKIPPED"
          : undefined,
      action: "选择 1–5 个已在小黑盒确认过的话题。",
    },
  ];

  if (isImagePost && input.runtime.mode === "cdp") {
    const protocol = capabilities.find(capability => capability.id === "protocol")!;
    Object.assign(protocol, { label: "图文通道", status: "blocked", required: true, detail: "图文图集需要常用 Chrome 填入助手；CDP 备用通道仅支持文章", issueCode: "PREFLIGHT_IMAGE_POST_EXTENSION_REQUIRED", action: "切换到常用 Chrome 填入助手" });
  }
  const blocking: PublisherPreflightIssue[] = capabilities
    .filter((capability) => capability.status === "blocked")
    .map((capability) => ({
      code: capability.issueCode || `PREFLIGHT_${capability.id.toUpperCase()}_BLOCKED`,
      capability: capability.id,
      severity: "blocking" as const,
      message: capability.detail,
      action: capability.action,
    }));
  const warnings: PublisherPreflightIssue[] = capabilities
    .filter((capability) => capability.status === "warning" || capability.status === "unknown")
    .map((capability) => ({
      code: capability.status === "unknown"
        ? capability.issueCode || `PREFLIGHT_${capability.id.toUpperCase()}_UNKNOWN`
        : capability.issueCode || `PREFLIGHT_${capability.id.toUpperCase()}_WARNING`,
      capability: capability.id,
      severity: "warning" as const,
      message: capability.detail,
      action: capability.action,
    }));
  const queueBlocking = blocking.filter((issue) => issue.capability !== "login" && issue.capability !== "editor");
  const requiredUnknown = capabilities.some(
    (capability) => capability.required && capability.status === "unknown",
  );
  const publishReady = blocking.length === 0 && !requiredUnknown;

  return {
    checkedAt: input.checkedAt || new Date().toISOString(),
    draftId: input.draft.id,
    mode: input.runtime.mode,
    protocolVersion,
    draftImageIds: input.draft.images.map((image) => image.id),
    expectedRevisionHash: input.expectedRevisionHash,
    minimumProtocolVersion,
    canQueueFill: queueBlocking.length === 0,
    publishReady,
    requiresLiveProbe: requiredUnknown,
    capabilities,
    blocking,
    warnings,
    summary: publishReady
      ? "已通过填入前检查，可以安全填入编辑器"
      : queueBlocking.length === 0
        ? "草稿已准备好；登录和编辑器将在填入时自动确认"
        : `有 ${queueBlocking.length} 项阻止填入，请先处理`,
    finalPublish: {
      manualOnly: true,
      willClickPublish: false,
      detail: "系统只填入并核验编辑器内容，最终发布必须由用户手动点击。",
    },
  };
};

/**
 * Creates an immutable audit record before transport work starts. A blocked
 * attempt is still worth recording because it explains why no browser job was
 * queued.
 */
export const createPublisherAttempt = (
  preflight: PublisherPreflightResult,
  options: PublisherAttemptOptions = {},
): PublisherAttemptRecord => ({
  schemaVersion: "publisher-attempt/v1",
  id: options.attemptId || `fill_${randomUUID()}`,
  draftId: preflight.draftId,
  mode: preflight.mode,
  status: preflight.canQueueFill ? "running" : "blocked",
  startedAt: options.startedAt || new Date().toISOString(),
  preflight,
  safety: {
    operation: "fill-only",
    finalPublishAllowed: false,
  },
});

const reportStepFor = (steps: PublisherReportedStep[], id: PublisherCapabilityId) => {
  const patterns: Partial<Record<PublisherCapabilityId, RegExp>> = {
    login: /登录/,
    editor: /编辑器|页面操作/,
    title: /标题/,
    body: /正文/,
    images: /配图|图片/,
    captions: /图注|图片描述/,
    community: /分区|社区/,
    topics: /话题/,
  };
  const pattern = patterns[id];
  return pattern ? steps.find((step) => pattern.test(step.name)) : undefined;
};

/**
 * Turns the extension/CDP report into a stable receipt. The only successful
 * terminal state is `filled`; this module intentionally has no `published`
 * state and never exposes an operation that clicks the platform button.
 */
export const completePublisherAttempt = (
  attempt: PublisherAttemptRecord,
  report: PublisherAttemptReport,
): PublisherReceipt => {
  const requiredFillIds: PublisherCapabilityId[] = [
    "title",
    "body",
    "images",
    "community",
    "topics",
  ];
  const editorWriteSucceeded = reportStepFor(report.steps, "title")?.ok === true
    && reportStepFor(report.steps, "body")?.ok === true
    && !report.steps.some((step) => !step.ok && /登录|编辑器|页面操作/.test(step.name));
  const checks = attempt.preflight.capabilities.map<PublisherReceiptCheck>((capability) => {
    const reported = reportStepFor(report.steps, capability.id);
    if (reported) {
      return {
        id: capability.id,
        label: capability.label,
        ok: reported.ok,
        source: "extension-report",
        detail: reported.detail,
      };
    }
    if (requiredFillIds.includes(capability.id)) {
      const reportLabel: Partial<Record<PublisherCapabilityId, string>> = {
        title: "标题",
        body: "正文",
        images: "配图",
        community: "分区",
        topics: "话题",
      };
      return {
        id: capability.id,
        label: capability.label,
        ok: false,
        source: "extension-report",
        detail: `扩展没有返回${reportLabel[capability.id] || capability.label}核验结果`,
      };
    }
    if ((capability.id === "login" || capability.id === "editor") && editorWriteSucceeded) {
      return {
        id: capability.id,
        label: capability.label,
        ok: true,
        source: "fill-inference",
        detail: capability.id === "login"
          ? "编辑器已接受标题和正文，可确认当前会话已登录"
          : "标题和正文均已写入，可确认文章编辑器可用",
      };
    }
    if (capability.id === "captions") {
      const images = reportStepFor(report.steps, "images");
      if (images && capability.status === "pass") {
        return {
          id: capability.id,
          label: capability.label,
          ok: images.ok,
          source: "extension-report",
          detail: images.ok ? `${images.detail}；图注已在填入前核验` : images.detail,
        };
      }
    }
    return {
      id: capability.id,
      label: capability.label,
      ok: capability.status === "pass",
      source: "preflight",
      detail: capability.detail,
    };
  });

  const blocking = checks
    .filter((check) => !check.ok)
    .map((check) => ({ id: check.id, detail: check.detail }));
  const succeededCount = checks.filter((check) => check.ok).length;
  const outcome: PublisherReceipt["outcome"] = attempt.status === "blocked"
    ? "blocked"
    : blocking.length === 0
      ? "filled"
      : succeededCount === 0
        ? "failed"
        : "partial";
  const warnings = attempt.preflight.warnings.filter(
    (warning) => !checks.find((check) => check.id === warning.capability)?.ok,
  );
  const imageCheck = checks.find((check) => check.id === "images");
  const usedImageIds = outcome === "filled" && imageCheck?.ok
    ? [...attempt.preflight.draftImageIds]
    : undefined;

  return {
    schemaVersion: "publisher-receipt/v1",
    attemptId: attempt.id,
    draftId: attempt.draftId,
    mode: attempt.mode,
    protocolVersion: attempt.preflight.protocolVersion,
    startedAt: attempt.startedAt,
    completedAt: report.completedAt || new Date().toISOString(),
    outcome,
    pageUrl: report.pageUrl,
    diagnosticScreenshot: report.diagnosticScreenshot,
    revisionHash: attempt.preflight.expectedRevisionHash,
    checks,
    blocking,
    warnings,
    usedImageIds,
    safety: {
      operation: "fill-only",
      finalPublishAttempted: false,
      finalPublishPerformed: false,
    },
    summary: outcome === "filled"
      ? "内容已填入并完成逐项核验；最终发布仍需用户手动点击。"
      : outcome === "blocked"
        ? `预检发现 ${blocking.length} 项阻断，未向浏览器发送填入任务；不会执行最终发布。`
        : `填入未完整完成，还有 ${blocking.length} 项需要处理；不会执行最终发布。`,
  };
};
