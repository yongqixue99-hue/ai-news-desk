import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { legacyDraftBodyHtml } from "./article-html.js";
import { extractPage } from "./extractor.js";
import { generateCandidateDraft } from "./generator.js";
import { saveUploadedDraftImage } from "./media.js";
import { runGenerationProvider } from "./provider-runtime.js";
import { retainWorkflowRuns } from "./run-retention.js";
import { loadAvailableArticleSkills, skillsForArticleTask } from "./skill-registry.js";
import {
  readState,
  updateState,
  workflowJobsRoot,
  workflowMediaRoot,
} from "./storage.js";
import type {
  AiProviderConfig,
  ArticleDraft,
  ArticleSkillConfig,
  Candidate,
  DraftImagePlacement,
  SourceImage,
  WorkflowRun,
  WorkflowState,
} from "./types.js";

const now = () => new Date().toISOString();

const screenshotSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title",
    "paragraphs",
    "take",
    "extractedText",
    "ignoredElements",
    "imageRegions",
    "topics",
    "uncertainties",
  ],
  properties: {
    title: { type: "string", minLength: 8, maxLength: 60 },
    paragraphs: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: { type: "string", minLength: 10 },
    },
    take: { type: "string", maxLength: 320 },
    extractedText: { type: "string", minLength: 10 },
    ignoredElements: { type: "array", items: { type: "string" }, maxItems: 20 },
    imageRegions: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["x", "y", "width", "height", "afterParagraph", "caption"],
        properties: {
          x: { type: "integer", minimum: 0, maximum: 1000 },
          y: { type: "integer", minimum: 0, maximum: 1000 },
          width: { type: "integer", minimum: 1, maximum: 1000 },
          height: { type: "integer", minimum: 1, maximum: 1000 },
          afterParagraph: { type: "integer", minimum: 0, maximum: 7 },
          caption: { type: "string", maxLength: 240 },
        },
      },
    },
    topics: { type: "array", maxItems: 0, items: { type: "string" } },
    uncertainties: { type: "array", items: { type: "string" }, maxItems: 12 },
  },
} as const;

export interface ScreenshotArticle {
  title: string;
  paragraphs: string[];
  take: string;
  extractedText: string;
  ignoredElements: string[];
  imageRegions: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
    afterParagraph: number;
    caption: string;
  }>;
  topics: string[];
  uncertainties: string[];
}

interface IntakeClaim {
  run: WorkflowRun;
  draftId: string;
  candidateId: string;
  provider: AiProviderConfig;
  skills: ArticleSkillConfig[];
}

export interface IntakeRequestResult {
  run: WorkflowRun;
  draftId: string;
}

const providerSnapshot = (state: WorkflowState, needsVision: boolean) => {
  const provider = state.aiSettings.providers.find(
    (entry) => entry.id === state.aiSettings.activeProviderId,
  );
  if (!provider) throw new Error("当前 AI Provider 不存在，请到 AI 设置重新选择");
  if (provider.kind !== "codex-cli" && !provider.apiKeyConfigured) {
    throw new Error(`请先在 AI 设置中配置 ${provider.name} 的 API Key`);
  }
  if (needsVision && !provider.supportsVision) {
    throw new Error(`${provider.name} 当前只支持文本。请切换到 Codex、通义千问视觉模型或 OpenAI 视觉模型。`);
  }
  if (needsVision && provider.kind !== "codex-cli" && !provider.visionModel?.trim()) {
    throw new Error(`请先在 AI 设置中填写 ${provider.name} 的视觉模型`);
  }
  return provider;
};

const createIntakeClaim = async (
  origin: "link-intake" | "screenshot-intake",
  sourceLabel: string,
  sourceUrl?: string,
): Promise<IntakeClaim> => {
  let claim: IntakeClaim | undefined;
  await updateState((state) => {
    const provider = providerSnapshot(state, origin === "screenshot-intake");
    const generationSkills = skillsForArticleTask(state.aiSettings.skills, "generation");
    const timestamp = now();
    const token = randomUUID().slice(0, 10);
    const runId = `intake_${token}`;
    const draftId = `draft_intake_${token}`;
    const candidateId = `candidate_intake_${token}`;
    const stage = origin === "screenshot-intake" ? "识别并清理截图" : "读取并清理链接";
    const run: WorkflowRun = {
      id: runId,
      createdAt: timestamp,
      updatedAt: timestamp,
      status: "generating",
      stage,
      windowHours: 24,
      topicIds: state.settings.collectionTopics,
      sourceIds: [],
      scheduled: false,
      rawCount: 1,
      candidates: [],
      origin,
      intake: { sourceLabel, sourceUrl },
      logs: [{ at: timestamp, stage, message: `${sourceLabel} 已进入快速成稿队列`, level: "info" }],
      generation: {
        id: `generation_${token}`,
        status: "running",
        providerId: provider.id,
        skillIds: generationSkills.map((skill) => skill.id),
        candidateIds: [candidateId],
        startedAt: timestamp,
      },
    };
    state.runs.unshift(run);
    retainWorkflowRuns(state);
    claim = {
      run,
      draftId,
      candidateId,
      provider: { ...provider },
      skills: generationSkills.map((skill) => ({ ...skill })),
    };
  });
  if (!claim) throw new Error("快速成稿任务创建失败");
  return claim;
};

