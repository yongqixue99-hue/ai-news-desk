import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

import { runGenerationProvider } from "./provider-runtime.js";
import { loadAvailableArticleSkills } from "./skill-registry.js";
import {
  workflowJobsRoot,
  workflowMediaRoot,
} from "./storage.js";
import type {
  AiProviderConfig,
  ArticleSkillConfig,
  DraftImagePlacement,
  SourceImage,
} from "./types.js";

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
