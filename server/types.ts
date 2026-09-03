import type { AiRunTrace } from "./ai-run-observability.js";
import type {
  EvidenceBundle,
  EvidenceReviewSelection,
} from "./intake-review.js";
import type {
  PublisherPreflightResult,
  PublisherReceipt,
} from "./publisher-preflight.js";

export const WORKFLOW_STATE_VERSION = 15 as const;

export type RunStatus =
  | "queued"
  | "collecting"
  | "scoring"
  | "extracting"
  | "ready"
  | "generating"
  | "complete"
  | "failed"
  | "cancelled";

export type SourceKind = "rss" | "hackernews" | "google_news" | "zhihu" | "last30days" | "github" | "x";
export type SourceRole = "official" | "verification" | "research" | "discovery" | "community";
export type SourceHealthStatus = "unknown" | "healthy" | "warning" | "error";
export type CollectionTopicId =
  | "ai"
  | "technology"
  | "gaming"
  | "esports"
  | "politics"
  | "business"
  | "science";

export interface CollectionTopicDefinition {
  id: CollectionTopicId;
  label: string;
  description: string;
  query: string;
  keywords: string[];
}

export interface SourceRoute {
  topicId: CollectionTopicId;
  label: string;
  /** The section page a person should open on the publisher's official site. */
  homepageUrl?: string;
  /** A direct RSS/Atom endpoint used only by the collector. */
  url?: string;
  /** A site-scoped discovery query converted to a Google News RSS endpoint at run time. */
  query?: string;
  category?: string;
}

export type XAccountClass =
  | "vendor_official"
  | "product_official"
  | "developer_official"
  | "platform_official"
  | "official_executive"
  | "research_platform"
  | "unreviewed";

/** Stable identity learned from the X API; handles remain mutable display data. */
export interface XAccountIdentity {
  userId: string;
  username: string;
  usernameHistory: string[];
  role: "official" | "research" | "discovery";
  accountKind: XAccountClass;
  priority: "critical" | "core" | "observer";
  vendor?: string;
  policyReviewed: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  status: "observed" | "handle-changed" | "identity-conflict";
}

export interface SourceConfig {
  id: string;
  name: string;
  kind: SourceKind;
  /** Human-facing root website. Collector endpoints stay in url/routes. */
  homepageUrl?: string;
  url?: string;
  query?: string;
  /** Opaque incremental cursor owned by the source adapter. */
  cursor?: string;
  /** X-only stable account registry. It never contains credentials or private profile data. */
  xAccounts?: XAccountIdentity[];
  topicIds?: CollectionTopicId[];
  routes?: SourceRoute[];
  enabled: boolean;
  selected: boolean;
  category: string;
  /** Editorial use, separate from the subject category and transport kind. */
  role?: SourceRole;
  discoveryOnly: boolean;
  note?: string;
  health?: SourceHealthStatus;
  lastCheckedAt?: string;
  lastRawCount?: number;
  lastCandidateCount?: number;
  lastHealthDetail?: string;
  lastSuccessfulAt?: string;
  consecutiveFailures?: number;
}

export interface SourceProbeResult {
  sourceId: string;
  status: Exclude<SourceHealthStatus, "unknown">;
  checkedAt: string;
  successfulAt?: string;
  consecutiveFailures: number;
  itemCount: number;
  detail: string;
  targetUrl: string;
  httpStatus?: number;
}

export interface SourcePreset {
  id: string;
  name: string;
  sourceIds: string[];
  createdAt: string;
  updatedAt: string;
}

/** User-owned hard constraints. Background editorial jobs may read but never write this record. */
export interface EditorialProfile {
  positioning: string;
  audience: string;
  goals: string[];
  preferredTopicIds: CollectionTopicId[];
  voiceGuidelines: string[];
  redLines: string[];
  updatedAt?: string;
}

export interface EditorialSystemState {
  profile: EditorialProfile;
  suggestionDecisions: EditorialSuggestion[];
}

export type EditorialSuggestionKind = "source-promote" | "source-demote" | "topic-add" | "profile-note";
export type EditorialSuggestionStatus = "pending" | "adopted" | "ignored";

export interface EditorialSuggestion {
  id: string;
  kind: EditorialSuggestionKind;
  targetId?: string;
  label: string;
  reason: string;
  confidence: "low" | "medium" | "high";
  status: EditorialSuggestionStatus;
  createdAt: string;
  decidedAt?: string;
}

