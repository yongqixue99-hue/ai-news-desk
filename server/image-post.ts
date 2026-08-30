import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { workflowMediaRoot } from "./storage.js";
import type { ArticleDraft, DraftImagePlacement } from "./types.js";

export interface ScreenshotCropRegion {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ImagePostCopyInput {
  title: string;
  lines: string[];
}

const escapeHtml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

const compactLine = (value: string) => value.replace(/\s+/g, " ").trim();

export const normalizeImagePostCopy = (input: ImagePostCopyInput) => {
  const title = compactLine(input.title);
  const lines = input.lines.map(compactLine).filter(Boolean);
  if (!title) throw new Error("图文标题不能为空");
  if (title.length > 30) throw new Error(`图文标题不能超过 30 字（当前 ${title.length} 字）`);
  if (!lines.length) throw new Error("图文正文不能为空");
  if (lines.length > 3) throw new Error("图文正文最多 3 行");
  if (lines.some((line) => /总结|综上|总的来说|最后总结/.test(line))) {
    throw new Error("图文正文不要出现总结式表达");
  }
  if (lines.join("").length > 180) throw new Error("图文正文应保持简短（不超过 180 字）");
  return { title, lines };
};

const integerRegion = (region: ScreenshotCropRegion) => ({
  left: Math.round(region.left),
  top: Math.round(region.top),
  width: Math.round(region.width),
  height: Math.round(region.height),
});

export const cropScreenshotRegion = async (
  bytes: Buffer,
  requestedRegion: ScreenshotCropRegion,
) => {
  if (!bytes.length) throw new Error("截图文件为空");
  const region = integerRegion(requestedRegion);
  const metadata = await sharp(bytes).metadata();
  if (!metadata.width || !metadata.height) throw new Error("无法读取截图尺寸");
  if (
    region.left < 0
    || region.top < 0
    || region.width < 1
    || region.height < 1
    || region.left + region.width > metadata.width
    || region.top + region.height > metadata.height
  ) {
    throw new Error(`图片裁区超出截图范围（${metadata.width}×${metadata.height}）`);
  }
  // Decode, extract the requested pixels, and re-encode as PNG. No resizing,
  // enhancement, generation, or synthetic content is applied.
  return sharp(bytes).extract(region).png().toBuffer();
};

export interface ScreenshotImagePostAssets {
  originalLocalPath: string;
  originalPublicPath: string;
  cropLocalPath: string;
  cropPublicPath: string;
  cropFingerprint: string;
  cropWidth: number;
  cropHeight: number;
}

export const saveScreenshotImagePostAssets = async (
  draftId: string,
  bytes: Buffer,
  contentType: string,
  region: ScreenshotCropRegion,
): Promise<ScreenshotImagePostAssets> => {
  const sourceExtension = contentType === "image/jpeg"
    ? ".jpg"
    : contentType === "image/webp"
      ? ".webp"
      : contentType === "image/png"
        ? ".png"
        : undefined;
  if (!sourceExtension) throw new Error("截图只支持 PNG、JPG 或 WebP");
  if (bytes.length > 10 * 1024 * 1024) throw new Error("截图不能超过 10 MB");
  const directory = path.join(workflowMediaRoot, draftId);
  const originalFileName = `source${sourceExtension}`;
  const cropFileName = "image-post-crop.png";
  const originalLocalPath = path.join(directory, originalFileName);
  const cropLocalPath = path.join(directory, cropFileName);
  await mkdir(directory, { recursive: true });
  const cropBytes = await cropScreenshotRegion(bytes, region);
  await Promise.all([
    writeFile(originalLocalPath, bytes),
    writeFile(cropLocalPath, cropBytes),
  ]);
  const cropMetadata = await sharp(cropBytes).metadata();
  return {
    originalLocalPath,
    originalPublicPath: `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(originalFileName)}`,
    cropLocalPath,
    cropPublicPath: `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(cropFileName)}`,
    cropFingerprint: createHash("sha256").update(cropBytes).digest("hex"),
    cropWidth: cropMetadata.width || region.width,
    cropHeight: cropMetadata.height || region.height,
  };
};

export interface BuildScreenshotImagePostDraftInput extends ScreenshotImagePostAssets, ImagePostCopyInput {
  draftId?: string;
  createdAt?: string;
  community: string;
  topics: string[];
  sourceExcerpt: string;
}

export const buildScreenshotImagePostDraft = (
  input: BuildScreenshotImagePostDraftInput,
): ArticleDraft => {
  const { title, lines } = normalizeImagePostCopy(input);
  const draftId = input.draftId || `draft_image_post_${randomUUID().slice(0, 12)}`;
  const createdAt = input.createdAt || new Date().toISOString();
  const placementId = `placement_${randomUUID().slice(0, 10)}`;
  const sourceUrl = `http://127.0.0.1:4317${input.originalPublicPath}`;
  const cropUrl = `http://127.0.0.1:4317${input.cropPublicPath}`;
  const caption = "截图中的 8 美元重置按钮";
  const placement: DraftImagePlacement = {
    id: placementId,
    afterParagraph: lines.length - 1,
    caption,
    image: {
      id: `image_${randomUUID().slice(0, 10)}`,
      url: input.cropPublicPath,
      localPath: input.cropLocalPath,
      publicPath: input.cropPublicPath,
      caption,
      attribution: "用户提供截图（本次测试）",
      sourceUrl,
      width: input.cropWidth,
      height: input.cropHeight,
      selected: true,
      rights: "editorial-screenshot",
      evidenceNote: "从用户提供的原始截图中按像素裁取，仅用于本次评论性图文测试；未生成、未补画。",
      evidencePath: input.originalLocalPath,
      allowedPlatforms: ["xiaoheihe"],
      entityTags: ["Codex"],
      fingerprint: input.cropFingerprint,
    },
  };
  const bodyHtml = [
    ...lines.map((line) => `<p>${escapeHtml(line)}</p>`),
    `<img src="${escapeHtml(input.cropPublicPath)}" alt="${escapeHtml(caption)}" data-media-id="${placementId}" data-caption="${escapeHtml(caption)}" data-attribution="用户提供截图（本次测试）">`,
  ].join("");

  return {
    id: draftId,
    runId: `run_image_post_${randomUUID().slice(0, 10)}`,
    candidateId: `candidate_image_post_${randomUUID().slice(0, 10)}`,
    createdAt,
    updatedAt: createdAt,
    status: "editing",
    contentFormat: "image-post",
    title,
    paragraphs: lines,
    take: "",
    bodyHtml,
    layoutTheme: "news-clean",
    sources: [{
      label: "用户提供截图（本次测试）",
      url: sourceUrl,
      kind: "primary",
      verified: true,
    }],
    factClaims: [{
      id: `claim_${randomUUID().slice(0, 10)}`,
      claim: "用户提供的截图中出现“Pay $8 to reset”按钮",
      status: "full-source",
      sourceUrl,
      sourceLabel: "用户提供截图",
      sourceExcerpt: compactLine(input.sourceExcerpt),
      capturedAt: createdAt,
      note: "只证明该按钮出现在这张截图中，不代表所有账号均已开放。",
    }],
    uncertainties: [],
    images: [placement],
    community: compactLine(input.community) || "盒友杂谈",
    topics: input.topics.map(compactLine).filter(Boolean).slice(0, 5),
    provenance: {
      originalUrl: sourceUrl,
      generatedBy: "screenshot-image-post",
    },
    intake: {
      type: "screenshot",
      extractedText: compactLine(input.sourceExcerpt),
      ignoredElements: ["截图顶部的文章文字与网页界面，只保留内部图片裁区"],
      sourceAssetPath: input.originalLocalPath,
    },
  };
};
