import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateCandidateDraft } from "./generator.js";
import { getLocalDatabase, readState, updateState } from "./storage.js";
import { activeWritingGuidelines } from "./learning-desk.js";
import { appendDraftRevision } from "./draft-revisions.js";
import { createDraftGenerationAttempt, recordDraftGenerationAttempt } from "./draft-generation-attempt.js";
import { draftQualityWarningsFor, evaluateDraftPackageQuality } from "./editorial-quality-desk.js";
import { ClassifiedJobError } from "./job-desk.js";
import { normalizeDraftCatalog } from "./draft-catalog.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft, Candidate, SourceImage, WorkflowState } from "./types.js";

const inFlight = new Map<string, Promise<{ draft: ArticleDraft; reused: boolean }>>();
const humanInFlight = new Map<string, Promise<{ draft: ArticleDraft; reused: boolean }>>();

/** Bump only when routing/evidence/prompt behavior materially changes. */
export const editorialGeneratorRevision = "source-first-v14";
export const humanDraftRevision = "human-first-v1";

const writingBriefFor = (contentPackage: ContentPackage): ArticleDraft["writingBrief"] => ({
  ...((contentPackage.sourceEvidence ?? contentPackage.sourceMaterials)?.length ? {
    sourceReads: (contentPackage.sourceEvidence ?? contentPackage.sourceMaterials ?? []).map((source) => ({
      label: source.sourceLabel, url: source.url, characters: source.originalText.length,
      tableCount: source.blocks?.filter((block) => block.kind === "table").length ?? 0,
      capturedAt: source.capturedAt, fromCache: Boolean(source.fromCache), truncated: source.truncated,
      warnings: [...(source.extractionWarnings ?? [])],
    })),
  } : {}),
  suggestedAngles: structuredClone(contentPackage.suggestedAngles),
  communityFocus: structuredClone(contentPackage.communityFocus),
  communityEvidenceLabel: contentPackage.communityEvidenceLabel,
});

const sourceCandidateFor = (state: Awaited<ReturnType<typeof readState>>, contentPackage: ContentPackage) => {
  const source = contentPackage.sources.find((entry) => !entry.isCommunity) ?? contentPackage.sources[0];
  if (!source) throw new Error("素材包没有冻结任何来源");
  const current = state.runs.flatMap((run) => run.candidates.map((candidate) => ({ run, candidate })))
    .find(({ run, candidate }) => `${run.id}:${candidate.id}` === source.signalId);
  const identity = createHash("sha1").update(`${contentPackage.id}:${source.signalId}`).digest("hex").slice(0, 12);
  const runId = current?.run.id ?? `package_run_${identity}`;
  const candidateId = current?.candidate.id ?? `package_candidate_${identity}`;
  const excerpt = (contentPackage.intent === "source"
    ? contentPackage.sourceMaterials?.[0]?.originalText
    : contentPackage.facts.map((claim) => claim.text).join(" "))?.slice(0, 2_400)
    || contentPackage.title;
  const candidate: Candidate = {
    id: candidateId,
    rawId: candidateId,
    sourceType: "content-package",
    sourceName: source.label,
    sourceRole: source.role,
    title: contentPackage.title,
    url: source.url,
    canonicalUrl: source.url,
    excerpt,
    publishedAt: source.publishedAt || contentPackage.createdAt,
    fetchedAt: contentPackage.createdAt,
    score: 0,
    scoreBreakdown: { consequence: 0, novelty: 0, evidence: 0, relevance: 0, timeliness: 0, confirmation: 0, penalty: 0 },
    heatScore: 0,
    heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
    recommendationScore: 0,
    clusterSize: Math.max(1, contentPackage.sources.length),
    relatedSources: contentPackage.sources.map((entry) => entry.label),
    evidence: "已冻结 ContentPackage 证据边界",
    briefing: {
      titleZh: contentPackage.title,
      summaryZh: excerpt.slice(0, 240),
      basis: "full-source",
      generatedAt: contentPackage.createdAt,
      providerId: "content-package",
    },
    topicIds: [],
    imageCount: contentPackage.assets.length,
    images: [],
    selected: true,
    status: "candidate",
  };
  return { runId, candidate };
};