export interface EditorialBriefSupportingItem {
  title: string;
  url: string;
  sourceName: string;
}

export interface EditorialBriefItem {
  eventId: string;
  runId: string;
  candidateId: string;
  title: string;
  url: string;
  sourceName: string;
  publishedAt: string;
  ageHours: number;
  excerpt: string;
  topicIds: CollectionTopicId[];
  recommendationScore: number;
  evidence: string;
  supporting: EditorialBriefSupportingItem[];
}

export interface EditorialBrief {
  generatedAt: string;
  hardWindowHours: 48;
  mustReads: EditorialBriefItem[];
  coverageGaps: CollectionTopicId[];
  excludedDuplicateCount: number;
  excludedStaleCount: number;
  excludedUndatedCount: number;
}

export interface EditorialMemorySourceSignal {
  name: string;
  score: number;
  feedbackCount: number;
}

export interface EditorialMemoryTopicSignal {
  topicId: CollectionTopicId;
  score: number;
  feedbackCount: number;
}

export interface EditorialMemory {
  generatedAt: string;
  windowDays: 30;
  feedbackCount: number;
  publishedCount: number;
  preferredSources: EditorialMemorySourceSignal[];
  avoidedSources: EditorialMemorySourceSignal[];
  topicSignals: EditorialMemoryTopicSignal[];
  recentPublishedTitles: string[];
}

export type WritingMemoryKind =
  | "remove-promotional-language"
  | "prefer-specific-numbers"
  | "shorter-introduction"
  | "fewer-headings"
  | "preserve-community-quotes"
  | "shorter-paragraphs"
  | "higher-image-density";

export interface WritingMemoryEvidence {
  eventId: string;
  draftId: string;
  summary: string;
  createdAt: string;
}

/** A transparent, user-controllable preference inferred only from real edits. */
export interface WritingMemory {
  id: string;
  kind: WritingMemoryKind;
  label: string;
  evidenceCount: number;
  enabled: boolean;
  applicable: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: WritingMemoryEvidence[];
}

export interface WritingMemoryView {
  effectiveEditCount: number;
  applicationThreshold: 5;
  applicationUnlocked: boolean;
  memories: WritingMemory[];
}

export interface AutomaticSourceReading {
  enabled: boolean;
  scheduleTime: string;
  sourceIds: string[];
  sourceNames: string[];
  lastRunId?: string;
  lastStatus?: RunStatus;
  lastReadAt?: string;
  lastError?: string;
}

export interface EditorialQualityBaseline {
  version: "editorial-golden/v1";
  total: number;
  passed: number;
  failed: number;
  categoryCounts: {
    news: number;
    community: number;
    source: number;
    visual: number;
    writing: number;
  };
}

export interface EditorialSystemView {
  profile: EditorialProfile;
  brief: EditorialBrief;
  memory: EditorialMemory;
  suggestions: EditorialSuggestion[];
  automaticReading: AutomaticSourceReading;
  writingMemories: WritingMemoryView;
  qualityBaseline: EditorialQualityBaseline;
}

export interface WeChatChannelSettings {
  /** Friendly label shown in the local UI; never sent as authentication data. */
  accountName: string;
  appId: string;
  defaultAuthor: string;
  /** The secret lives in the operating system's protected local store and is never serialized here. */
  appSecretConfigured: boolean;
  appSecretHint?: string;
}

export interface WeChatConnectionResult {
  ok: boolean;
  status: "connected" | "error";
  checkedAt: string;
  draftCount?: number;
  detail: string;
}