const appendLog = async (
  runId: string,
  stage: string,
  message: string,
  level: "info" | "success" | "warning" | "error" = "info",
) => {
  await updateState((state) => {
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) return;
    run.logs.push({ at: now(), stage, message: message.slice(0, 900), level });
    run.stage = stage;
    run.updatedAt = now();
  });
};

const completeIntake = async (runId: string, draft: ArticleDraft, candidate: Candidate) => {
  await updateState((state) => {
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) return;
    const finishedAt = now();
    candidate.status = "drafted";
    run.candidates = [candidate];
    run.status = "complete";
    run.stage = "快速草稿已生成";
    run.updatedAt = finishedAt;
    run.completedAt = finishedAt;
    if (run.generation) {
      run.generation.status = "complete";
      run.generation.completedAt = finishedAt;
    }
    run.logs.push({
      at: finishedAt,
      stage: "快速草稿已生成",
      message: `已生成可编辑草稿：${draft.title}`,
      level: "success",
    });
    state.drafts.unshift(draft);
  });
};

const failIntake = async (runId: string, error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  await updateState((state) => {
    const run = state.runs.find((entry) => entry.id === runId);
    if (!run) return;
    const finishedAt = now();
    run.status = "failed";
    run.stage = "快速成稿失败";
    run.error = message;
    run.updatedAt = finishedAt;
    run.completedAt = finishedAt;
    if (run.generation) {
      run.generation.status = "failed";
      run.generation.completedAt = finishedAt;
    }
    run.logs.push({ at: finishedAt, stage: "快速成稿失败", message, level: "error" });
  });
};

const directCandidate = (
  id: string,
  sourceName: string,
  title: string,
  url: string,
  excerpt: string,
  publishedAt: string,
  images: SourceImage[] = [],
): Candidate => ({
  id,
  rawId: id,
  sourceType: "user-intake",
  sourceName,
  title,
  url,
  canonicalUrl: url,
  excerpt: excerpt.slice(0, 360),
  publishedAt,
  fetchedAt: now(),
  score: 15,
  scoreBreakdown: {
    consequence: 4,
    novelty: 3,
    evidence: 3,
    relevance: 2,
    timeliness: 2,
    confirmation: 1,
    penalty: 0,
  },
  heatScore: 0,
  heatBreakdown: { engagement: 0, sourceReach: 0, crossSource: 0, freshness: 0 },
  recommendationScore: 60,
  clusterSize: 1,
  relatedSources: [sourceName],
  evidence: "用户直接提供",
  imageCount: images.length,
  images,
  selected: true,
  status: "candidate",
});

const executeLinkIntake = async (claim: IntakeClaim, rawUrl: string) => {
  try {
    await appendLog(claim.run.id, "提取链接正文", "正在识别正文区域，并过滤导航、登录框与页脚");
    const state = await readState();
    const page = await extractPage(rawUrl, state.settings.imageLimit);
    if (page.text.length < 80) throw new Error("这个页面没有提取到足够正文，建议改用截图入口");
    const sourceName = new URL(page.canonicalUrl).hostname.replace(/^www\./, "");
    const candidate = directCandidate(
      claim.candidateId,
      sourceName,
      page.title || "链接快速成稿",
      page.canonicalUrl,
      page.text,
      page.publishedAt || now(),
      page.images,
    );
    await updateState((current) => {
      const run = current.runs.find((entry) => entry.id === claim.run.id);
      if (!run) return;
      run.candidates = [candidate];
      run.stage = "核验并生成草稿";
      run.updatedAt = now();
    });
    const draft = await generateCandidateDraft(
      claim.run.id,
      candidate,
      claim.provider,
      claim.skills,
      claim.draftId,
    );
    draft.intake = { type: "link", extractedText: page.text };
    draft.provenance.originalUrl = page.canonicalUrl;
    await completeIntake(claim.run.id, draft, candidate);
  } catch (error) {
    await failIntake(claim.run.id, error);
  }
};

