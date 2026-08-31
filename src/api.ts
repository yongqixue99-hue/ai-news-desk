import type {
  ArticleDraft,
  ArticleAgentDraftInput,
  ArticleAgentRole,
  ArticleAgentThread,
  AiProviderConfig,
  AiSettings,
  ArticleSkillConfig,
  CandidateFeedback,
  CandidateFeedbackKind,
  CollectionRequest,
  DraftImagePlacement,
  DraftRevision,
  DraftSaveMode,
  EditorialProfile,
  EditorialSystemView,
  HealthState,
  ImageMaterial,
  IntakeReviewRecord,
  EvidenceReviewSelection,
  PublisherResult,
  PublisherPreflightResult,
  PublishedImagePromotionPublicStatus,
  PublisherStatus,
  PlatformPublicationConfirmation,
  ProviderHealthResult,
  Settings,
  SourceConfig,
  SourcePreset,
  SourceProbeResult,
  WorkflowRun,
  WorkflowNotification,
  WorkflowState,
  AssignmentMode,
  ContentPackage,
  StoryView,
  TodayView,
  WeChatChannelSettings,
  WeChatConnectionResult,
  WeChatDraftSyncReceipt,
} from "./types";

const request = async <T>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error || `请求失败：${response.status}`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export interface RunRequestResult {
  run: WorkflowRun;
  created: boolean;
  reused: boolean;
}

export interface IntakeRequestResult {
  run: WorkflowRun;
  draftId: string;
}

export interface IntakeReviewRequestResult {
  review: IntakeReviewRecord;
}

export interface MaterialMetadataInput {
  title: string;
  attribution: string;
  sourceUrl?: string;
  tags: string[];
  rights: ImageMaterial["rights"];
  evidenceNote?: string;
  evidencePath?: string;
  licenseId?: string;
  licenseUrl?: string;
  modificationNote?: string;
  allowedPlatforms: string[];
  expiresAt?: string;
  entityTags: string[];
}

export interface StorageUsage {
  stateBytes: number;
  backupBytes: number;
  databaseBytes: number;
  legacyStateBytes: number;
  mediaBytes: number;
  materialBytes: number;
  jobBytes: number;
  totalBytes: number;
}

export interface RestoreResult {
  ok: true;
  restoredAt: string;
  stateVersion: number;
  counts: { sources: number; drafts: number; runs: number; materials: number };
}

export interface ProductFeedbackEvent {
  id: string;
  type: string;
  subjectType: "signal" | "story" | "package" | "draft" | "delivery";
  subjectId: string;
  reason?: string;
  payload?: unknown;
  createdAt: string;
}

export interface StoryDetailResult {
  story: StoryView;
  contentPackage?: ContentPackage;
  feedback: ProductFeedbackEvent[];
}

export interface StoryExplanationRequestResult {
  job?: ProductJob;
  story: StoryView;
  reused: boolean;
}

export interface StoryEvidenceRequestResult {
  job?: ProductJob;
  story: StoryView;
  reused: boolean;
}

export interface ContentPackageRequestResult {
  job: ProductJob;
  contentPackage?: ContentPackage;
  reused: boolean;
}

export interface ShellView {
  notifications: WorkflowNotification[];
  notificationsMuted: boolean;
  activeRunCount: number;
}

export interface ProductJob {
  id: string;
  type: string;
  idempotencyKey: string;
  status: "queued" | "running" | "retrying" | "complete" | "failed" | "cancelled";
  payload: unknown;
  result?: { draftId?: string; reused?: boolean; imageCount?: number } | unknown;
  progress: number;
  stage?: string;
  heartbeatAt?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  error?: string;
}