export interface Settings {
  windowHours: number;
  collectionTopics: CollectionTopicId[];
  /** Hard user-owned boundary for connectors and providers that can charge per request. */
  spendingPolicy: "zero-cost" | "allow-metered";
  /** Apply a small, capped editorial preference adjustment to candidate order. */
  personalizationEnabled: boolean;
  /** Keep notifications in the drawer without showing unread red badges. */
  notificationsMuted: boolean;
  scheduleEnabled: boolean;
  scheduleTime: string;
  lastScheduledDate?: string;
  draftMode: "separate" | "roundup";
  imagePolicy: "source" | "screenshot" | "none";
  imageLimit: number;
  autoGenerate: boolean;
  autoGenerateCount: number;
  community: string;
  /** Legacy generation preference. New drafts no longer auto-create platform topics. */
  defaultTopics: string[];
  /** Topics explicitly confirmed after a successful manual publication. */
  recentTopics: string[];
  /** Communities explicitly confirmed after a successful manual publication. */
  recentCommunities: string[];
  /** How a prepared draft is transferred into the Xiaoheihe editor. */
  publisherMode: "chrome-extension" | "cdp";
  xiaoheiheEditorUrl: string;
  chromeDebugPort: number;
  wechat: WeChatChannelSettings;
}

export interface ScoreBreakdown {
  consequence: number;
  novelty: number;
  evidence: number;
  relevance: number;
  timeliness: number;
  confirmation: number;
  penalty: number;
}

export interface HeatBreakdown {
  /** Public interaction signals such as Hacker News points and comments. */
  engagement: number;
  /** A transparent editorial prior for the reach of the originating outlet. */
  sourceReach: number;
  /** Independent publishers carrying a substantially similar story. */
  crossSource: number;
  freshness: number;
}

export interface CandidateEngagement {
  points?: number;
  comments?: number;
  discussionUrl?: string;
}

export interface SourceImage {
  id: string;
  url: string;
  localPath?: string;
  publicPath?: string;
  caption: string;
  attribution: string;
  sourceUrl: string;
  width?: number;
  height?: number;
  selected: boolean;
  rights:
    | "official"
    | "commentary-screenshot"
    | "editorial-screenshot"
    | "owned"
    | "licensed"
    | "check-required"
    | "expired";
  evidenceNote?: string;
  evidencePath?: string;
  /** Machine-readable public license identifier, for example CC-BY-4.0. */
  licenseId?: string;
  /** Public license terms URL that must remain visible with licensed media. */
  licenseUrl?: string;
  /** What this workspace changed after obtaining the source file. */
  modificationNote?: string;
  allowedPlatforms?: string[];
  expiresAt?: string;
  entityTags?: string[];
  fingerprint?: string;
  /** Editorial relevance order: source, screenshot, entity, related, generated. */
  editorialPriority?: 1 | 2 | 3 | 4 | 5;
  editorialOrigin?: "article-image" | "article-screenshot" | "entity-library" | "related-library" | "generated-fallback";
}

export interface Candidate {
  id: string;
  rawId: string;
  sourceType: string;
  sourceName: string;
  /** Original poster or publisher author when the connector exposes one. */
  author?: string;
  /** Editorial role of the originating connector, when known. */
  sourceRole?: SourceRole;
  title: string;
  url: string;
  canonicalUrl?: string;
  /** Stable source URL of the Story this evidence or research material belongs to. */
  evidenceGroupUrl?: string;
  /** Research material enriches a Story but does not count as an independent publisher. */
  evidenceRelation?: "independent-report" | "research-material";
  excerpt: string;
  publishedAt: string;
  fetchedAt: string;
  score: number;
  scoreBreakdown: ScoreBreakdown;
  heatScore: number;
  heatBreakdown: HeatBreakdown;
  recommendationScore: number;
  /** Editorial preference only; never included in value or heat scores. */
  personalizationScore?: number;
  personalizationReasons?: string[];
  topicIds?: CollectionTopicId[];
  userFeedback?: CandidateFeedbackKind;
  engagement?: CandidateEngagement;
  clusterSize: number;
  relatedSources: string[];
  evidence: string;
  /** Chinese scan-level translation of the source-backed candidate; the original title remains authoritative. */
  briefing?: CandidateBriefing;
  /** Community-native reading of the discussion, kept separate from the event/news summary. */
  communityInsight?: CandidateCommunityInsight;
  imageCount: number | null;
  images: SourceImage[];
  selected: boolean;
  status: "candidate" | "drafted" | "skipped";
}

export type CandidateBriefingBasis = "full-source" | "excerpt" | "title";

