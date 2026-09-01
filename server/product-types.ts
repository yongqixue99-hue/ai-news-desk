import type {
  CandidateBriefingBasis,
  CandidateFeedbackKind,
  CollectionTopicId,
  SourceHealthStatus,
  SourceImage,
  SourceRole,
} from "./types.js";

export type AssignmentMode =
  | "brief"
  | "synthesis"
  | "community"
  | "playbook"
  | "curate"
  | "watch"
  | "skip";

/**
 * What the editor wants to make is independent from where the signal was
 * discovered. A community link may still be a news story, while a first-hand
 * post may be preserved as source material.
 */
export type EditorialIntent = "news" | "source" | "community";

export type EditorialSourceKind = "news-source" | "linked-community" | "self-contained-community";

export interface EditorialIntentOption {
  intent: EditorialIntent;
  label: string;
  description: string;
  mode: Exclude<AssignmentMode, "watch" | "skip">;
  available: boolean;
  reason: string;
  workingCopy: boolean;
}

export interface EditorialIntakeView {
  storyId: string;
  signalId: string;
  sourceKind: EditorialSourceKind;
  recommendedIntent: EditorialIntent;
  recommendationReason: string;
  options: EditorialIntentOption[];
}

export type EvidenceStrength = "strong" | "moderate" | "weak";

export interface AssignmentDecision {
  mode: AssignmentMode;
  reason: string;
  audienceValue: string;
  evidenceStrength: EvidenceStrength;
  canDraft: boolean;
  blockers: string[];
  warnings: string[];
  decidedAt: string;
  basis: "policy-v1";
}

export interface StorySignalView {
  runId: string;
  candidateId: string;
  sourceName: string;
  sourceRole?: SourceRole;
  sourceType: string;
  title: string;
  titleZh?: string;
  summaryZh?: string;
  briefingBasis?: CandidateBriefingBasis;
  url: string;
  discussionUrl?: string;
  author?: string;
  publishedAt: string;
  fetchedAt: string;
  isCommunity: boolean;
  /** A community link whose external page has been read as factual evidence. */
  factBearing?: boolean;
  /** The record contains both an external source URL and a discussion URL. */
  linkedSource?: boolean;
  engagement?: { points?: number; comments?: number };
  feedback?: CandidateFeedbackKind;
  drafted: boolean;
}

export interface StoryExplanationSource {
  signalId: string;
  sourceName: string;
  role: SourceRole | "discovery";
  basis: CandidateBriefingBasis;
  summary: string;
  url: string;
}

export interface StoryExplanation {
  /** `ready` means the Story has the v2 editorial-reader rendering; partial is a safe legacy/scan fallback. */
  status: "ready" | "partial";
  basis: CandidateBriefingBasis;
  voiceVersion: number;
  readerBrief: string;
  editorNote?: string;
  whatHappened: string;
  keyPoints: string[];
  whyItMatters: string;
  affected?: string;
  unknowns: string[];
  qualityFlags: string[];
  sources: StoryExplanationSource[];
  generatedAt?: string;
}

export interface StoryTrendView {
  direction: "rising" | "steady" | "cooling" | "unknown";
  summary: string;
  platformCount: number;
  latestPoints?: number;
  latestComments?: number;
  pointsDelta?: number;
  commentsDelta?: number;
  windowHours?: number;
}

export interface StoryView {
  id: string;
  title: string;
  originalTitle: string;
  summary: string;
  whyImportant: string;
  communitySummary?: string;
  communityFocus: string[];
  disagreement?: string;
  explanation: StoryExplanation;
  topicIds: CollectionTopicId[];
  firstSeenAt: string;
  lastSeenAt: string;
  publishedAt: string;
  ageHours: number;
  recommendationScore: number;
  evidenceStrength: EvidenceStrength;
  sourceCount: number;
  factSourceCount: number;
  communitySourceCount: number;
  communitySampleCount: number;
  images: SourceImage[];
  /** All discovered records, including remote-only URLs. */
  imageCount: number;
  /** Cached files that can still be used when the publisher URL expires. */
  localImageCount?: number;
  /** Cached files whose rights metadata currently passes automatic use rules. */
  publishReadyImageCount?: number;
  /** Cached files that still require a human rights decision. */
  rightsReviewImageCount?: number;
  selected: boolean;
  drafted: boolean;
  published: boolean;
  ignored: boolean;
  assignment: AssignmentDecision;
  trend: StoryTrendView;
  signals: StorySignalView[];
}

export interface TodaySourceDiagnostic {
  sourceId: string;
  name: string;
  kind: string;
  role?: SourceRole;
  status: SourceHealthStatus;
  detail: string;
  consecutiveFailures: number;
}