/**
 * Reads only the immutable package snapshot. A missing legacy snapshot,
 * deleted file or byte-level replacement invalidates the whole transition;
 * callers must never continue with a silently smaller image set.
 */
export const sourceImagesFromContentPackage = async (
  contentPackage: ContentPackage,
): Promise<SourceImage[]> => {
  const images: SourceImage[] = [];
  // Rights review controls delivery, not private editing. A locally frozen
  // source image stays visible in the editor even when WeChat preflight will
  // block it until the user confirms permission or replaces it.
  for (const asset of contentPackage.assets.filter((entry) => entry.localReady)) {
    const image = asset.sourceImage;
    if (!image) throw new Error(`素材包图片 ${asset.sourceImageId} 缺少冻结快照，请重新建立素材包`);
    if (image.id !== asset.sourceImageId) throw new Error(`素材包图片 ${asset.sourceImageId} 身份不一致`);
    if (!asset.localReady || !image.localPath?.trim() || !image.publicPath?.trim()) {
      throw new Error(`素材包图片 ${asset.sourceImageId} 没有冻结的本地文件`);
    }
    const expected = image.fingerprint?.trim().toLowerCase() || "";
    if (!/^[a-f0-9]{64}$/u.test(expected)) {
      throw new Error(`素材包图片 ${asset.sourceImageId} 缺少有效 SHA-256 指纹`);
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(image.localPath);
    } catch {
      throw new Error(`素材包图片 ${asset.sourceImageId} 的冻结文件已不存在`);
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw new Error(`素材包图片 ${asset.sourceImageId} 指纹不一致，内容已变化`);
    images.push(structuredClone(image));
  }
  return images;
};

export const packageEvidenceText = (contentPackage: ContentPackage) => [
  ...(contentPackage.intent === "source" ? [
    "【原始材料工作副本】",
    ...(contentPackage.sourceMaterials ?? []).flatMap((material) => [
      `来源：${material.sourceLabel}｜${material.url}｜${material.rightsNotice}`,
      material.originalText,
    ]),
    "【边界】以上内容是作者或来源页面的原始表达，不等于已独立核验的事实；不得加入材料之外的背景。",
  ] : []),
  "【事实账本】",
  ...contentPackage.facts.map((claim) => `${claim.status}｜${claim.text}｜${claim.note ?? ""}`),
  ...(contentPackage.intent === "community" ? [
    "【社区样本】",
    ...contentPackage.discussionSamples.map((sample) => `${sample.author}@${sample.platform}｜${sample.kind}｜${sample.originalText}`),
  ] : []),
  "【未知项】",
  ...contentPackage.uncertainties,
].join("\n");

const draftSourceKind = (source: ContentPackage["sources"][number]) => {
  if (source.role === "official") return "primary" as const;
  if (source.role === "verification") return "supporting" as const;
  return "original-report" as const;
};

const factStatusForHumanDraft = (
  fact: ContentPackage["facts"][number],
  contentPackage: ContentPackage,
) => {
  if (fact.status === "conflicted" || fact.status === "unverified") return "unverified" as const;
  if (fact.status === "partially-supported") return "excerpt-only" as const;
  const supportingSources = contentPackage.sources.filter((source) =>
    fact.sourceSignalIds.includes(source.signalId) && !source.isCommunity);
  if (supportingSources.length > 1) return "cross-confirmed" as const;
  return supportingSources.some((source) => source.basis === "full-source")
    ? "full-source" as const
    : "excerpt-only" as const;
};

/**
 * Public DraftDesk state transition for the human-first path. It deliberately
 * receives frozen images and never receives a provider or generation callback.
 */
export const createHumanDraftInState = ({
  state,
  contentPackage,
  images,
  draftId = `draft_human_${randomUUID().slice(0, 12)}`,
  now = new Date().toISOString(),
}: {
  state: WorkflowState;
  contentPackage: ContentPackage;
  images: SourceImage[];
  draftId?: string;
  now?: string;
}): { draft: ArticleDraft; reused: boolean } => {
  if (contentPackage.status !== "ready" || contentPackage.blockers.length) {
    throw new Error(contentPackage.blockers[0] || "素材包尚未通过人工起稿预检");
  }
  const existing = state.drafts.find((draft) =>
    draft.provenance.contentPackageId === contentPackage.id
    && draft.provenance.authoringMode === "human-first");
  if (existing) return { draft: existing, reused: true };

  const { runId, candidate } = sourceCandidateFor(state, contentPackage);
  const sourceBySignalId = new Map(contentPackage.sources.map((source) => [source.signalId, source]));
  const draft: ArticleDraft = {
    id: draftId,
    runId,
    candidateId: candidate.id,
    createdAt: now,
    updatedAt: now,
    status: "editing",
    contentFormat: "article",
    title: contentPackage.title,
    draftStrategy: contentPackage.mode,
    paragraphs: [],
    take: "",
    bodyHtml: "",
    layoutTheme: "news-clean",
    sources: contentPackage.sources.map((source) => ({
      label: source.label,
      url: source.url,
      kind: draftSourceKind(source),
      verified: source.basis === "full-source",
    })),
    factClaims: contentPackage.facts.map((fact) => {
      const sourceUrls = fact.sourceUrls?.length
        ? [...new Set(fact.sourceUrls)]
        : fact.sourceSignalIds.flatMap((signalId) => {
            const source = sourceBySignalId.get(signalId);
            return source ? [source.url] : [];
          });
      return {
        id: fact.id,
        claim: fact.text,
        factIds: [fact.id],
        status: factStatusForHumanDraft(fact, contentPackage),
        sourceUrl: sourceUrls[0],
        sourceUrls,
        sourceLabel: fact.sourceSignalIds
          .flatMap((signalId) => sourceBySignalId.get(signalId)?.label ?? [])
          .join("；") || undefined,
        sourceExcerpt: fact.note,
        capturedAt: contentPackage.createdAt,
        note: fact.note,
      };
    }),
    uncertainties: structuredClone(contentPackage.uncertainties),
    images: images.map((image) => ({
      id: `placement_${createHash("sha1").update(`${contentPackage.id}:${image.id}`).digest("hex").slice(0, 10)}`,
      image: structuredClone(image),
      afterParagraph: -1,
      caption: image.caption || "来源图片",
    })),
    writingBrief: writingBriefFor(contentPackage),
    community: state.settings.community,
    topics: structuredClone(candidate.topicIds ?? []),
    provenance: {
      horizonRunId: state.runs.find((run) => run.id === runId)?.horizonRunId,
      originalUrl: contentPackage.sources.find((source) => !source.isCommunity)?.url
        ?? contentPackage.sources[0]?.url
        ?? "",
      generatedBy: "human",
      storyId: contentPackage.storyId,
      contentPackageId: contentPackage.id,
      authoringMode: "human-first",
      generatorRevision: humanDraftRevision,
    },
  };
  const frozenSource = contentPackage.sourceMaterials?.[0];
  if (contentPackage.intent === "source" && frozenSource) {
    draft.sourceMaterial = {
      kind: frozenSource.sourceKind === "community-post" ? "community" : "article",
      mode: "source",
      sourceUrl: frozenSource.url,
      sourceLabel: frozenSource.sourceLabel,
      author: frozenSource.author,
      originalLanguage: frozenSource.originalLanguage,
      rights: "check-required",
      requiresEditorialReview: true,
    };
  }

  state.drafts.unshift(draft);
  state.drafts = normalizeDraftCatalog(state.drafts);
  appendDraftRevision(state, draft, "manual", new Date(now));
  const target = state.runs.find((run) => run.id === runId)
    ?.candidates.find((entry) => entry.id === candidate.id);
  if (target) target.status = "drafted";
  return { draft, reused: false };
};

export type DraftProgressReporter = (progress: number, stage: string) => void;

const create = async (
  packageId: string,
  onProgress?: DraftProgressReporter,
): Promise<{ draft: ArticleDraft; reused: boolean }> => {
  onProgress?.(0.08, "校验冻结素材包");
  const database = await getLocalDatabase();
  const contentPackage = database.getContentPackage<ContentPackage>(packageId);
  if (!contentPackage) throw new ClassifiedJobError("素材包不存在", "deterministic");
  if (contentPackage.status !== "ready" || contentPackage.blockers.length) {
    throw new ClassifiedJobError(contentPackage.blockers[0] || "素材包尚未通过成稿预检", "repairable");
  }

  const initialState = await readState();
  const existing = initialState.drafts.find((draft) => draft.provenance.contentPackageId === packageId
    && draft.provenance.generatorRevision === editorialGeneratorRevision);
  if (existing) {
    onProgress?.(0.95, "复用已有草稿");
    return { draft: existing, reused: true };
  }
  onProgress?.(0.14, "读取冻结证据");
  const { runId, candidate } = sourceCandidateFor(initialState, contentPackage);
  const provider = initialState.aiSettings.providers.find((entry) => entry.id === initialState.aiSettings.activeProviderId)
    ?? initialState.aiSettings.providers[0];
  if (!provider) throw new ClassifiedJobError("当前没有可用的成稿模型", "repairable");
  if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
    throw new ClassifiedJobError(`请先在 AI 设置中配置 ${provider.name} 的 API Key`, "repairable");
  }
  let images: SourceImage[];
  try {
    images = await sourceImagesFromContentPackage(contentPackage);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new ClassifiedJobError(message, "repairable", { cause: error });
  }
  onProgress?.(0.22, "准备成稿材料");
  database.recordWorkflowEvent({
    type: "draft.started",
    subjectType: "package",
    subjectId: packageId,
    payload: { storyId: contentPackage.storyId, providerId: provider.id },
  });

  try {
    const communitySource = contentPackage.sources.find((source) => source.isCommunity);
    const draft = await generateCandidateDraft(
      runId,
      candidate as Candidate,
      provider,
      initialState.aiSettings.skills,
      undefined,
      {
        extractedText: packageEvidenceText(contentPackage),
        canonicalUrl: contentPackage.sources.find((source) => !source.isCommunity)?.url ?? candidate.canonicalUrl ?? candidate.url,
        images,
        skipExtraction: true,
        contentPackage,
        draftStrategy: contentPackage.mode,
        writingGuidelines: activeWritingGuidelines(database, initialState.settings.writingMemoryEnabled),
        communityDiscovery: communitySource ? {
          platform: communitySource.label,
          discussionUrl: communitySource.url,
          discussionTitle: contentPackage.title,
          discoveredAt: communitySource.publishedAt,
        } : undefined,
        autoReview: contentPackage.intent !== "source",
        autoReviewVoice: contentPackage.intent === "community",
        codexReasoningEffort: "high",
        onProgress,
      },
    );
    const frozenSource = contentPackage.sourceMaterials?.[0];
    if (contentPackage.intent === "source" && frozenSource) {
      draft.sourceMaterial = {
        kind: frozenSource.sourceKind === "community-post" ? "community" : "article",
        mode: "source",
        sourceUrl: frozenSource.url,
        sourceLabel: frozenSource.sourceLabel,
        author: frozenSource.author,
        originalLanguage: frozenSource.originalLanguage,
        rights: "check-required",
        requiresEditorialReview: true,
      };
    }
    const qualityReport = evaluateDraftPackageQuality({ contentPackage, draft });
    if (!qualityReport.ready) {
      const blockedAttempt = createDraftGenerationAttempt({
        contentPackageId: packageId,
        storyId: contentPackage.storyId,
        generatorRevision: editorialGeneratorRevision,
        draft,
        qualityReport,
      });
      await updateState((state) => recordDraftGenerationAttempt(state, blockedAttempt));
      throw new ClassifiedJobError(
        `草稿质量门未通过：${qualityReport.blockers.map((item) => item.message).join("；")}`,
        "deterministic",
      );
    }
    draft.qualityWarnings = draftQualityWarningsFor(qualityReport);
    if (draft.qualityWarnings.some((warning) => warning.dimension === "images-rights")) {
      draft.status = "needs-images";
    }
    draft.provenance.generatorRevision = editorialGeneratorRevision;
    draft.provenance.authoringMode = "ai-generated";
    draft.writingBrief = writingBriefFor(contentPackage);
    const generationAttempt = createDraftGenerationAttempt({
      contentPackageId: packageId,
      storyId: contentPackage.storyId,
      generatorRevision: editorialGeneratorRevision,
      draft,
      qualityReport,
    });
    onProgress?.(0.96, "保存草稿与修订记录");
    const saved = await updateState((state) => {
      recordDraftGenerationAttempt(state, generationAttempt);
      const duplicate = state.drafts.find((entry) => entry.provenance.contentPackageId === packageId
        && entry.provenance.generatorRevision === editorialGeneratorRevision);
      if (duplicate) return { draft: duplicate, reused: true };
      state.drafts.unshift(draft);
      state.drafts = normalizeDraftCatalog(state.drafts);
      appendDraftRevision(state, draft, "manual");
      const target = state.runs.find((run) => run.id === runId)
        ?.candidates.find((entry) => entry.id === candidate.id);
      if (target) target.status = "drafted";
      return { draft, reused: false };
    });
    if (!saved.reused) {
      database.recordFeedback({
        type: "drafted",
        subjectType: "story",
        subjectId: contentPackage.storyId,
        payload: { packageId, draftId: saved.draft.id },
      });
      database.recordWorkflowEvent({
        type: "draft.completed",
        subjectType: "draft",
        subjectId: saved.draft.id,
        payload: {
          packageId,
          storyId: contentPackage.storyId,
          imageCount: saved.draft.images.length,
          qualityWarningCount: qualityReport.warnings.length,
          qualityWarningIds: qualityReport.warnings.map((item) => item.id),
        },
      });
    }
    return saved;
  } catch (error) {
    database.recordWorkflowEvent({
      type: "draft.failed",
      subjectType: "package",
      subjectId: packageId,
      payload: { error: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000) },
    });
    throw error;
  }
};

