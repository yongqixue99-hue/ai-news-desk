import sharp from "sharp";
import { inspectDraftImageFile } from "./published-materials.js";
import type { DraftImagePlacement } from "./types.js";

export const inspectXiaoheiheCover = async (placement: DraftImagePlacement) => {
  const inspected = await inspectDraftImageFile(placement, true);
  if (!inspected.available || !inspected.bytes || !placement.image.fingerprint || inspected.fingerprint !== placement.image.fingerprint) return { ...inspected, available: false, reason: inspected.reason || "封面文件指纹与保存记录不一致" };
  try {
    const metadata = await sharp(inspected.bytes, { limitInputPixels: 80_000_000 }).metadata();
    const width = metadata.autoOrient.width ?? metadata.width ?? 0, height = metadata.autoOrient.height ?? metadata.height ?? 0;
    if (width < 900 || height < 480) return { ...inspected, available: false, reason: `封面至少需要 900 × 480，当前为 ${width} × ${height}` };
    return inspected;
  } catch { return { ...inspected, available: false, reason: "封面不是有效图片，请重新上传" }; }
};
