import { generateCandidateDraft } from "./generator.js";
import { getLocalDatabase, readState, updateState } from "./storage.js";
import { storyById } from "./story-desk.js";
import { activeWritingGuidelines } from "./learning-desk.js";
import { appendDraftRevision } from "./draft-revisions.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft, Candidate, SourceRole } from "./types.js";

const inFlight = new Map<string, Promise<{ draft: ArticleDraft; reused: boolean }>>();

const roleRank = (role: SourceRole | undefined) => ({
  official: 5,
  research: 4,
  verification: 3,
  discovery: 2,
  community: 1,
})[role ?? "discovery"];

const sourceCandidateFor = (state: Awaited<ReturnType<typeof readState>>, contentPackage: ContentPackage) => {
  const story = storyById(state, contentPackage.storyId);
  if (!story) throw new Error("素材包对应的 Story 已不存在");
  const rankedSignals = [...story.signals].sort((left, right) =>
    Number(left.isCommunity) - Number(right.isCommunity)
      || roleRank(right.sourceRole) - roleRank(left.sourceRole));
  for (const signal of rankedSignals) {
    const candidate = state.runs.find((run) => run.id === signal.runId)
      ?.candidates.find((entry) => entry.id === signal.candidateId);
    if (candidate) return { story, signal, candidate };
  }
  throw new Error("素材包找不到可成稿的原始 Signal");
};

const packageEvidenceText = (contentPackage: ContentPackage) => [
  "【事实账本】",
  ...contentPackage.facts.map((claim) => `${claim.status}｜${claim.text}｜${claim.note ?? ""}`),
  "【社区样本】",
  ...contentPackage.discussionSamples.map((sample) => `${sample.author}@${sample.platform}｜${sample.kind}｜${sample.originalText}`),
  "【未知项】",
  ...contentPackage.uncertainties,
].join("\n");

const create = async (packageId: string): Promise<{ draft: ArticleDraft; reused: boolean }> => {
  const database = await getLocalDatabase();
  const contentPackage = database.getContentPackage<ContentPackage>(packageId);
  if (!contentPackage) throw new Error("素材包不存在");
  if (contentPackage.status !== "ready" || contentPackage.blockers.length) {
    throw new Error(contentPackage.blockers[0] || "素材包尚未通过成稿预检");
  }

  const initialState = await readState();
  const existing = initialState.drafts.find((draft) => draft.provenance.contentPackageId === packageId);
  if (existing) return { draft: existing, reused: true };
  const { story, signal, candidate } = sourceCandidateFor(initialState, contentPackage);
  const provider = initialState.aiSettings.providers.find((entry) => entry.id === initialState.aiSettings.activeProviderId)
    ?? initialState.aiSettings.providers[0];
  if (!provider) throw new Error("当前没有可用的成稿模型");
  if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
    throw new Error(`请先在 AI 设置中配置 ${provider.name} 的 API Key`);
  }
  const allowedImageIds = new Set(contentPackage.assets
    .filter((asset) => asset.rightsDecision !== "blocked")
    .map((asset) => asset.sourceImageId));
  const images = story.images.filter((image) => allowedImageIds.has(image.id));
  database.recordWorkflowEvent({
    type: "draft.started",
    subjectType: "package",
    subjectId: packageId,
    payload: { storyId: story.id, providerId: provider.id },
  });

  try {
    const draft = await generateCandidateDraft(
      signal.runId,
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
      },
    );
    const saved = await updateState((state) => {
      const duplicate = state.drafts.find((entry) => entry.provenance.contentPackageId === packageId);
      if (duplicate) return { draft: duplicate, reused: true };
      state.drafts.unshift(draft);
      appendDraftRevision(state, draft, "manual");
      const target = state.runs.find((run) => run.id === signal.runId)
        ?.candidates.find((entry) => entry.id === signal.candidateId);
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
export const createDraftFromPackage = (packageId: string) => {
  const current = inFlight.get(packageId);
  if (current) return current;
  const operation = create(packageId).finally(() => inFlight.delete(packageId));
  inFlight.set(packageId, operation);
  return operation;
};