/**
 * DraftDesk owns the package-to-draft transition. It enforces idempotency and
 * passes a locked ContentPackage to the model, so raw feeds and model memory
 * cannot silently expand the article's fact boundary.
 */
export const createDraftFromPackage = (packageId: string, onProgress?: DraftProgressReporter) => {
  const current = inFlight.get(packageId);
  if (current) return current;
  const operation = create(packageId, onProgress).finally(() => inFlight.delete(packageId));
  inFlight.set(packageId, operation);
  return operation;
};

/** Creates or reopens the human-authored working draft for a frozen package. */
export const createHumanDraftFromPackage = (packageId: string) => {
  const current = humanInFlight.get(packageId);
  if (current) return current;
  const operation = (async () => {
    const database = await getLocalDatabase();
    const contentPackage = database.getContentPackage<ContentPackage>(packageId);
    if (!contentPackage) throw new ClassifiedJobError("素材包不存在", "deterministic");
    if (contentPackage.status !== "ready" || contentPackage.blockers.length) {
      throw new ClassifiedJobError(
        contentPackage.blockers[0] || "素材包尚未通过人工起稿预检",
        "repairable",
      );
    }
    const initialState = await readState();
    const existing = initialState.drafts.find((draft) =>
      draft.provenance.contentPackageId === packageId
      && draft.provenance.authoringMode === "human-first");
    if (existing) return { draft: existing, reused: true };

    let images: SourceImage[];
    try {
      images = await sourceImagesFromContentPackage(contentPackage);
    } catch (error) {
      throw new ClassifiedJobError(
        error instanceof Error ? error.message : String(error),
        "repairable",
        { cause: error },
      );
    }
    const saved = await updateState((state) => createHumanDraftInState({ state, contentPackage, images }));
    if (!saved.reused) {
      database.recordFeedback({
        type: "drafted",
        subjectType: "story",
        subjectId: contentPackage.storyId,
        payload: { packageId, draftId: saved.draft.id, authoringMode: "human-first" },
      });
      database.recordWorkflowEvent({
        type: "draft.human_started",
        subjectType: "draft",
        subjectId: saved.draft.id,
        payload: { packageId, storyId: contentPackage.storyId, imageCount: saved.draft.images.length },
      });
    }
    return saved;
  })().finally(() => humanInFlight.delete(packageId));
  humanInFlight.set(packageId, operation);
  return operation;
};
