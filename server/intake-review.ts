import { createHash } from "node:crypto";

export type EvidenceMethod = "link-extractor" | "screenshot-vision";

export interface EvidenceRawSource {
  kind: "url" | "screenshot";
  label: string;
  requestedUrl?: string;
  canonicalUrl?: string;
  assetPath?: string;
  publicPath?: string;
  rawText?: string;
  rawTextAvailable: boolean;
}

export interface EvidenceTextBlock {
  id: string;
  text: string;
  kind: "heading" | "paragraph" | "quote";
  origin: "extractor" | "vision-model";
}

export interface EvidenceInputTextBlock {
  id?: string;
  text: string;
  kind?: EvidenceTextBlock["kind"];
}

export interface EvidenceNoiseBlock {
  id: string;
  text: string;
  reason: string;
  origin: "extractor" | "vision-model";
}

export interface EvidenceImageCandidate {
  id: string;
  url?: string;
  localPath?: string;
  publicPath?: string;
  sourceUrl?: string;
  caption: string;
  attribution?: string;
  width?: number;
  height?: number;
  selectedByDefault: boolean;
  region?: {
    x: number;
    y: number;
    width: number;
    height: number;
    coordinateSystem: "normalized-1000";
  };
}

export interface EvidenceBundle {
  id: string;
  method: EvidenceMethod;
  capturedAt: string;
  title: string;
  source: EvidenceRawSource;
  cleanedTextBlocks: EvidenceTextBlock[];
  noiseBlocks: EvidenceNoiseBlock[];
  imageCandidates: EvidenceImageCandidate[];
  warnings: string[];
}

export interface LinkEvidenceInput {
  sourceUrl: string;
  canonicalUrl?: string;
  title?: string;
  rawSourceText?: string;
  extractedText?: string;
  cleanedTextBlocks?: EvidenceInputTextBlock[];
  removedNoise?: Array<{ text: string; reason: string }>;
  images?: Array<{
    id?: string;
    url: string;
    localPath?: string;
    publicPath?: string;
    sourceUrl?: string;
    caption?: string;
    attribution?: string;
    width?: number;
    height?: number;
    selected?: boolean;
  }>;
  capturedAt?: string;
}

export interface ScreenshotEvidenceInput {
  fileName?: string;
  sourceAssetPath: string;
  sourcePublicPath?: string;
  title?: string;
  extractedText?: string;
  cleanedTextBlocks?: EvidenceInputTextBlock[];
  ignoredElements?: Array<string | { text: string; reason?: string }>;
  imageRegions?: Array<{
    id?: string;
    x: number;
    y: number;
    width: number;
    height: number;
    caption?: string;
    localPath?: string;
    publicPath?: string;
    selected?: boolean;
  }>;
  capturedAt?: string;
}

export interface EvidenceReviewSelection {
  confirmedAt?: string;
  excludedTextBlockIds?: string[];
  includedNoiseBlockIds?: string[];
  includedImageIds?: string[];
  note?: string;
}

export interface NormalizedIntakeInput {
  evidenceBundleId: string;
  method: EvidenceMethod;
  capturedAt: string;
  title: string;
  source: EvidenceRawSource;
  text: string;
  textBlocks: Array<{
    id: string;
    text: string;
    kind: EvidenceTextBlock["kind"] | "restored-noise";
    origin: EvidenceTextBlock["origin"] | EvidenceNoiseBlock["origin"];
  }>;
  images: EvidenceImageCandidate[];
  warnings: string[];
  review: {
    status: "confirmed" | "needs-review";
    confirmedAt?: string;
    excludedTextBlockIds: string[];
    includedNoiseBlockIds: string[];
    excludedImageIds: string[];
    note?: string;
  };
}

const compactText = (value: string | undefined) => value?.replace(/[\t ]+/g, " ").trim() || "";

const stableId = (prefix: string, ...values: Array<string | number>) =>
  `${prefix}_${createHash("sha1").update(values.join("\u241f")).digest("hex").slice(0, 12)}`;

const splitTextBlocks = (text: string | undefined) => {
  const normalized = compactText(text);
  if (!normalized) return [];
  return normalized
    .split(/\n\s*\n+/)
    .map((block) => compactText(block.replace(/\n+/g, " ")))
    .filter(Boolean);
};