export interface CandidateExplanation {
  /** Editorial-reader rendering revision. Absent means the legacy fixed-field explanation. */
  voiceVersion?: 2;
  /** A source-bound account of the event, written for a reader who has not opened the original page. */
  whatHappenedZh: string;
  /** Natural editorial brief rendered from the factual fields; this is the primary reader-facing copy. */
  readerBriefZh?: string;
  /** Concrete facts, changes, numbers or sequence points present in the supplied evidence. */
  keyPointsZh: string[];
  /** The practical consequence supported by the supplied evidence, without generic importance claims. */
  whyItMattersZh?: string;
  /** The people, products or workflows directly affected; empty when the evidence does not say. */
  affectedZh?: string;
  /** Optional concrete editorial judgment about whether the story is worth writing now. */
  editorNoteZh?: string;
  /** Important details the current evidence cannot establish. */
  unknownsZh: string[];
  /** Deterministic lieflat / ra-human audit flags; never used as factual evidence. */
  qualityFlags?: string[];
}

export interface CandidateBriefing {
  titleZh: string;
  summaryZh: string;
  basis: CandidateBriefingBasis;
  generatedAt: string;
  providerId: string;
  explanation?: CandidateExplanation;
}

export interface CandidateCommunityInsight {
  /** What participants are actually focusing on, not a restatement of the linked headline. */
  summaryZh: string;
  /** Repeated viewpoints, practical experiences, or useful additions found in the discussion. */
  focusZh: string[];
  /** A real disagreement found in the evidence; absent when the excerpt does not support one. */
  disagreementZh?: string;
  basis: "discussion-excerpt" | "discussion-page";
  generatedAt: string;
  providerId: string;
}

export type CandidateFeedbackKind = "interested" | "not_interested" | "published";

export interface CandidateFeedback {
  id: string;
  candidateId: string;
  runId: string;
  draftId?: string;
  kind: CandidateFeedbackKind;
  title: string;
  sourceName: string;
  topicIds: CollectionTopicId[];
  keywords: string[];
  createdAt: string;
}

export interface RunLog {
  at: string;
  stage: string;
  message: string;
  level: "info" | "success" | "warning" | "error";
}

export interface SourceRunResult {
  sourceId: string;
  sourceName: string;
  status: Exclude<SourceHealthStatus, "unknown">;
  /** Whether this run should change long-lived connector health. */
  healthImpact: "success" | "neutral" | "failure";
  rawCount: number;
  candidateCount: number;
  detail: string;
}

export interface WorkflowRun {
  id: string;
  horizonRunId?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  status: RunStatus;
  stage: string;
  windowHours: number;
  topicIds?: CollectionTopicId[];
  dateFrom?: string;
  dateTo?: string;
  keywords?: string;
  filteredRawCount?: number;
  sourceIds: string[];
  scheduled: boolean;
  retryOfRunId?: string;
  autoGenerateCount?: number;
  rawCount: number;
  candidates: Candidate[];
  briefingTraceIds?: string[];
  candidatesClearedAt?: string;
  origin?: "collection" | "link-intake" | "screenshot-intake" | "evidence-supplement";
  intake?: {
    sourceLabel: string;
    sourceUrl?: string;
    sourceAssetPath?: string;
  };
  sourceResults?: SourceRunResult[];
  logs: RunLog[];
  error?: string;
  generation?: {
    id: string;
    status: "running" | "complete" | "failed";
    providerId: string;
    skillIds: string[];
    candidateIds: string[];
    startedAt: string;
    completedAt?: string;
    traceIds?: string[];
  };
}

export interface CollectionRequest {
  sourceIds?: string[];
  topicIds?: CollectionTopicId[];
  dateFrom?: string;
  dateTo?: string;
  keywords?: string;
}

export type AiProviderKind = "codex-cli" | "openai-compatible";

export interface AiProviderConfig {
  id: string;
  name: string;
  vendor: string;
  description: string;
  kind: AiProviderKind;
  model: string;
  /** Optional small/fast model reserved for editor Tab completion. */
  inlineCompletionModel?: string;
  visionModel?: string;
  baseUrl?: string;
  supportsVision: boolean;
  apiKeyConfigured: boolean;
  apiKeyHint?: string;
}

export type ProviderHealthStatus = "healthy" | "warning" | "error";

export type ProviderHealthErrorCategory =
  | "none"
  | "not-configured"
  | "auth"
  | "config"
  | "network"
  | "timeout"
  | "rate-limit"
  | "model"
  | "server"
  | "invalid-response"
  | "unknown";

