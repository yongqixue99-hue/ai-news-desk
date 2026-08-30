import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { inspectDraftImageFile } from "./published-materials.js";
import type { DraftImagePlacement } from "./types.js";
import type { WeChatImageAsset } from "./wechat-draft.js";

const maxWeChatImageBytes = 1_000_000;
const targetWidths = [1600, 1400, 1200, 1000, 800];
const targetQualities = [84, 74, 64, 54, 44];

const prepareWeChatImage = async (source: Uint8Array, sourceName: string): Promise<WeChatImageAsset> => {
  const metadata = await sharp(source, { limitInputPixels: 80_000_000 }).metadata().catch(() => {
    throw new Error(`无法读取图片：${sourceName}`);
  });
  if (!metadata.width || !metadata.height) throw new Error(`图片尺寸无效：${sourceName}`);

  const widths = [...new Set(targetWidths.map((width) => Math.min(width, metadata.width!)))];
  for (const width of widths) {
    for (const quality of targetQualities) {
      const bytes = await sharp(source, { limitInputPixels: 80_000_000 })
        .rotate()
        .flatten({ background: "#ffffff" })
        .resize({ width, withoutEnlargement: true })
        .jpeg({ quality, mozjpeg: true })
        .toBuffer();
      if (bytes.byteLength <= maxWeChatImageBytes) {
        return {
          bytes,
          fileName: `${path.basename(sourceName, path.extname(sourceName))}.jpg`,
          contentType: "image/jpeg",
        };
      }
    }
  }
  throw new Error(`图片压缩后仍超过 1 MB：${sourceName}`);
};

export const loadWeChatImageFile = async (localPath: string): Promise<WeChatImageAsset> => {
  const source = await readFile(localPath).catch(() => {
    throw new Error(`找不到待上传图片：${path.basename(localPath)}`);
  });
  return prepareWeChatImage(source, path.basename(localPath));
};

export const loadWeChatPlacementImage = async (
  placement: DraftImagePlacement,
): Promise<WeChatImageAsset> => {
  if (!placement.image.localPath) throw new Error(`图片“${placement.caption || placement.image.caption}”缺少本地文件`);
  const inspected = await inspectDraftImageFile(placement, true);
  if (!inspected.available || !inspected.bytes) {
    throw new Error(inspected.reason || `无法读取图片“${placement.caption || placement.image.caption}”`);
  }
  return prepareWeChatImage(inspected.bytes, path.basename(placement.image.localPath));
};