const evidenceTextBlocks = (
  explicitBlocks: EvidenceInputTextBlock[] | undefined,
  fallbackText: string | undefined,
  sourceKey: string,
  origin: EvidenceTextBlock["origin"],
) => {
  const candidates: EvidenceInputTextBlock[] = explicitBlocks?.length
    ? explicitBlocks
    : splitTextBlocks(fallbackText).map((text) => ({ text, kind: "paragraph" }));
  return candidates.flatMap<EvidenceTextBlock>((candidate, index) => {
    const text = compactText(candidate.text.replace(/\n+/g, " "));
    if (!text) return [];
    const kind = ["heading", "paragraph", "quote"].includes(candidate.kind || "")
      ? candidate.kind as EvidenceTextBlock["kind"]
      : "paragraph";
    return [{
      id: candidate.id || stableId("text", sourceKey, index, kind, text),
      text,
      kind,
      origin,
    }];
  });
};

export const buildLinkEvidenceBundle = (input: LinkEvidenceInput): EvidenceBundle => {
  const capturedAt = input.capturedAt || new Date().toISOString();
  const canonicalUrl = input.canonicalUrl || input.sourceUrl;
  const title = compactText(input.title) || "链接导入";
  const cleanedTextBlocks = evidenceTextBlocks(
    input.cleanedTextBlocks,
    input.extractedText,
    canonicalUrl,
    "extractor",
  );
  const noiseBlocks = (input.removedNoise || []).flatMap<EvidenceNoiseBlock>((entry, index) => {
    const text = compactText(entry.text);
    if (!text) return [];
    return [{
      id: stableId("noise", canonicalUrl, index, text),
      text,
      reason: compactText(entry.reason) || "extractor-removed",
      origin: "extractor",
    }];
  });
  const imageCandidates = (input.images || []).map<EvidenceImageCandidate>((image, index) => ({
    id: image.id || stableId("image", canonicalUrl, index, image.url),
    url: image.url,
    localPath: image.localPath,
    publicPath: image.publicPath,
    sourceUrl: image.sourceUrl || canonicalUrl,
    caption: compactText(image.caption) || "来源页面配图",
    attribution: compactText(image.attribution) || undefined,
    width: image.width,
    height: image.height,
    selectedByDefault: image.selected ?? false,
  }));
  const warnings: string[] = [];
  if (!input.rawSourceText) warnings.push("原始页面文本未保留；只能复核提取后的正文。 ".trim());
  if (!cleanedTextBlocks.length) warnings.push("没有可供复核的链接正文；请重新提取或改用截图入口。");
  if (!input.removedNoise?.length) warnings.push("当前提取结果未保留被剔除内容的明细。");

  return {
    id: stableId("evidence", "link", canonicalUrl, capturedAt),
    method: "link-extractor",
    capturedAt,
    title,
    source: {
      kind: "url",
      label: canonicalUrl,
      requestedUrl: input.sourceUrl,
      canonicalUrl,
      rawText: input.rawSourceText,
      rawTextAvailable: Boolean(input.rawSourceText),
    },
    cleanedTextBlocks,
    noiseBlocks,
    imageCandidates,
    warnings,
  };
};

const validNormalizedRegion = (region: ScreenshotEvidenceInput["imageRegions"] extends Array<infer Entry> | undefined ? Entry : never) =>
  [region.x, region.y, region.width, region.height].every(Number.isFinite)
  && region.x >= 0
  && region.y >= 0
  && region.width > 0
  && region.height > 0
  && region.x + region.width <= 1000
  && region.y + region.height <= 1000;