export interface ProviderHealthResult {
  providerId: string;
  lastCheckedAt: string;
  status: ProviderHealthStatus;
  latencyMs: number;
  model: string;
  errorCategory: ProviderHealthErrorCategory;
  safeMessage: string;
}

export type SkillCompatibility = "codex-native" | "prompt-compatible";
export type ArticleSkillScope = "generation" | "analysis" | "optimization" | "chat";

export interface ArticleSkillConfig {
  id: string;
  name: string;
  description: string;
  sourcePath: string;
  enabled: boolean;
  /** Runtime-only hint returned by the API; it is not persisted. */
  available?: boolean;
  builtIn: boolean;
  compatibility: SkillCompatibility;
  /** Tasks that may load this Skill. Missing values are inferred for legacy records. */
  scopes?: ArticleSkillScope[];
  importedAt: string;
}

export interface AiSettings {
  activeProviderId: string;
  completionProviderId: string;
  analysisProviderId: string;
  optimizationProviderId: string;
  /**
   * auto: lieflat on briefs/synthesis, lieflat + voice shaping on commentary;
   * minimal: deterministic lieflat review only; voice: lieflat + ra-人话;
   * off: no style skill is injected into the optimization agent.
   */
  writingReviewMode: "auto" | "minimal" | "voice" | "off";
  providers: AiProviderConfig[];
  latestProviderHealth: Record<string, ProviderHealthResult>;
  skills: ArticleSkillConfig[];
}

export type ArticleAgentRole = "analysis" | "optimization";

export interface ArticleAgentDraftInput {
  title: string;
  bodyHtml: string;
  paragraphs?: string[];
  take?: string;
  /** Request one evidence-bound repair for the current persisted revision. */
  repairQualityWarnings?: boolean;
}

export interface ArticleAgentSourceSnapshot {
  url: string;
  title: string;
  text: string;
  method: "full-page" | "intake-text" | "candidate-excerpt" | "content-package";
  capturedAt: string;
}

export interface ArticleAnalysisResult {
  summary: string;
  keyPoints: string[];
  whyItMatters: string;
  comparison: {
    accurate: string[];
    missing: string[];
    potentiallyMisleading: string[];
  };
  terms: Array<{ term: string; explanation: string }>;
  uncertainties: string[];
}

export type ArticleDraftStrategy =
  | "brief"
  | "synthesis"
  | "community"
  | "playbook"
  | "curate"
  | "commentary"
  | "skip";
export type ArticleEditMode = "keep" | "light" | "targeted" | "rebuild";
export type ArticleWritingDiagnosticLayer = "content" | "structure" | "surface";
export type ArticleWritingDiagnosticSeverity = "info" | "warning" | "error";

export interface ArticleWritingDiagnostic {
  id: string;
  layer: ArticleWritingDiagnosticLayer;
  severity: ArticleWritingDiagnosticSeverity;
  message: string;
  blockId?: string;
  evidence?: string;
  /** Distinguishes the strict lieflat whitelist from broader editorial checks. */
  ruleSource?: "lieflat" | "editorial";
  ruleNumber?: number;
  autoFixable?: boolean;
}

export interface WritingQualityAssessment {
  editMode: ArticleEditMode;
  score: number;
  diagnostics: ArticleWritingDiagnostic[];
  preservedBlockIds: string[];
}

export interface ArticleOptimizationChange {
  id: string;
  /** `title`, `take`, or a zero-based paragraph id such as `paragraph:2`. */
  blockId: string;
  /** Must exactly match the captured draft block or the editor refuses the patch. */
  before: string;
  after: string;
  reason: string;
  affectedFactIds: string[];
  /** Added by the local fact-anchor audit rather than trusted from the model. */
  factCheckPassed: boolean;
  factWarnings: string[];
}

export interface ArticleOptimizationResult {
  strategy: ArticleDraftStrategy;
  editMode: ArticleEditMode;
  diagnosis: string[];
  improvements: string[];
  diagnostics: ArticleWritingDiagnostic[];
  changes: ArticleOptimizationChange[];
  preservedBlockIds: string[];
  factCheckPassed: boolean;
  rollbackRecommended: boolean;
  factWarnings: string[];
  /** Legacy whole-document proposals remain readable but are no longer requested. */
  optimizedTitle?: string;
  optimizedParagraphs?: string[];
  optimizedTake?: string;
}

