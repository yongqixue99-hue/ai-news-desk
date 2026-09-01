export type {
  ArticleDraft,
  ArticleAgentDraftInput,
  ArticleAgentMessage,
  ArticleAgentRole,
  ArticleAgentThread,
  ArticleAnalysisResult,
  ArticleOptimizationResult,
  ArticleOptimizationChange,
  ArticleDraftStrategy,
  ArticleEditMode,
  ArticleWritingDiagnostic,
  WritingQualityAssessment,
  AiProviderConfig,
  AiSettings,
  ArticleSkillConfig,
  ArticleSkillScope,
  CollectionRequest,
  CollectionTopicDefinition,
  CollectionTopicId,
  DraftRevision,
  DraftFactEvidenceStatus,
  Candidate,
  CandidateExplanation,
  CandidateFeedback,
  CandidateFeedbackKind,
  DraftImagePlacement,
  DraftLayoutTheme,
  DraftSaveMode,
  EditorialBrief,
  EditorialMemory,
  EditorialProfile,
  EditorialSuggestion,
  EditorialSuggestionStatus,
  EditorialSystemView,
  WritingMemory,
  WritingMemoryEvidence,
  WritingMemoryKind,
  WritingMemoryView,
  AutomaticSourceReading,
  ImageMaterial,
  IntakeReviewRecord,
  PublisherResult,
  PublisherStatus,
  PlatformPublicationConfirmation,
  PublicationPlatform,
  ProviderHealthResult,
  Settings,
  SourceConfig,
  SourcePreset,
  SourceProbeResult,
  SourceRole,
  SourceRoute,
  WorkflowRun,
  WorkflowNotification,
  WorkflowState,
  WeChatChannelSettings,
  WeChatConnectionResult,
  WeChatDraftSyncReceipt,
} from "../server/types.js";
export type { AiRunTrace } from "../server/ai-run-observability.js";
export type { EvidenceBundle, EvidenceReviewSelection } from "../server/intake-review.js";
export type { PublishedImagePromotionPublicStatus } from "../server/published-materials.js";
export type {
  AssetCandidate,
  AssignmentDecision,
  AssignmentMode,
  ContentPackage,
  ContentPackageSource,
  DiscussionSample,
  EvidenceClaim,
  EvidenceStrength,
  EditorialIntent,
  EditorialIntentOption,
  EditorialIntakeView,
  EditorialSourceKind,
  SourceMaterialSnapshot,
  StorySignalView,
  StoryExplanation,
  StoryExplanationSource,
  StoryTrendView,
  StoryView,
  TodayFunnel,
  TodaySourceDiagnostic,
  TodayView,
} from "../server/product-types.js";
export type {
  PublisherPreflightResult,
  PublisherReceipt,
} from "../server/publisher-preflight.js";

import type { PublisherStatus } from "../server/types.js";

export type AppPage = "today" | "workbench" | "community" | "drafts" | "sources" | "editorial-system" | "schedule" | "runs" | "ai-settings";

export interface HealthState {
  ok: boolean;
  codex: { ok: boolean; detail: string };
  publisher: PublisherStatus;
  horizon: { ok: boolean; detail: string };
}
