import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  assertEvidenceReadyForDraft,
  buildLinkEvidenceBundle,
  buildScreenshotEvidenceBundle,
  normalizeEvidenceSelection,
  type EvidenceReviewSelection,
} from "./intake-review.js";
import { extractPage } from "./extractor.js";
import { generateCandidateDraft } from "./generator.js";
import { analyzeScreenshotEvidence } from "./intake.js";
import { skillsForArticleTask } from "./skill-registry.js";
import { readState, updateState, workflowMediaRoot } from "./storage.js";
import type {
  AiProviderConfig,
  ArticleSkillConfig,
  Candidate,
  IntakeReviewRecord,
  SourceImage,
  WorkflowRun,
} from "./types.js";

const now = () => new Date().toISOString();

const providerFor = (state: Awaited<ReturnType<typeof readState>>) => {
  const provider = state.aiSettings.providers.find((entry) => entry.id === state.aiSettings.activeProviderId);
  if (!provider) throw new Error("当前 AI Provider 不存在，请到 AI 设置重新选择");
  if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) throw new Error(`请先配置 ${provider.name} 的 API Key`);
  return provider;
};

export const createLinkIntakeReview = async (url: string) => {
  const state = await readState();
  const page = await extractPage(url, state.settings.imageLimit);
  if (page.text.length < 80) throw new Error("这个页面没有提取到足够正文，建议改用截图入口");
  const bundle = buildLinkEvidenceBundle({
    sourceUrl: url,
    canonicalUrl: page.canonicalUrl,
    title: page.title,
    extractedText: page.text,
    rawSourceText: page.text,
    removedNoise: [],
    images: page.images,
  });
  const timestamp = now();
  const record: IntakeReviewRecord = {
    id: `intake_review_${randomUUID().slice(0, 12)}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "pending",
    bundle,
    providerId: providerFor(state).id,
  };
  await updateState((current) => {
    current.intakeReviews.unshift(record);
    current.intakeReviews = current.intakeReviews.slice(0, 40);
  });
  return record;
};

export const createScreenshotIntakeReview = async (
  bytes: Buffer,
  contentType: string,
  fileName: string,
  userNote?: string,
) => {
  if (!bytes.length) throw new Error("上传的截图为空");
  if (bytes.length > 15 * 1024 * 1024) throw new Error("截图不能超过 15 MB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) throw new Error("截图只支持 JPG、PNG 或 WebP");
  await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
  const state = await readState();
  const provider = providerFor(state);
  if (!provider.supportsVision) throw new Error(`${provider.name} 当前不能读取截图，请先切换视觉模型`);
  const id = `intake_review_${randomUUID().slice(0, 12)}`;
  const directory = path.join(workflowMediaRoot, "intake-reviews");
  await mkdir(directory, { recursive: true });
  const extension = contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const localPath = path.join(directory, `${id}${extension}`);
  await writeFile(localPath, bytes);
  const publicPath = `/media/intake-reviews/${encodeURIComponent(`${id}${extension}`)}`;
  const timestamp = now();
  const selectedSkills = skillsForArticleTask(state.aiSettings.skills, "generation").map((skill) => structuredClone(skill));
  const { article, croppedPlacements } = await analyzeScreenshotEvidence({
    bytes,
    contentType,
    sourcePath: localPath,
    jobId: id,
    provider,
    skills: selectedSkills,
    note: userNote,
  });
  const record: IntakeReviewRecord = {
    id,
    createdAt: timestamp,
    updatedAt: timestamp,
    status: "pending",
    bundle: buildScreenshotEvidenceBundle({
      fileName,
      sourceAssetPath: localPath,
      sourcePublicPath: publicPath,
      title: fileName.replace(/\.[^.]+$/, ""),
      extractedText: article.extractedText,
      ignoredElements: article.ignoredElements,
      imageRegions: article.imageRegions.map((region, index) => ({
        id: croppedPlacements[index]?.image.id,
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        caption: region.caption,
        localPath: croppedPlacements[index]?.image.localPath,
        publicPath: croppedPlacements[index]?.image.publicPath,
        selected: true,
      })),
    }),
    providerId: provider.id,
    userNote,
    pendingFile: { localPath, publicPath, contentType, fileName },
  };
  await updateState((current) => {
    current.intakeReviews.unshift(record);
    current.intakeReviews = current.intakeReviews.slice(0, 40);
  });
  return record;
};

const candidateFor = (record: IntakeReviewRecord, text: string, images: SourceImage[]): Candidate => {
  const sourceUrl = record.bundle.source.canonicalUrl || record.bundle.source.publicPath || record.bundle.source.requestedUrl || "intake-review";
  return {
    id: `candidate_${record.id}`, rawId: record.id, sourceType: "user-intake",
    sourceName: record.bundle.source.kind === "url" ? new URL(sourceUrl).hostname.replace(/^www\./, "") : "截图导入",
    title: record.bundle.title, url: sourceUrl, canonicalUrl: sourceUrl,
    excerpt: text.slice(0, 360), publishedAt: record.bundle.capturedAt, fetchedAt: now(),
    score: 15, scoreBreakdown: { consequence: 4, novelty: 3, evidence: 3, relevance: 2, timeliness: 2, confirmation: 1, penalty: 0 },
    heatScore: 0, heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
    recommendationScore: 60, clusterSize: 1, relatedSources: [record.bundle.source.label],
    evidence: "用户已确认导入证据", imageCount: images.length, images, selected: true, status: "candidate",
  };
};

const claimReviewGeneration = async (reviewId: string, selection: EvidenceReviewSelection) => {
  let result: { record: IntakeReviewRecord; provider: AiProviderConfig; skills: ArticleSkillConfig[]; run: WorkflowRun } | undefined;
  await updateState((state) => {
    const record = state.intakeReviews.find((entry) => entry.id === reviewId);
    if (!record) throw new Error("证据复核记录不存在");
    if (record.status !== "pending") throw new Error("这份证据已经确认或取消");
    const provider = providerFor(state);
    const generationSkills = skillsForArticleTask(state.aiSettings.skills, "generation");
    const normalized = normalizeEvidenceSelection(record.bundle, { ...selection, confirmedAt: selection.confirmedAt || now() });
    assertEvidenceReadyForDraft(normalized);
    const timestamp = now();
    const runId = `intake_${randomUUID().slice(0, 10)}`;
    const draftId = `draft_${record.id}`;
    const run: WorkflowRun = {
      id: runId, createdAt: timestamp, updatedAt: timestamp, status: "generating", stage: "使用已确认的证据成稿",
      windowHours: 24, sourceIds: [], scheduled: false, rawCount: 1, candidates: [],
      origin: record.bundle.source.kind === "url" ? "link-intake" : "screenshot-intake",
      intake: { sourceLabel: record.bundle.source.label, sourceUrl: record.bundle.source.canonicalUrl, sourceAssetPath: record.bundle.source.assetPath },
      logs: [{ at: timestamp, stage: "证据复核已确认", message: "只使用用户保留的正文和图片生成草稿", level: "success" }],
      generation: { id: `generation_${randomUUID().slice(0, 10)}`, status: "running", providerId: provider.id, skillIds: generationSkills.map((skill) => skill.id), candidateIds: [`candidate_${record.id}`], startedAt: timestamp },
    };
    record.status = "confirmed";
    record.selection = { ...selection, confirmedAt: normalized.review.confirmedAt };
    record.runId = runId;
    record.draftId = draftId;
    record.updatedAt = timestamp;
    state.runs.unshift(run);
    state.runs = state.runs.slice(0, 30);
    result = { record: structuredClone(record), provider: structuredClone(provider), skills: generationSkills.map((skill) => structuredClone(skill)), run: structuredClone(run) };
  });
  if (!result) throw new Error("证据复核任务创建失败");
  return result;
};

const executeReviewGeneration = async (claim: Awaited<ReturnType<typeof claimReviewGeneration>>) => {
  const normalized = normalizeEvidenceSelection(claim.record.bundle, claim.record.selection ?? {});
  const images: SourceImage[] = normalized.images.map((image) => ({
    id: image.id,
    url: image.publicPath || image.url || claim.record.bundle.source.publicPath || "",
    localPath: image.localPath,
    publicPath: image.publicPath,
    caption: image.caption,
    attribution: image.attribution || claim.record.bundle.source.label,
    sourceUrl: image.sourceUrl || claim.record.bundle.source.canonicalUrl || claim.record.bundle.source.publicPath || "",
    selected: true,
    rights: claim.record.bundle.source.kind === "screenshot" ? "editorial-screenshot" : "check-required",
    evidenceNote: claim.record.bundle.source.kind === "screenshot" ? "用户确认的原始截图区域" : undefined,
    evidencePath: claim.record.bundle.source.assetPath,
    allowedPlatforms: [],
  }));
  const candidate = candidateFor(claim.record, normalized.text, images);
  try {
    await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === claim.run.id);
      if (run) run.candidates = [candidate];
    });
    const draft = await generateCandidateDraft(
      claim.run.id,
      candidate,
      claim.provider,
      claim.skills,
      claim.record.draftId,
      { extractedText: normalized.text, canonicalUrl: candidate.canonicalUrl, images, skipExtraction: true },
    );
    draft.intake = {
      type: claim.record.bundle.source.kind === "url" ? "link" : "screenshot",
      extractedText: normalized.text,
      ignoredElements: claim.record.bundle.noiseBlocks.map((entry) => `${entry.reason}：${entry.text}`),
      sourceAssetPath: claim.record.bundle.source.assetPath,
    };
    const finishedAt = now();
    await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === claim.run.id);
      if (!run) return;
      candidate.status = "drafted";
      run.candidates = [candidate]; run.status = "complete"; run.stage = "快速草稿已生成"; run.completedAt = finishedAt; run.updatedAt = finishedAt;
      if (run.generation) { run.generation.status = "complete"; run.generation.completedAt = finishedAt; }
      run.logs.push({ at: finishedAt, stage: "快速草稿已生成", message: `已生成可编辑草稿：${draft.title}`, level: "success" });
      state.drafts.unshift(draft);
    });
  } catch (error) {
    await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === claim.run.id);
      if (!run) return;
      const finishedAt = now();
      run.status = "failed"; run.stage = "快速成稿失败"; run.error = error instanceof Error ? error.message : String(error); run.completedAt = finishedAt; run.updatedAt = finishedAt;
      if (run.generation) { run.generation.status = "failed"; run.generation.completedAt = finishedAt; }
    });
  }
};

export const confirmIntakeReview = async (reviewId: string, selection: EvidenceReviewSelection) => {
  const claim = await claimReviewGeneration(reviewId, selection);
  void executeReviewGeneration(claim);
  return { review: claim.record, run: claim.run, draftId: claim.record.draftId! };
};

export const listIntakeReviews = async () => (await readState()).intakeReviews;