export const requestLinkIntake = async (rawUrl: string): Promise<IntakeRequestResult> => {
  const url = new URL(rawUrl).toString();
  const claim = await createIntakeClaim("link-intake", new URL(url).hostname, url);
  void executeLinkIntake(claim, url);
  return { run: claim.run, draftId: claim.draftId };
};

const parseScreenshotArticle = (rendered: string): ScreenshotArticle => {
  const parsed = JSON.parse(
    rendered.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""),
  ) as Partial<ScreenshotArticle>;
  if (
    typeof parsed.title !== "string"
    || !Array.isArray(parsed.paragraphs)
    || parsed.paragraphs.some((paragraph) => typeof paragraph !== "string")
    || parsed.paragraphs.length < 1
    || typeof parsed.take !== "string"
    || typeof parsed.extractedText !== "string"
  ) {
    throw new Error("视觉模型没有返回完整的截图正文，请重试或更换视觉模型");
  }
  const imageRegions = Array.isArray(parsed.imageRegions)
    ? parsed.imageRegions.flatMap<ScreenshotArticle["imageRegions"][number]>((region) => {
        if (!region || typeof region !== "object") return [];
        const values = [region.x, region.y, region.width, region.height, region.afterParagraph];
        if (values.some((value) => !Number.isFinite(Number(value)))) return [];
        return [{
          x: Math.round(Number(region.x)),
          y: Math.round(Number(region.y)),
          width: Math.round(Number(region.width)),
          height: Math.round(Number(region.height)),
          afterParagraph: Math.round(Number(region.afterParagraph)),
          caption: typeof region.caption === "string" ? region.caption.trim().slice(0, 240) : "截图正文配图",
        }];
      })
    : [];
  return {
    title: parsed.title.trim().slice(0, 80),
    paragraphs: parsed.paragraphs.map((paragraph) => paragraph.trim()).filter(Boolean).slice(0, 6),
    take: parsed.take.replace(/^我的判断[：:]?\s*/u, "").trim().slice(0, 240),
    extractedText: parsed.extractedText.trim().slice(0, 30_000),
    ignoredElements: Array.isArray(parsed.ignoredElements)
      ? parsed.ignoredElements.filter((item): item is string => typeof item === "string").slice(0, 20)
      : [],
    imageRegions,
    topics: Array.isArray(parsed.topics)
      ? [...new Set(parsed.topics.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].slice(0, 6)
      : [],
    uncertainties: Array.isArray(parsed.uncertainties)
      ? parsed.uncertainties.filter((item): item is string => typeof item === "string").slice(0, 12)
      : [],
  };
};

const clampRegion = (value: number) => Math.max(0, Math.min(1000, value));

const cropScreenshotImages = async (
  bytes: Buffer,
  draftId: string,
  article: ScreenshotArticle,
): Promise<DraftImagePlacement[]> => {
  const metadata = await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
  if (!metadata.width || !metadata.height) return [];
  const directory = path.join(workflowMediaRoot, draftId);
  await mkdir(directory, { recursive: true });
  const placements: DraftImagePlacement[] = [];
  for (const [index, region] of article.imageRegions.entries()) {
    const left = Math.round((clampRegion(region.x) / 1000) * metadata.width);
    const top = Math.round((clampRegion(region.y) / 1000) * metadata.height);
    const requestedWidth = Math.round((clampRegion(region.width) / 1000) * metadata.width);
    const requestedHeight = Math.round((clampRegion(region.height) / 1000) * metadata.height);
    const width = Math.min(requestedWidth, metadata.width - left);
    const height = Math.min(requestedHeight, metadata.height - top);
    if (width < 180 || height < 110) continue;
    const id = `screenshot_crop_${createHash("sha1")
      .update(`${draftId}:${index}:${left}:${top}:${width}:${height}`)
      .digest("hex")
      .slice(0, 10)}`;
    const fileName = `${id}.webp`;
    const localPath = path.join(directory, fileName);
    await sharp(bytes, { limitInputPixels: 80_000_000 })
      .extract({ left, top, width, height })
      .webp({ quality: 90 })
      .toFile(localPath);
    const publicPath = `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`;
    const image: SourceImage = {
      id,
      url: publicPath,
      localPath,
      publicPath,
      caption: region.caption || `截图正文配图 ${index + 1}`,
      attribution: "用户提供截图",
      sourceUrl: publicPath,
      width,
      height,
      selected: true,
      rights: "commentary-screenshot",
    };
    placements.push({
      id: `placement_${randomUUID().slice(0, 8)}`,
      image,
      afterParagraph: Math.max(0, Math.min(article.paragraphs.length - 1, region.afterParagraph)),
      caption: image.caption,
    });
  }
  return placements;
};

