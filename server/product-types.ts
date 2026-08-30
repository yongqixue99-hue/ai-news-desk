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
  imageCount: number;
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
  selectedCount: number;
  draftCount: number;
  syncedCount: number;
  publishedCount: number;
  feedbackCount: number;
  reusableMaterialCount: number;
}

export interface TodayView {
  generatedAt: string;
  mustReads: StoryView[];
  secondary: StoryView[];
  watching: StoryView[];
  diagnostics: TodaySourceDiagnostic[];
  funnel: TodayFunnel;
  coverage: {
    activeStoryCount: number;
    risingCount: number;
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

export interface ContentPackage {
  id: string;
  storyId: string;
  mode: Exclude<AssignmentMode, "watch" | "skip">;
  title: string;
  createdAt: string;
  facts: EvidenceClaim[];
  communitySummary?: string;
  communityFocus: string[];
  discussionSamples: DiscussionSample[];
  sourceSignalIds: string[];
  sources: ContentPackageSource[];
  imageIds: string[];
  assets: AssetCandidate[];
  uncertainties: string[];
  suggestedAngles: string[];
  communityEvidenceLabel: string;
  status: "ready" | "blocked";
  blockers: string[];
}