export interface ArticleAgentMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  grounding?: "原文" | "草稿" | "原文与草稿" | "信息不足";
  suggestions?: string[];
}

export interface ArticleAgentThread {
  id: string;
  draftId: string;
  role: ArticleAgentRole;
  purpose?: "general" | "quality-repair";
  /** Persisted draft updatedAt used to make a quality repair idempotent. */
  draftRevision?: string;
  providerId: string;
  providerName: string;
  createdAt: string;
  updatedAt: string;
  sourceSnapshot: ArticleAgentSourceSnapshot;
  draftSnapshot: {
    title: string;
    text: string;
    capturedAt: string;
  };
  analysis?: ArticleAnalysisResult;
  optimization?: ArticleOptimizationResult;
  messages: ArticleAgentMessage[];
  traceId?: string;
}

export interface ImageMaterial {
  id: string;
  /** Stable catalog identity for bundled material-library assets. */
  seedAssetId?: string;
  /** Catalog revision whose authoritative rights/source metadata was applied. */
  seedCatalogCreatedAt?: string;
  title: string;
  fileName: string;
  localPath: string;
  publicPath: string;
  sourceUrl?: string;
  attribution: string;
  tags: string[];
  rights:
    | "owned"
    | "licensed"
    | "official"
    | "editorial-screenshot"
    | "check-required"
    | "expired";
  evidenceNote?: string;
  evidencePath?: string;
  licenseId?: string;
  licenseUrl?: string;
  modificationNote?: string;
  allowedPlatforms: string[];
  expiresAt?: string;
  entityTags: string[];
  fingerprint: string;
  createdAt: string;
}

export interface DraftSource {
  label: string;
  url: string;
  kind: "original-report" | "primary" | "supporting";
  verified: boolean;
}

export interface DraftImagePlacement {
  id: string;
  image: SourceImage;
  afterParagraph: number;
  caption: string;
}

export interface WeChatDraftSyncReceipt {
  schemaVersion: "wechat-draft-receipt/v1";
  draftId: string;
  mediaId: string;
  operation: "created" | "updated" | "unchanged";
  contentHash: string;
  /** Local publishable revision represented by this remote draft payload. */
  revisionHash?: string;
  syncedAt: string;
  localDraftUpdatedAt: string;
  imageCount: number;
  coverPlacementId: string;
}

export type PublicationPlatform = "xiaoheihe" | "wechat";

export interface PlatformPublicationConfirmation {
  platform: PublicationPlatform;
  confirmedAt: string;
  receiptId: string;
  /** Local publishable revision explicitly acknowledged by the user. */
  revisionHash: string;
  /** Remote payload identity when the platform exposes one (currently WeChat). */
  deliveryContentHash?: string;
  /** Set when a later edit or delivery makes this acknowledgement historical. */
  staleAt?: string;
}

export type DraftFactEvidenceStatus =
  | "full-source"
  | "excerpt-only"
  | "cross-confirmed"
  | "inference"
  | "unverified";

export interface DraftFactClaim {
  id: string;
  claim: string;
  /** ContentPackage facts explicitly used by this paragraph. */
  factIds?: string[];
  status: DraftFactEvidenceStatus;
  sourceUrl?: string;
  /** Every source the generator explicitly mapped to this paragraph. */
  sourceUrls?: string[];
  sourceLabel?: string;
  sourceExcerpt?: string;
  capturedAt: string;
  note?: string;
}

export type DraftLayoutTheme = "news-clean" | "mono-editorial" | "tech-blue";

export type DraftQualityDimension = "fact-safety" | "content-completeness" | "images-rights" | "writing-quality";

export type DraftCompletenessDimension = "event" | "mechanism" | "impact" | "limitations";

export interface DraftFactCoverage {
  usedFactIds: string[];
  unusedFactIds: string[];
  supportedFactCount: number;
  ratio: number;
  /** Legacy drafts cannot distinguish omitted facts from missing metadata. */
  legacyUnmapped?: boolean;
}

export interface DraftQualityWarning {
  id: string;
  message: string;
  blockId: "title" | `paragraph:${number}` | "evidence" | "images" | "source-material";
  dimension: DraftQualityDimension;
  factCoverage?: DraftFactCoverage;
  missingDimensions?: DraftCompletenessDimension[];
}