export const analyzeScreenshotEvidence = async (input: {
  bytes: Buffer;
  contentType: string;
  sourcePath: string;
  jobId: string;
  provider: AiProviderConfig;
  skills: ArticleSkillConfig[];
  note?: string;
}) => {
  const selectedSkills = (await loadAvailableArticleSkills(input.skills, 20_000)).map(({ skill, instructions }) => ({
    name: skill.name,
    compatibility: skill.compatibility,
    instructions,
  }));
  const jobPath = path.join(workflowJobsRoot, `${input.jobId}-screenshot-evidence-job.json`);
  const schemaPath = path.join(workflowJobsRoot, "screenshot-output-schema.json");
  const outputPath = path.join(workflowJobsRoot, `${input.jobId}-screenshot-evidence-output.json`);
  const job = {
    imagePath: input.sourcePath,
    userNote: input.note?.trim().slice(0, 600) || undefined,
    selectedSkills,
    coordinateSystem: "图片左上角为 (0,0)，右下角为 (1000,1000) 的归一化坐标",
    outputSchema: screenshotSchema,
  };
  await Promise.all([
    writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8"),
    writeFile(schemaPath, `${JSON.stringify(screenshotSchema, null, 2)}\n`, "utf8"),
  ]);
  const rendered = await runGenerationProvider({
    provider: input.provider,
    codexPrompt: `请完整执行截图证据提取任务，不要向用户提问。读取 ${jobPath}，再使用图像查看能力打开 job.imagePath。这里只做 OCR、网页去噪和正文图片定位；所有文字必须来自截图。严格返回符合 schema 的 JSON。`,
    apiSystemPrompt: `你是截图证据提取引擎。截图是唯一证据。区分正文与浏览器栏、导航、登录状态、头像、按钮、广告、推荐列表、评论和页脚。extractedText 必须是截图中可见的正文原文；ignoredElements 记录被剔除内容；imageRegions 只框正文照片、图表或产品截图，不框 logo、头像、图标和广告。不得补写截图中不存在的内容。paragraphs 和 take 只用于帮助结构化，但后续仍会由用户复核再成稿。topics 必须为空。严格返回 JSON。`,
    apiUserPrompt: `请提取这张截图的证据。任务数据：\n${JSON.stringify(job)}`,
    schemaPath,
    outputPath,
    codexImagePath: input.sourcePath,
    apiImageDataUrl: `data:${input.contentType};base64,${input.bytes.toString("base64")}`,
    modelOverride: input.provider.kind === "codex-cli" ? undefined : input.provider.visionModel,
  });
  const article = parseScreenshotArticle(rendered);
  const croppedPlacements = await cropScreenshotImages(input.bytes, input.jobId, article);
  return { article, croppedPlacements };
};