export interface TodayFunnel {
  candidateCount: number;
  storyCount: number;
  recommendationTarget: number;
  visibleRecommendationCount: number;
  recommendationShortageCount: number;
  recommendationDropReasons: Array<{
    code: "outside-window" | "already-drafted" | "evidence-blocked" | "ignored-or-published" | "below-display-limit";
    label: string;
    count: number;
  }>;
  selectedCount: number;
  draftCount: number;
  syncedCount: number;
  publishedCount: number;
  feedbackCount: number;
  materialLibraryTotal: number;
  autoUsableMaterialCount: number;
  rightsReviewMaterialCount: number;
  /** @deprecated Use autoUsableMaterialCount. */
  reusableMaterialCount: number;
}

export interface TodayView {
  generatedAt: string;
  mustReads: StoryView[];
  secondary: StoryView[];
  backlog: StoryView[];
  watching: StoryView[];
  diagnostics: TodaySourceDiagnostic[];
  funnel: TodayFunnel;
  coverage: {
    activeStoryCount: number;
    risingCount: number;
    sourceImageReadyCount: number;
    publishReadyStoryCount: number;
    /** @deprecated Use sourceImageReadyCount. */
    imageReadyCount: number;
    strongEvidenceCount: number;
    topicIds: CollectionTopicId[];
  };
}

export interface EvidenceClaim {
  id: string;
  text: string;
  status: "supported" | "partially-supported" | "conflicted" | "unverified";
  sourceSignalIds: string[];
  sourceUrls?: string[];
  note?: string;
}

export interface DiscussionSample {
  id: string;
  signalId: string;
  platform: string;
  author: string;
  permalink: string;
  originalText: string;
  translatedText?: string;
  kind: "experience" | "solution" | "question" | "prediction" | "counterpoint" | "opinion";
  branchId?: string;
  parentId?: string;
  depth?: number;
  publishedAt?: string;
}

export interface AssetCandidate {
  id: string;
  sourceImageId: string;
  /**
   * Immutable image and governance snapshot captured when the package is
   * built. Draft generation must consume this record instead of looking the
   * image up again in a mutable Story or material library.
   */
  sourceImage: SourceImage;
  url: string;
  caption: string;
  attribution: string;
  sourceUrl: string;
  rights: SourceImage["rights"];
  rightsDecision: "allowed" | "warning" | "blocked";
  rightsReason: string;
  role: "cover" | "fact" | "data" | "product" | "community" | "decorative";
  width?: number;
  height?: number;
  recommendedAfterClaimId?: string;
  /** Where the reviewable asset came from; legacy packages omit this field. */
  origin?: "source" | "library";
  /** Relevance order enforced before model image choices. */
  editorialPriority?: 1 | 2 | 3 | 4 | 5;
  editorialOrigin?: SourceImage["editorialOrigin"];
  /** A local file exists and can survive a remote publisher image failure. */
  localReady?: boolean;
}

export interface ContentPackageSource {
  signalId: string;
  label: string;
  url: string;
  role: SourceRole | "discovery";
  basis: "full-source" | "excerpt" | "title";
  publishedAt: string;
  isCommunity: boolean;
}

/**
 * Immutable source text captured before a source-preserving working copy is
 * generated. It is deliberately separate from EvidenceClaim: an author's
 * original wording is useful editing material, but it is not automatically a
 * verified fact.
 */
export interface SourceMaterialSnapshot {
  signalId: string;
  sourceKind: "community-post" | "linked-page" | "article";
  sourceLabel: string;
  url: string;
  author?: string;
  originalTitle: string;
  originalText: string;
  originalLanguage: "zh" | "en" | "mixed";
  basis: "full-source" | "community-post";
  capturedAt: string;
  fromCache?: boolean;
  truncated: boolean;
  rightsNotice: string;
}

export interface ContentPackage {
  id: string;
  storyId: string;
  mode: Exclude<AssignmentMode, "watch" | "skip">;
  /** New packages record the editor's intent; legacy packages infer it from mode. */
  intent?: EditorialIntent;
  intakeReason?: string;
  title: string;
  createdAt: string;
  facts: EvidenceClaim[];
  communitySummary?: string;
  communityFocus: string[];
  discussionSamples: DiscussionSample[];
  sourceSignalIds: string[];
  sources: ContentPackageSource[];
  /** Present only when the editor explicitly asks for a source working copy. */
  sourceMaterials?: SourceMaterialSnapshot[];
  imageIds: string[];
  assets: AssetCandidate[];
  uncertainties: string[];
  suggestedAngles: string[];
  communityEvidenceLabel: string;
  status: "ready" | "blocked";
  blockers: string[];
}