export interface DraftWritingBrief {
  /** Frozen editorial angles copied from the ContentPackage. */
  suggestedAngles: string[];
  /** Useful discussion themes; never promoted to factual claims. */
  communityFocus: string[];
  communityEvidenceLabel?: string;
}

export interface ArticleDraft {
  id: string;
  runId: string;
  candidateId: string;
  createdAt: string;
  updatedAt: string;
  status: "editing" | "reviewing" | "needs-images" | "ready" | "filled" | "published" | "shelved";
  /** Xiaoheihe surface to fill. Legacy drafts default to the article editor. */
  contentFormat?: "article" | "image-post";
  title: string;
  /** Editorial route selected before generation; absent on legacy drafts. */
  draftStrategy?: Exclude<ArticleDraftStrategy, "skip">;
  paragraphs: string[];
  take: string;
  /**
   * The continuous rich-text document is authoritative once present. The
   * legacy paragraph fields stay available so existing drafts migrate without
   * a destructive rewrite and generated drafts remain easy to inspect.
   */
  bodyHtml?: string;
  layoutTheme?: DraftLayoutTheme;
  sources: DraftSource[];
  factClaims?: DraftFactClaim[];
  uncertainties: string[];
  images: DraftImagePlacement[];
  /** Repairable generation findings. They never replace fact or rights blockers. */
  qualityWarnings?: DraftQualityWarning[];
  /** Read-only writing guidance captured from the immutable ContentPackage. */
  writingBrief?: DraftWritingBrief;
  community: string;
  topics: string[];
  provenance: {
    horizonRunId?: string;
    originalUrl: string;
    generatedBy: string;
    aiTraceId?: string;
    reviewTraceId?: string;
    storyId?: string;
    contentPackageId?: string;
    /** Separates a user-authored working draft from an optional AI-generated alternative. */
    authoringMode?: "human-first" | "ai-generated";
    /** Writing-policy revision; permits a safe regeneration after pipeline fixes. */
    generatorRevision?: string;
    /** Newer safe draft that replaced this historical attempt without deleting it. */
    supersededByDraftId?: string;
  };
  /**
   * Marks a private source-derived working copy. It is never silently treated
   * as publication-ready, even when the source text was imported verbatim.
   */
  sourceMaterial?: {
    kind: "community" | "article";
    mode: "source" | "translation" | "curation";
    sourceUrl: string;
    sourceLabel: string;
    author?: string;
    originalLanguage?: string;
    rights: "check-required" | "permission-confirmed";
    requiresEditorialReview: true;
  };
  intake?: {
    type: "link" | "screenshot";
    extractedText?: string;
    ignoredElements?: string[];
    sourceAssetPath?: string;
  };
  fillResult?: PublisherResult;
  publisherReceipt?: PublisherReceipt;
  /** Latest revision synced to the personal WeChat official-account draft box. */
  wechatDraft?: WeChatDraftSyncReceipt;
  /** Version-bound acknowledgement per publication platform. */
  publicationConfirmations?: Partial<Record<PublicationPlatform, PlatformPublicationConfirmation>>;
  /**
   * Legacy compatibility mirror for the latest current platform confirmation.
   * New server logic must use publicationConfirmations for authorization.
   */
  publicationConfirmedAt?: string;
  /** Receipt explicitly acknowledged by the user as the published revision. */
  publicationReceiptId?: string;
}

export interface DraftGenerationAttempt {
  id: string;
  contentPackageId: string;
  storyId: string;
  draftId: string;
  createdAt: string;
  completedAt: string;
  generatorRevision: string;
  aiTraceId?: string;
  status: "accepted" | "warning" | "blocked";
  draft: ArticleDraft;
  qualityReport: {
    ready: boolean;
    blockers: Array<{ id: string; message: string; blockId: string }>;
    warnings: Array<{ id: string; message: string; blockId: string }>;
  };
}

export type DraftSaveMode = "auto" | "manual";

export interface DraftRevisionSnapshot {
  contentFormat?: "article" | "image-post";
  title: string;
  paragraphs: string[];
  take: string;
  bodyHtml?: string;
  layoutTheme?: DraftLayoutTheme;
  sources: DraftSource[];
  factClaims?: DraftFactClaim[];
  uncertainties: string[];
  images: DraftImagePlacement[];
  community: string;
  topics: string[];
  sourceMaterial?: ArticleDraft["sourceMaterial"];
}