const executeScreenshotIntake = async (
  claim: IntakeClaim,
  bytes: Buffer,
  contentType: string,
  fileName: string,
  note?: string,
) => {
  try {
    const sourcePlacement = await saveUploadedDraftImage(
      claim.draftId,
      bytes,
      contentType,
      fileName,
      "用户提交的原始截图",
    );
    sourcePlacement.image.attribution = "用户提供截图";
    sourcePlacement.image.rights = "commentary-screenshot";
    const sourcePath = sourcePlacement.image.localPath;
    if (!sourcePath) throw new Error("截图文件保存失败");
    await updateState((state) => {
      const run = state.runs.find((entry) => entry.id === claim.run.id);
      if (!run?.intake) return;
      run.intake.sourceAssetPath = sourcePath;
    });
    await appendLog(claim.run.id, "视觉识别与去噪", "正在识别正文、忽略登录与导航信息，并定位正文图片");

    const selectedSkills = (await loadAvailableArticleSkills(claim.skills, 20_000)).map(({ skill, instructions }) => ({
      name: skill.name,
      compatibility: skill.compatibility,
      instructions,
    }));
    const jobPath = path.join(workflowJobsRoot, `${claim.run.id}-screenshot-job.json`);
    const schemaPath = path.join(workflowJobsRoot, "screenshot-output-schema.json");
    const outputPath = path.join(workflowJobsRoot, `${claim.run.id}-screenshot-output.json`);
    const job = {
      imagePath: sourcePath,
      userNote: note?.trim().slice(0, 600) || undefined,
      selectedSkills,
      coordinateSystem: "图片左上角为 (0,0)，右下角为 (1000,1000) 的归一化坐标",
      outputSchema: screenshotSchema,
    };
    await writeFile(jobPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await writeFile(schemaPath, `${JSON.stringify(screenshotSchema, null, 2)}\n`, "utf8");
    const systemPrompt = `你是中文新闻编辑工作台的视觉提取与成稿引擎。截图是唯一证据。必须先区分正文与网页外壳：浏览器栏、导航、登录状态、头像、按钮、广告、推荐列表、评论和页脚不得混入正文。OCR 后只依据保留下来的正文写事实简讯：直接交代谁做了什么，通常 1–3 段，事实说完就停；不强制字数、段落数或结尾观点，take 可以为空。不得补写截图中没有的数字、日期、引语或个人经历。只框选正文里的照片、图表或产品截图，不要框 logo、头像、图标、按钮和广告；使用 0–1000 归一化坐标。topics 必须为空数组，平台标签只由用户选择。严格返回 JSON。`;
    const rendered = await runGenerationProvider({
      provider: claim.provider,
      codexPrompt: `请完整执行截图成稿任务，不要向用户提问。读取 ${jobPath}，再使用图像查看能力打开 job.imagePath。识别正文与可用图片区域，执行已启用的 Skill，并把严格符合 schema 的 JSON 写入输出。`,
      apiSystemPrompt: systemPrompt,
      apiUserPrompt: `请处理这张截图。任务数据：\n${JSON.stringify(job)}`,
      schemaPath,
      outputPath,
      codexImagePath: sourcePath,
      apiImageDataUrl: `data:${contentType};base64,${bytes.toString("base64")}`,
      modelOverride: claim.provider.kind === "codex-cli" ? undefined : claim.provider.visionModel,
    });
    const article = parseScreenshotArticle(rendered);
    const croppedPlacements = await cropScreenshotImages(bytes, claim.draftId, article);
    sourcePlacement.afterParagraph = -1;
    const state = await readState();
    const createdAt = now();
    const uncertainties = [...article.uncertainties];
    if (!uncertainties.some((item) => item.includes("原始链接"))) {
      uncertainties.push("截图未提供可核验的原始网页链接，发布前建议补充来源。");
    }
    const draft: ArticleDraft = {
      id: claim.draftId,
      runId: claim.run.id,
      candidateId: claim.candidateId,
      createdAt,
      updatedAt: createdAt,
      status: "editing",
      title: article.title,
      draftStrategy: "brief",
      paragraphs: article.paragraphs,
      take: article.take,
      layoutTheme: "news-clean",
      sources: [{
        label: "用户提供的原始截图",
        url: sourcePlacement.image.publicPath || sourcePlacement.image.url,
        kind: "original-report",
        verified: false,
      }],
      uncertainties,
      images: [...croppedPlacements, sourcePlacement],
      community: state.settings.community,
      topics: [],
      provenance: {
        originalUrl: sourcePlacement.image.publicPath || sourcePlacement.image.url,
        generatedBy: claim.provider.id,
      },
      intake: {
        type: "screenshot",
        extractedText: article.extractedText,
        ignoredElements: article.ignoredElements,
        sourceAssetPath: sourcePath,
      },
    };
    draft.bodyHtml = legacyDraftBodyHtml(draft);
    const candidateImages = [sourcePlacement.image, ...croppedPlacements.map((placement) => placement.image)];
    const candidate = directCandidate(
      claim.candidateId,
      "截图导入",
      article.title,
      sourcePlacement.image.publicPath || sourcePlacement.image.url,
      article.extractedText,
      createdAt,
      candidateImages,
    );
    await completeIntake(claim.run.id, draft, candidate);
  } catch (error) {
    await failIntake(claim.run.id, error);
  }
};

export const requestScreenshotIntake = async (
  bytes: Buffer,
  contentType: string,
  fileName: string,
  note?: string,
): Promise<IntakeRequestResult> => {
  if (!bytes.length) throw new Error("上传的截图为空");
  if (bytes.length > 15 * 1024 * 1024) throw new Error("截图不能超过 15 MB");
  if (!["image/jpeg", "image/png", "image/webp"].includes(contentType)) {
    throw new Error("截图只支持 JPG、PNG 或 WebP");
  }
  await sharp(bytes, { limitInputPixels: 80_000_000 }).metadata();
  const claim = await createIntakeClaim("screenshot-intake", fileName || "截图导入");
  void executeScreenshotIntake(claim, bytes, contentType, fileName, note);
  return { run: claim.run, draftId: claim.draftId };
};