export const api = {
  bootstrap: () => request<WorkflowState>("/api/bootstrap"),
  shell: () => request<ShellView>("/api/shell"),
  today: () => request<TodayView>("/api/today"),
  story: (storyId: string) => request<StoryDetailResult>(`/api/stories/${storyId}`),
  explainStory: (storyId: string, force = false) => request<StoryExplanationRequestResult>(`/api/stories/${storyId}/explanation`, {
    method: "POST",
    body: JSON.stringify({ force }),
  }),
  supplementStoryEvidence: (storyId: string) => request<StoryEvidenceRequestResult>(`/api/stories/${storyId}/evidence`, {
    method: "POST",
    body: "{}",
  }),
  recordStoryEvent: (
    storyId: string,
    type: "opened" | "interested" | "not_interested" | "package_created" | "drafted" | "synced" | "published",
    reason?: string,
    payload?: Record<string, unknown>,
  ) => request<{ event: ProductFeedbackEvent; story?: StoryView }>(`/api/stories/${storyId}/events`, {
    method: "POST",
    body: JSON.stringify({ type, reason, payload }),
  }),
  restoreStoryFeedback: (storyId: string) =>
    request<{ event: ProductFeedbackEvent; story: StoryView }>(`/api/stories/${storyId}/feedback`, { method: "DELETE" }),
  createContentPackage: (storyId: string, mode?: Exclude<AssignmentMode, "watch" | "skip">, force = false) =>
    request<ContentPackageRequestResult>(`/api/stories/${storyId}/packages`, {
      method: "POST",
      body: JSON.stringify({ mode, force }),
    }),
  contentPackage: (packageId: string) => request<ContentPackage>(`/api/packages/${packageId}`),
  createDraftFromPackage: (packageId: string) =>
    request<{ job: ProductJob; draft?: ArticleDraft; reused: boolean }>(`/api/packages/${packageId}/draft`, {
      method: "POST",
      body: "{}",
    }),
  productJob: (jobId: string) => request<ProductJob>(`/api/product/jobs/${jobId}`),
  productJobs: (limit = 12) => request<ProductJob[]>(`/api/product/jobs?limit=${encodeURIComponent(String(limit))}`),
  editorialSystem: () => request<EditorialSystemView>("/api/editorial-system"),
  saveEditorialProfile: (profile: Partial<EditorialProfile>) =>
    request<EditorialSystemView>("/api/editorial-system/profile", {
      method: "PATCH",
      body: JSON.stringify(profile),
    }),
  decideEditorialSuggestion: (suggestionId: string, decision: "adopted" | "ignored") =>
    request<EditorialSystemView>(`/api/editorial-system/suggestions/${suggestionId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  setWritingMemoryEnabled: (memoryId: string, enabled: boolean) =>
    request<EditorialSystemView["writingMemories"]>(`/api/editorial-memories/${memoryId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  deleteWritingMemory: (memoryId: string) =>
    request<EditorialSystemView["writingMemories"]>(`/api/editorial-memories/${memoryId}`, {
      method: "DELETE",
    }),
  markNotificationRead: (notificationId: string) =>
    request<WorkflowNotification[]>(`/api/notifications/${notificationId}/read`, {
      method: "PATCH",
      body: "{}",
    }),
  markAllNotificationsRead: () =>
    request<WorkflowNotification[]>("/api/notifications/read-all", {
      method: "POST",
      body: "{}",
    }),
  health: () => request<HealthState>("/api/health"),
  storageUsage: () => request<StorageUsage>("/api/data/storage"),
  exportData: async () => {
    const response = await fetch("/api/data/export");
    if (!response.ok) throw new Error(`导出失败：${response.status}`);
    return response.blob();
  },
  exportPortableArchive: async () => {
    const response = await fetch("/api/data/archive");
    if (!response.ok) throw new Error(`完整归档导出失败：${response.status}`);
    return response.blob();
  },
  restoreData: (backup: unknown) => request<RestoreResult>("/api/data/restore", {
    method: "POST",
    body: JSON.stringify(backup),
  }),
  saveSettings: (settings: Partial<Settings>) =>
    request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(settings) }),
  saveWeChatSettings: (
    settings: Partial<WeChatChannelSettings> & { appSecret?: string; clearAppSecret?: boolean },
  ) => request<WeChatChannelSettings>("/api/wechat/settings", {
    method: "PATCH",
    body: JSON.stringify(settings),
  }),
  testWeChatConnection: () => request<WeChatConnectionResult>("/api/wechat/test", {
    method: "POST",
    body: "{}",
  }),
  addSource: (source: Partial<SourceConfig>) =>
    request<SourceConfig>("/api/sources", { method: "POST", body: JSON.stringify(source) }),
  saveSource: (sourceId: string, source: Partial<SourceConfig>) =>
    request<SourceConfig>(`/api/sources/${sourceId}`, {
      method: "PATCH",
      body: JSON.stringify(source),
    }),
  deleteSource: (sourceId: string) =>
    request<void>(`/api/sources/${sourceId}`, { method: "DELETE" }),
  batchSources: (sourceIds: string[], patch: { enabled?: boolean; selected?: boolean }) =>
    request<{ sources: SourceConfig[]; updated: number }>("/api/sources/batch", {
      method: "PATCH",
      body: JSON.stringify({ sourceIds, ...patch }),
    }),
  testSource: (sourceId: string) =>
    request<{ source: SourceConfig; result: SourceProbeResult }>(`/api/sources/${sourceId}/test`, {
      method: "POST",
      body: "{}",
    }),
  createSourcePreset: (name: string, sourceIds: string[]) =>
    request<SourcePreset>("/api/source-presets", {
      method: "POST",
      body: JSON.stringify({ name, sourceIds }),
    }),
  applySourcePreset: (presetId: string) =>
    request<{ preset: SourcePreset; sources: SourceConfig[] }>(`/api/source-presets/${presetId}/apply`, {
      method: "POST",
      body: "{}",
    }),
  deleteSourcePreset: (presetId: string) =>
    request<void>(`/api/source-presets/${presetId}`, { method: "DELETE" }),
  collect: (filters: CollectionRequest = {}) =>
    request<RunRequestResult>("/api/runs/collect", {
      method: "POST",
      body: JSON.stringify(filters),
    }),
  cancelRun: (runId: string) =>
    request<WorkflowRun>(`/api/runs/${runId}/cancel`, { method: "POST", body: "{}" }),
  retryRun: (runId: string) =>
    request<RunRequestResult>(`/api/runs/${runId}/retry`, { method: "POST", body: "{}" }),
  briefCandidates: (runId: string, candidateIds?: string[]) =>
    request<{ run: WorkflowRun; requested: number; completed: number; failed: number }>(
      `/api/runs/${runId}/briefings`,
      { method: "POST", body: JSON.stringify({ candidateIds }) },
    ),
  selectCandidate: (runId: string, candidateId: string, selected: boolean) =>
    request(`/api/runs/${runId}/candidates/${candidateId}`, {
      method: "PATCH",
      body: JSON.stringify({ selected }),
    }),
  setCandidateFeedback: (
    runId: string,
    candidateId: string,
    kind: Extract<CandidateFeedbackKind, "interested" | "not_interested">,
  ) => request<{ feedback: CandidateFeedback; run: WorkflowRun; feedbackCount: number }>(
    `/api/runs/${runId}/candidates/${candidateId}/feedback`,
    { method: "POST", body: JSON.stringify({ kind }) },
  ),
  restoreCandidateFeedback: (runId: string, candidateId: string) =>
    request<{ run: WorkflowRun; feedbackCount: number }>(
      `/api/runs/${runId}/candidates/${candidateId}/feedback`,
      { method: "DELETE" },
    ),
  clearCandidateFeedback: () =>
    request<{ cleared: number; feedbackCount: number }>("/api/candidate-feedback", { method: "DELETE" }),
  clearCandidates: (runId: string, candidateIds?: string[]) =>
    request<{ run: WorkflowRun; cleared: number }>(`/api/runs/${runId}/candidates`, {
      method: "DELETE",
      body: JSON.stringify({ candidateIds }),
    }),
  intakeUrl: (url: string) =>
    request<IntakeReviewRequestResult>("/api/intakes/url", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  intakeScreenshot: async (file: File, note?: string) => {
    const response = await fetch("/api/intakes/screenshot", {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || "网页截图"),
        "x-intake-note": encodeURIComponent(note || ""),
      },
      body: file,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `截图提交失败：${response.status}`);
    }
    return response.json() as Promise<IntakeReviewRequestResult>;
  },
  intakeReviews: () => request<IntakeReviewRecord[]>("/api/intakes/reviews"),
  confirmIntakeReview: (reviewId: string, selection: EvidenceReviewSelection) =>
    request<{ review: IntakeReviewRecord; run: WorkflowRun; draftId: string }>(`/api/intakes/reviews/${reviewId}/confirm`, {
      method: "POST",
      body: JSON.stringify(selection),
    }),
  generate: (runId: string, candidateIds?: string[]) =>
    request<{
      accepted: boolean;
      reused: boolean;
      alreadyGenerated: boolean;
      selectedCount: number;
      providerName: string;
    }>(`/api/runs/${runId}/generate`, {
      method: "POST",
      body: JSON.stringify({ candidateIds }),
    }),
  createCommunityDraft: (
    runId: string,
    candidateId: string,
    mode: "source" | "translation" | "curation",
  ) => request<ArticleDraft>(`/api/runs/${runId}/candidates/${candidateId}/community-draft`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  }),
  saveDraft: (draftId: string, draft: Partial<ArticleDraft>, saveMode: DraftSaveMode = "manual") =>
    request<ArticleDraft>(`/api/drafts/${draftId}`, {
      method: "PATCH",
      body: JSON.stringify({ ...draft, _saveMode: saveMode }),
    }),
  draftRevisions: (draftId: string) =>
    request<DraftRevision[]>(`/api/drafts/${draftId}/revisions`),
  restoreDraftRevision: (draftId: string, revisionId: string) =>
    request<{ draft: ArticleDraft; revisions: DraftRevision[] }>(
      `/api/drafts/${draftId}/revisions/${revisionId}/restore`,
      { method: "POST", body: "{}" },
    ),
  uploadDraftImage: async (draftId: string, file: File) => {
    const response = await fetch(`/api/drafts/${draftId}/media`, {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || "本地图片"),
      },
      body: file,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `图片上传失败：${response.status}`);
    }
    return response.json() as Promise<DraftImagePlacement>;
  },
  importDraftImage: (draftId: string, url: string, caption?: string) =>
    request<DraftImagePlacement>(`/api/drafts/${draftId}/media-from-url`, {
      method: "POST",
      body: JSON.stringify({ url, caption }),
    }),
  saveAiProvider: (
    providerId: string,
    patch: Partial<AiProviderConfig> & { apiKey?: string; clearApiKey?: boolean; active?: boolean },
  ) => request<AiSettings>(`/api/ai/providers/${providerId}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  }),
  testAiProvider: (providerId: string) =>
    request<{ result: ProviderHealthResult; aiSettings: AiSettings }>(`/api/ai/providers/${providerId}/test`, {
      method: "POST",
      body: "{}",
    }),
  saveAgentRole: (role: ArticleAgentRole, providerId: string) =>
    request<AiSettings>("/api/ai/agent-roles", {
      method: "PATCH",
      body: JSON.stringify({ role, providerId }),
    }),
  saveWritingReviewMode: (mode: AiSettings["writingReviewMode"]) =>
    request<AiSettings>("/api/ai/writing-review", {
      method: "PATCH",
      body: JSON.stringify({ mode }),
    }),
  saveSkill: (skillId: string, enabled: boolean) =>
    request<ArticleSkillConfig[]>(`/api/ai/skills/${skillId}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    }),
  importSkill: (path: string) =>
    request<ArticleSkillConfig[]>("/api/ai/skills/import", {
      method: "POST",
      body: JSON.stringify({ path }),
    }),
  uploadMaterial: async (
    file: File,
    metadata: MaterialMetadataInput,
  ) => {
    const response = await fetch("/api/materials", {
      method: "POST",
      headers: {
        "content-type": file.type || "application/octet-stream",
        "x-file-name": encodeURIComponent(file.name || "图片素材"),
        "x-material-title": encodeURIComponent(metadata.title),
        "x-material-attribution": encodeURIComponent(metadata.attribution),
        "x-material-source-url": encodeURIComponent(metadata.sourceUrl || ""),
        "x-material-tags": encodeURIComponent(metadata.tags.join(",")),
        "x-material-rights": metadata.rights,
        "x-material-evidence-note": encodeURIComponent(metadata.evidenceNote || ""),
        "x-material-evidence-path": encodeURIComponent(metadata.evidencePath || ""),
        "x-material-license-id": encodeURIComponent(metadata.licenseId || ""),
        "x-material-license-url": encodeURIComponent(metadata.licenseUrl || ""),
        "x-material-modification-note": encodeURIComponent(metadata.modificationNote || ""),
        "x-material-allowed-platforms": encodeURIComponent(metadata.allowedPlatforms.join(",")),
        "x-material-expires-at": encodeURIComponent(metadata.expiresAt || ""),
        "x-material-entity-tags": encodeURIComponent(metadata.entityTags.join(",")),
      },
      body: file,
    });
    if (!response.ok) {
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || `素材上传失败：${response.status}`);
    }
    return response.json() as Promise<ImageMaterial>;
  },
  importMaterial: (
    url: string,
    metadata: MaterialMetadataInput,
  ) => request<ImageMaterial>("/api/materials/from-url", {
    method: "POST",
    body: JSON.stringify({ url, ...metadata }),
  }),
  deleteMaterial: (materialId: string) =>
    request<void>(`/api/materials/${materialId}`, { method: "DELETE" }),
  insertMaterial: (draftId: string, materialId: string) =>
    request<DraftImagePlacement>(`/api/drafts/${draftId}/materials/${materialId}`, {
      method: "POST",
    body: "{}",
  }),
  syncWeChatDraft: (
    draftId: string,
    input: { author?: string; digest?: string; contentSourceUrl?: string },
  ) => request<{ receipt: WeChatDraftSyncReceipt; draft: ArticleDraft }>(
    `/api/drafts/${draftId}/wechat-sync`,
    { method: "POST", body: JSON.stringify(input) },
  ),
  publishedImageMaterialStatuses: (draftId: string) =>
    request<{ statuses: PublishedImagePromotionPublicStatus[] }>(
      `/api/drafts/${draftId}/published-images/material-status`,
    ),
  savePublishedImageMaterial: (draftId: string, placementId: string) =>
    request<{ material: ImageMaterial; status: PublishedImagePromotionPublicStatus }>(
      `/api/drafts/${draftId}/images/${placementId}/save-material`,
      { method: "POST", body: "{}" },
    ),
  articleAgentThreads: (draftId: string) =>
    request<ArticleAgentThread[]>(`/api/drafts/${draftId}/agent/threads`),
  runArticleAgent: (
    draftId: string,
    role: ArticleAgentRole,
    draft: ArticleAgentDraftInput,
  ) => request<ArticleAgentThread>(`/api/drafts/${draftId}/agent/threads`, {
    method: "POST",
    body: JSON.stringify({ role, draft }),
  }),
  askArticleAgent: (
    draftId: string,
    threadId: string,
    message: string,
    draft: ArticleAgentDraftInput,
  ) => request<ArticleAgentThread>(`/api/drafts/${draftId}/agent/threads/${threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ message, draft }),
  }),
  publisherStatus: () => request<PublisherStatus>("/api/publisher/status"),
  publisherPreflight: (draftId: string) =>
    request<PublisherPreflightResult>(`/api/drafts/${draftId}/publisher-preflight`),
  launchPublisher: () =>
    request<{ ok: boolean; detail: string }>("/api/publisher/launch", {
      method: "POST",
      body: "{}",
    }),
  fillDraft: (draftId: string) =>
    request<PublisherResult>(`/api/drafts/${draftId}/fill`, {
      method: "POST",
      body: "{}",
    }),
  confirmPublished: (draftId: string, platform: "xiaoheihe" | "wechat" = "xiaoheihe") =>
    request<{ confirmation: PlatformPublicationConfirmation; recentTopics: string[]; recentCommunities: string[] }>(
      `/api/drafts/${draftId}/publish-confirmed`,
      { method: "POST", body: JSON.stringify({ platform }) },
    ),
};