export interface DraftRevision {
  id: string;
  draftId: string;
  createdAt: string;
  updatedAt: string;
  kind: "auto" | "manual" | "restore-backup";
  label: string;
  snapshot: DraftRevisionSnapshot;
}

export interface PublisherStep {
  name: string;
  ok: boolean;
  detail: string;
}

export interface PublisherResult {
  at: string;
  ok: boolean;
  /** Local publishable revision actually read by the platform adapter. */
  revisionHash?: string;
  pageUrl?: string;
  community?: string;
  topics?: string[];
  diagnosticScreenshot?: string;
  steps: PublisherStep[];
  warning?: string;
  preflight?: PublisherPreflightResult;
  receipt?: PublisherReceipt;
}

export interface PublisherStatus {
  mode: Settings["publisherMode"];
  ok: boolean;
  detail: string;
  /** Folder to load from chrome://extensions while developing locally. */
  installPath?: string;
  connectedAt?: string;
  protocolVersion?: string;
  loggedIn?: boolean;
  editorReady?: boolean;
  pageUrl?: string;
}

export interface ImageRightsReview {
  placementId: string;
  eligible: boolean;
  status: "allowed" | "warning" | "blocked";
  blockers: string[];
  warnings: string[];
  effectiveRights: string;
}

export interface DraftReadinessResult {
  draftId: string;
  checkedAt: string;
  platform: string;
  ready: boolean;
  factBlockers: string[];
  imageReviews: ImageRightsReview[];
  blockers: string[];
  warnings: string[];
}

export interface IntakeReviewRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "confirmed" | "cancelled";
  bundle: EvidenceBundle;
  providerId?: string;
  userNote?: string;
  pendingFile?: {
    localPath: string;
    publicPath: string;
    contentType: string;
    fileName: string;
  };
  selection?: EvidenceReviewSelection;
  runId?: string;
  draftId?: string;
}

export type WorkflowNotificationType =
  | "collection-complete"
  | "collection-failed"
  | "high-score-candidate"
  | "ai-failed"
  | "publisher-offline";

export type WorkflowNotificationSeverity = "info" | "success" | "warning" | "error";

export type WorkflowNotificationPage =
  | "workbench"
  | "drafts"
  | "sources"
  | "schedule"
  | "runs"
  | "ai-settings";

export interface WorkflowNotification {
  schemaVersion: "workflow-notification/v1";
  id: string;
  type: WorkflowNotificationType;
  severity: WorkflowNotificationSeverity;
  title: string;
  message: string;
  createdAt: string;
  readAt?: string;
  dedupeKey?: string;
  target?: {
    page: WorkflowNotificationPage;
    runId?: string;
    draftId?: string;
  };
}

export interface WorkflowState {
  version: typeof WORKFLOW_STATE_VERSION;
  settings: Settings;
  editorialSystem: EditorialSystemState;
  aiSettings: AiSettings;
  materials: ImageMaterial[];
  /** Bundled assets explicitly deleted by the user; startup seed must not restore them. */
  materialSeedTombstones: string[];
  sources: SourceConfig[];
  sourcePresets: SourcePreset[];
  candidateFeedback: CandidateFeedback[];
  runs: WorkflowRun[];
  drafts: ArticleDraft[];
  draftGenerationAttempts: DraftGenerationAttempt[];
  draftRevisions: DraftRevision[];
  articleAgentThreads: ArticleAgentThread[];
  intakeReviews: IntakeReviewRecord[];
  aiRunTraces: AiRunTrace[];
  publisherReceipts: PublisherReceipt[];
  notifications: WorkflowNotification[];
}

export interface RawHorizonItem {
  id: string;
  source_type: string;
  title: string;
  url: string;
  content?: string;
  author?: string;
  published_at?: string;
  fetched_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ExtractedPage {
  url: string;
  canonicalUrl: string;
  title: string;
  publishedAt?: string;
  text: string;
  /** Ordered article blocks, preserved before the plain-text fallback flattens whitespace. */
  blocks?: Array<{
    kind: "heading" | "paragraph" | "quote" | "list-item";
    text: string;
  }>;
  images: SourceImage[];
}
