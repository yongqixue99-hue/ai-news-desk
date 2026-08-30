import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { downloadSourceImage } from "./extractor.js";
import { workflowMediaRoot } from "./storage.js";
import type { DraftImagePlacement, SourceImage } from "./types.js";

const supportedTypes = new Map([
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
]);

const safeLabel = (value: string | undefined, fallback: string) => {
  if (!value) return fallback;
  try {
    return decodeURIComponent(value).replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 240) || fallback;
  } catch {
    return fallback;
  }
};

export const saveUploadedDraftImage = async (
  draftId: string,
  bytes: Buffer,
  contentType: string,
  fileNameHeader?: string,
  captionHeader?: string,
): Promise<DraftImagePlacement> => {
  const extension = supportedTypes.get(contentType);
  if (!extension) throw new Error("只支持 JPG、PNG、WebP 或 GIF 图片");
  if (!bytes.length) throw new Error("上传的图片为空");
  if (bytes.length > 10 * 1024 * 1024) throw new Error("图片不能超过 10 MB");

  const id = `upload_${randomUUID().slice(0, 10)}`;
  const directory = path.join(workflowMediaRoot, draftId);
  const fileName = `${id}${extension}`;
  const localPath = path.join(directory, fileName);
  await mkdir(directory, { recursive: true });
  await writeFile(localPath, bytes);
  const publicPath = `/media/${encodeURIComponent(draftId)}/${encodeURIComponent(fileName)}`;
  const originalName = safeLabel(fileNameHeader, "本地图片");
  const caption = safeLabel(captionHeader, originalName.replace(/\.[^.]+$/, ""));
  const image: SourceImage = {
    id,
    url: publicPath,
    localPath,
    publicPath,
    caption,
    attribution: "本地上传",
    sourceUrl: "local-upload",
    selected: true,
    rights: "check-required",
  };
  return {
    id: `placement_${randomUUID().slice(0, 8)}`,
    image,
    afterParagraph: -1,
    caption,
  };
};

export const importDraftImageFromUrl = async (
  draftId: string,
  rawUrl: string,
  rawCaption?: string,
): Promise<DraftImagePlacement> => {
  const url = new URL(rawUrl).toString();
  const caption = rawCaption?.trim().slice(0, 240) || "用户补充配图";
  const sourceImage: SourceImage = {
    id: createHash("sha1").update(url).digest("hex").slice(0, 12),
    url,
    caption,
    attribution: new URL(url).hostname,
    sourceUrl: url,
    selected: true,
    rights: "check-required",
  };
  const image = await downloadSourceImage(sourceImage, draftId);
  return {
    id: `placement_${randomUUID().slice(0, 8)}`,
    image,
    afterParagraph: -1,
    caption,
  };
};
