import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { SourceImage } from "./types.js";

export interface GroundedEditorialCoverInput {
  source: SourceImage;
  storyTitle: string;
  assetDirectory: string;
  publicDirectory: string;
}

export interface GeneratedEditorialFallbackInput {
  storyId: string;
  storyTitle: string;
  sourceUrl: string;
  assetDirectory: string;
  publicDirectory: string;
}

const escapeXml = (value: string) => value
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&apos;");

const titleLines = (value: string) => {
  const title = value.replace(/\s+/gu, " ").trim().slice(0, 72) || "待核验议题";
  if (title.length <= 22) return [title];
  const midpoint = Math.min(28, Math.max(14, Math.round(title.length / 2)));
  const left = title.lastIndexOf(" ", midpoint);
  const splitAt = left >= 10 ? left : midpoint;
  return [title.slice(0, splitAt).trim(), title.slice(splitAt).trim()].filter(Boolean);
};

const sideTitleLines = (value: string) => {
  const title = value.replace(/\s+/gu, " ").trim().slice(0, 48);
  const lines: string[] = [];
  let remaining = title;
  while (remaining && lines.length < 3) {
    if (remaining.length <= 15) {
      lines.push(remaining);
      break;
    }
    const space = remaining.lastIndexOf(" ", 15);
    const splitAt = space >= 7 ? space : 14;
    lines.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  return lines;
};

const backgroundSvg = (logoLayout: boolean, storyTitle: string) => {
  const storyTitleMarkup = logoLayout ? "" : sideTitleLines(storyTitle)
    .map((line, index) => `<text x="950" y="${355 + index * 62}" fill="#f4eddf" font-size="42" font-weight="650" font-family="Microsoft YaHei, Noto Sans CJK SC, Segoe UI, sans-serif">${escapeXml(line)}</text>`)
    .join("");
  return Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <defs>
      <linearGradient id="night" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#050a10"/>
        <stop offset="0.58" stop-color="#091522"/>
        <stop offset="1" stop-color="#10100f"/>
      </linearGradient>
      <radialGradient id="blue" cx="0.18" cy="0.72" r="0.7">
        <stop offset="0" stop-color="#0f4d73" stop-opacity="0.38"/>
        <stop offset="1" stop-color="#0f4d73" stop-opacity="0"/>
      </radialGradient>
      <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
        <path d="M52 0H0V52" fill="none" stroke="#8ebbd1" stroke-opacity="0.07" stroke-width="1"/>
      </pattern>
      <filter id="glow"><feGaussianBlur stdDeviation="7"/></filter>
    </defs>
    <rect width="1600" height="900" fill="url(#night)"/>
    <rect width="1600" height="900" fill="url(#blue)"/>
    <rect width="1600" height="900" fill="url(#grid)"/>
    <path d="M1010 0H1600V420L1300 292Z" fill="#a87830" fill-opacity="0.08"/>
    <path d="M1170 0L1600 0 1600 610" fill="none" stroke="#c9a966" stroke-opacity="0.34" stroke-width="2"/>
    <path d="M1120 74H1510M1190 126H1545M1260 178H1580" stroke="#c9a966" stroke-opacity="0.16" stroke-width="2"/>
    <circle cx="1450" cy="735" r="150" fill="none" stroke="#c9a966" stroke-opacity="0.18" stroke-width="2"/>
    <circle cx="1450" cy="735" r="104" fill="none" stroke="#4e93bd" stroke-opacity="0.18" stroke-width="1"/>
    <rect x="${logoLayout ? 146 : 54}" y="${logoLayout ? 176 : 26}" width="${logoLayout ? 1308 : 848}" height="${logoLayout ? 548 : 848}" rx="${logoLayout ? 18 : 8}" fill="none" stroke="#c9a966" stroke-opacity="0.72" stroke-width="2"/>
    <rect x="80" y="804" width="130" height="7" fill="#c8483a"/>
    <rect x="220" y="804" width="310" height="1" fill="#c9a966" fill-opacity="0.62"/>
    ${storyTitleMarkup}
    <text x="${logoLayout ? 180 : 950}" y="${logoLayout ? 126 : 660}" fill="#c9a966" fill-opacity="0.9" font-size="21" font-family="Segoe UI, Arial, sans-serif" letter-spacing="7">EDITORIAL IDENTITY</text>
    <text x="${logoLayout ? 180 : 950}" y="${logoLayout ? 156 : 696}" fill="#f4eddf" fill-opacity="0.58" font-size="15" font-family="Segoe UI, Arial, sans-serif" letter-spacing="3">SOURCE-GROUNDED / NOT SYNTHETIC</text>
  </svg>
`);
};

const logoLike = (source: SourceImage, width: number, height: number) =>
  /\b(?:logo|mark|icon)\b|标志|徽标|图标/iu.test(`${source.caption} ${source.url}`)
  || width / Math.max(1, height) >= 2.2;

/**
 * Builds the generated part around a real, traceable identity image. Source
 * pixels are resized and composited but never face-swapped, repainted or
 * synthesized, so a named person remains the person in the licensed source.
 */
export const createGroundedEditorialCover = async ({
  source,
  storyTitle,
  assetDirectory,
  publicDirectory,
}: GroundedEditorialCoverInput): Promise<SourceImage> => {
  if (!source.localPath?.trim()) throw new Error("身份素材尚未下载到本地，不能建立编辑封面");
  const metadata = await sharp(source.localPath).metadata();
  const width = metadata.width || source.width || 1;
  const height = metadata.height || source.height || 1;
  const isLogo = logoLike(source, width, height);
  const sourcePanel = await sharp(source.localPath)
    .rotate()
    .resize(isLogo
      ? { width: 1060, height: 390, fit: "contain", background: { r: 244, g: 237, b: 223, alpha: 0 } }
      : { width: 800, height: 820, fit: "contain", position: "centre", background: { r: 5, g: 10, b: 16, alpha: 0 } })
    .png()
    .toBuffer();
  const identity = createHash("sha256")
    .update(`${source.id}:${source.fingerprint || source.url}:${storyTitle}`)
    .digest("hex");
  const id = `editorial_identity_${identity.slice(0, 16)}`;
  const fileName = `${id}.png`;
  await mkdir(assetDirectory, { recursive: true });
  const localPath = path.join(assetDirectory, fileName);
  const composites = isLogo
    ? [
        {
          input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1220" height="430"><rect width="1220" height="430" rx="14" fill="#f4eddf"/><rect x="1" y="1" width="1218" height="428" rx="13" fill="none" stroke="#c9a966" stroke-width="2"/></svg>`),
          left: 190,
          top: 235,
        },
        { input: sourcePanel, left: 270, top: 255 },
      ]
    : [
        { input: sourcePanel, left: 78, top: 40 },
        {
          input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="820" height="840"><rect x="1" y="1" width="818" height="838" rx="7" fill="none" stroke="#c9a966" stroke-opacity="0.75" stroke-width="2"/></svg>`),
          left: 68,
          top: 30,
        },
      ];
  await sharp(backgroundSvg(isLogo, storyTitle))
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(localPath);
  const bytes = await readFile(localPath);
  const publicPath = `${publicDirectory.replace(/\/+$/u, "")}/${encodeURIComponent(fileName)}`;
  return {
    ...source,
    id,
    url: publicPath,
    localPath,
    publicPath,
    caption: `资料封面：${source.caption}（人物或标识保持来源原貌）`,
    width: 1600,
    height: 900,
    selected: true,
    evidenceNote: `${source.evidenceNote ? `${source.evidenceNote} ` : ""}人物或品牌主体来自已记录来源；系统只生成背景、边框与编辑版式。`,
    evidencePath: localPath,
    modificationNote: "人物或品牌主体未由 AI 重绘；仅缩放，并与系统生成的暗色编辑背景、边框和版式合成。",
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
  };
};

/**
 * Creates a story-specific visual only when every real-image tier is empty.
 * It contains no synthetic person, company mark or simulated news scene and
 * labels itself as a non-documentary illustration in its governance record.
 */
export const createGeneratedEditorialFallback = async ({
  storyId,
  storyTitle,
  sourceUrl,
  assetDirectory,
  publicDirectory,
}: GeneratedEditorialFallbackInput): Promise<SourceImage> => {
  const identity = createHash("sha256").update(`${storyId}:${storyTitle}:${sourceUrl}`).digest("hex");
  const id = `generated_editorial_${identity.slice(0, 16)}`;
  const fileName = `${id}.png`;
  const lines = titleLines(storyTitle);
  const titleMarkup = lines.map((line, index) =>
    `<text x="132" y="${430 + index * 100}" fill="#f4eddf" font-size="${lines.length === 1 ? 72 : 64}" font-weight="650" font-family="Microsoft YaHei, Noto Sans CJK SC, Segoe UI, sans-serif">${escapeXml(line)}</text>`)
    .join("");
  const accentOffset = Number.parseInt(identity.slice(0, 4), 16) % 180;
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
      <defs>
        <linearGradient id="night" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#060b12"/>
          <stop offset="0.62" stop-color="#0a1927"/>
          <stop offset="1" stop-color="#16120d"/>
        </linearGradient>
        <radialGradient id="signal" cx="0.82" cy="0.26" r="0.62">
          <stop offset="0" stop-color="#1d6e9d" stop-opacity="0.42"/>
          <stop offset="1" stop-color="#1d6e9d" stop-opacity="0"/>
        </radialGradient>
        <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M48 0H0V48" fill="none" stroke="#c9d7de" stroke-opacity="0.055" stroke-width="1"/>
        </pattern>
      </defs>
      <rect width="1600" height="900" fill="url(#night)"/>
      <rect width="1600" height="900" fill="url(#signal)"/>
      <rect width="1600" height="900" fill="url(#grid)"/>
      <path d="M${880 + accentOffset} 0H1600V590L${1120 + accentOffset} 420Z" fill="#c9a966" fill-opacity="0.09"/>
      <path d="M${1020 + accentOffset} 40L1540 40 1540 520" fill="none" stroke="#c9a966" stroke-opacity="0.5" stroke-width="2"/>
      <circle cx="1325" cy="270" r="186" fill="none" stroke="#c9a966" stroke-opacity="0.24" stroke-width="2"/>
      <circle cx="1325" cy="270" r="128" fill="none" stroke="#4f9bc7" stroke-opacity="0.26" stroke-width="1"/>
      <circle cx="1325" cy="270" r="14" fill="#c8483a"/>
      <path d="M1170 270H1480M1325 115V425" stroke="#f4eddf" stroke-opacity="0.12" stroke-width="1"/>
      <rect x="132" y="290" width="112" height="8" fill="#c8483a"/>
      <text x="132" y="250" fill="#c9a966" font-size="21" font-family="Segoe UI, Arial, sans-serif" letter-spacing="7">EDITORIAL SIGNAL</text>
      ${titleMarkup}
      <path d="M132 690H770" stroke="#c9a966" stroke-opacity="0.55" stroke-width="1"/>
      <text x="132" y="746" fill="#f4eddf" fill-opacity="0.64" font-size="17" font-family="Segoe UI, Arial, sans-serif" letter-spacing="3">GENERATED VISUAL / NOT DOCUMENTARY</text>
      <text x="132" y="790" fill="#f4eddf" fill-opacity="0.38" font-size="15" font-family="Segoe UI, Arial, sans-serif" letter-spacing="2">NO SYNTHETIC PERSON · NO FAKE LOGO · NO SIMULATED SCENE</text>
    </svg>
  `);
  await mkdir(assetDirectory, { recursive: true });
  const localPath = path.join(assetDirectory, fileName);
  await sharp(svg).png({ compressionLevel: 9 }).toFile(localPath);
  const bytes = await readFile(localPath);
  const publicPath = `${publicDirectory.replace(/\/+$/u, "")}/${encodeURIComponent(fileName)}`;
  return {
    id,
    url: publicPath,
    localPath,
    publicPath,
    caption: `系统生成议题封面：${storyTitle}（非事件现场）`,
    attribution: "AI News Desk；系统实时生成编辑示意图",
    sourceUrl,
    width: 1600,
    height: 900,
    selected: true,
    rights: "owned",
    evidenceNote: "仅在原新闻图片、网页截图、身份素材和相关素材均不可用时生成；不包含合成人脸、虚构品牌标识，也不冒充新闻现场。",
    evidencePath: localPath,
    licenseId: "PROJECT-OWNED",
    modificationNote: "由标题生成抽象编辑版式；未使用或改造真实人物肖像。",
    allowedPlatforms: ["*"],
    entityTags: [],
    fingerprint: createHash("sha256").update(bytes).digest("hex"),
    editorialPriority: 5,
    editorialOrigin: "generated-fallback",
  };
};
