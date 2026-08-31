import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { generateCandidateDraft } from "./generator.js";
import { getLocalDatabase, readState, updateState } from "./storage.js";
import { activeWritingGuidelines } from "./learning-desk.js";
import { appendDraftRevision } from "./draft-revisions.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft, Candidate, SourceImage } from "./types.js";

const inFlight = new Map<string, Promise<{ draft: ArticleDraft; reused: boolean }>>();

const sourceCandidateFor = (state: Awaited<ReturnType<typeof readState>>, contentPackage: ContentPackage) => {
  const source = contentPackage.sources.find((entry) => !entry.isCommunity) ?? contentPackage.sources[0];
  if (!source) throw new Error("素材包没有冻结任何来源");
  const current = state.runs.flatMap((run) => run.candidates.map((candidate) => ({ run, candidate })))
    .find(({ run, candidate }) => `${run.id}:${candidate.id}` === source.signalId);
  const identity = createHash("sha1").update(`${contentPackage.id}:${source.signalId}`).digest("hex").slice(0, 12);
  const runId = current?.run.id ?? `package_run_${identity}`;
  const candidateId = current?.candidate.id ?? `package_candidate_${identity}`;
  const excerpt = contentPackage.facts.map((claim) => claim.text).join(" ").slice(0, 2_400)
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
  for (const asset of contentPackage.assets.filter((entry) => entry.rightsDecision !== "blocked")) {
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

const packageEvidenceText = (contentPackage: ContentPackage) => [
  "【事实账本】",
  ...contentPackage.facts.map((claim) => `${claim.status}｜${claim.text}｜${claim.note ?? ""}`),
  "【社区样本】",
  ...contentPackage.discussionSamples.map((sample) => `${sample.author}@${sample.platform}｜${sample.kind}｜${sample.originalText}`),
  "【未知项】",
  ...contentPackage.uncertainties,
].join("\n");

export type DraftProgressReporter = (progress: number, stage: string) => void;

const create = async (
  packageId: string,
  onProgress?: DraftProgressReporter,
): Promise<{ draft: ArticleDraft; reused: boolean }> => {
  onProgress?.(0.08, "校验冻结素材包");
  const database = await getLocalDatabase();
  const contentPackage = database.getContentPackage<ContentPackage>(packageId);
  if (!contentPackage) throw new Error("素材包不存在");
  if (contentPackage.status !== "ready" || contentPackage.blockers.length) {
    throw new Error(contentPackage.blockers[0] || "素材包尚未通过成稿预检");
  }

  const initialState = await readState();
  const existing = initialState.drafts.find((draft) => draft.provenance.contentPackageId === packageId);
  if (existing) {
    onProgress?.(0.95, "复用已有草稿");
    return { draft: existing, reused: true };
  }
  onProgress?.(0.14, "读取冻结证据");
  const { runId, candidate } = sourceCandidateFor(initialState, contentPackage);
  const provider = initialState.aiSettings.providers.find((entry) => entry.id === initialState.aiSettings.activeProviderId)
    ?? initialState.aiSettings.providers[0];
  if (!provider) throw new Error("当前没有可用的成稿模型");
  if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
    throw new Error(`请先在 AI 设置中配置 ${provider.name} 的 API Key`);
  }
  const images = await sourceImagesFromContentPackage(contentPackage);
  onProgress?.(0.22, "准备成稿材料");
  database.recordWorkflowEvent({
    type: "draft.started",
    subjectType: "package",
    subjectId: packageId,
    payload: { storyId: contentPackage.storyId, providerId: provider.id },
  });

  try {
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
        writingGuidelines: activeWritingGuidelines(database),
        onProgress,
      },
    );
    onProgress?.(0.96, "保存草稿与修订记录");
    const saved = await updateState((state) => {
      const duplicate = state.drafts.find((entry) => entry.provenance.contentPackageId === packageId);
      if (duplicate) return { draft: duplicate, reused: true };
      state.drafts.unshift(draft);
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
        payload: { packageId, storyId: contentPackage.storyId, imageCount: saved.draft.images.length },
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