export const buildScreenshotEvidenceBundle = (input: ScreenshotEvidenceInput): EvidenceBundle => {
  const capturedAt = input.capturedAt || new Date().toISOString();
  const sourceKey = input.sourceAssetPath || input.sourcePublicPath || input.fileName || "screenshot";
  const title = compactText(input.title) || compactText(input.fileName) || "截图导入";
  const cleanedTextBlocks = evidenceTextBlocks(
    input.cleanedTextBlocks,
    input.extractedText,
    sourceKey,
    "vision-model",
  );
  const noiseBlocks = (input.ignoredElements || []).flatMap<EvidenceNoiseBlock>((entry, index) => {
    const text = compactText(typeof entry === "string" ? entry : entry.text);
    if (!text) return [];
    const explicitReason = typeof entry === "string" ? "" : compactText(entry.reason);
    return [{
      id: stableId("noise", sourceKey, index, text),
      text,
      reason: explicitReason || "upstream-identified-noise",
      origin: "vision-model",
    }];
  });
  const invalidRegionCount = (input.imageRegions || []).filter((region) => !validNormalizedRegion(region)).length;
  const imageCandidates = (input.imageRegions || []).flatMap<EvidenceImageCandidate>((region, index) => {
    if (!validNormalizedRegion(region)) return [];
    const publicPath = compactText(region.publicPath) || undefined;
    return [{
      id: region.id || stableId("region", sourceKey, index, region.x, region.y, region.width, region.height),
      url: publicPath || input.sourcePublicPath,
      localPath: compactText(region.localPath) || undefined,
      publicPath,
      sourceUrl: input.sourcePublicPath,
      caption: compactText(region.caption) || `截图区域 ${index + 1}`,
      attribution: "用户提供截图",
      selectedByDefault: region.selected ?? false,
      region: {
        x: region.x,
        y: region.y,
        width: region.width,
        height: region.height,
        coordinateSystem: "normalized-1000",
      },
    }];
  });
  const warnings: string[] = [];
  if (!cleanedTextBlocks.length) {
    warnings.push("没有上游 OCR 或视觉模型文字；系统未自行补写截图内容。");
  }
  if (!noiseBlocks.length) warnings.push("上游没有返回被剔除内容的明细。");
  if (invalidRegionCount) warnings.push(`${invalidRegionCount} 个截图区域坐标无效，已保留原图但未加入候选。`);

  return {
    id: stableId("evidence", "screenshot", sourceKey, capturedAt),
    method: "screenshot-vision",
    capturedAt,
    title,
    source: {
      kind: "screenshot",
      label: compactText(input.fileName) || "用户提供截图",
      assetPath: input.sourceAssetPath,
      publicPath: input.sourcePublicPath,
      rawTextAvailable: false,
    },
    cleanedTextBlocks,
    noiseBlocks,
    imageCandidates,
    warnings,
  };
};

export const normalizeEvidenceSelection = (
  bundle: EvidenceBundle,
  selection: EvidenceReviewSelection,
): NormalizedIntakeInput => {
  const excludedText = new Set(selection.excludedTextBlockIds || []);
  const includedNoise = new Set(selection.includedNoiseBlockIds || []);
  const includedImages = new Set(
    selection.includedImageIds
      ?? bundle.imageCandidates.filter((image) => image.selectedByDefault).map((image) => image.id),
  );
  const selectedTextBlocks = bundle.cleanedTextBlocks.filter((block) => !excludedText.has(block.id));
  const restoredNoiseBlocks = bundle.noiseBlocks.filter((block) => includedNoise.has(block.id));
  const textBlocks = [
    ...selectedTextBlocks.map((block) => ({
      id: block.id,
      text: block.text,
      kind: block.kind,
      origin: block.origin,
    })),
    ...restoredNoiseBlocks.map((block) => ({
      id: block.id,
      text: block.text,
      kind: "restored-noise" as const,
      origin: block.origin,
    })),
  ];
  const images = bundle.imageCandidates.filter((image) => includedImages.has(image.id));

  return {
    evidenceBundleId: bundle.id,
    method: bundle.method,
    capturedAt: bundle.capturedAt,
    title: bundle.title,
    source: { ...bundle.source },
    text: textBlocks.map((block) => block.text).join("\n\n"),
    textBlocks,
    images,
    warnings: [
      ...bundle.warnings,
      ...(selection.confirmedAt ? [] : ["证据尚未由用户确认，不应直接生成或发布草稿。"]),
    ],
    review: {
      status: selection.confirmedAt ? "confirmed" : "needs-review",
      confirmedAt: selection.confirmedAt,
      excludedTextBlockIds: bundle.cleanedTextBlocks
        .filter((block) => excludedText.has(block.id))
        .map((block) => block.id),
      includedNoiseBlockIds: restoredNoiseBlocks.map((block) => block.id),
      excludedImageIds: bundle.imageCandidates
        .filter((image) => !includedImages.has(image.id))
        .map((image) => image.id),
      note: compactText(selection.note) || undefined,
    },
  };
};

export const assertEvidenceReadyForDraft = (
  input: NormalizedIntakeInput,
): NormalizedIntakeInput => {
  if (input.review.status !== "confirmed" || !input.review.confirmedAt) {
    throw new Error("请先完成证据复核并由用户确认，再生成草稿。");
  }
  if (!compactText(input.text)) {
    throw new Error("证据复核后没有可用正文，不能生成草稿。");
  }
  return input;
};
