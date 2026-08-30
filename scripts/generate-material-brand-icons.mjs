import { mkdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import {
  siAnthropic,
  siApple,
  siDeepmind,
  siGooglegemini,
  siMeta,
  siNvidia,
  siX,
} from "simple-icons";

const outputDirectory = path.resolve("assets", "material-library", "brands");

const icons = [
  siAnthropic,
  siApple,
  siDeepmind,
  siGooglegemini,
  siMeta,
  siNvidia,
  siX,
];

const cardSvg = (icon) => `
  <svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
    <rect width="1024" height="1024" rx="112" fill="#F6F2EA" />
    <rect x="72" y="72" width="880" height="880" rx="80" fill="#FFFFFF" stroke="#DDD7CD" stroke-width="4" />
    <g transform="translate(272 272) scale(20)">
      <path d="${icon.path}" fill="#${icon.hex}" />
    </g>
  </svg>
`;

await mkdir(outputDirectory, { recursive: true });

for (const icon of icons) {
  const outputPath = path.join(outputDirectory, `${icon.slug}-mark.png`);
  await sharp(Buffer.from(cardSvg(icon)))
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outputPath);
  process.stdout.write(`${path.relative(process.cwd(), outputPath)}\n`);
}
