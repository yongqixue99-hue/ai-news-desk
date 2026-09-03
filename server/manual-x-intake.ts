import { buildLinkEvidenceBundle, type EvidenceBundle } from "./intake-review.js";

export interface ManualXPostInput {
  url: string;
  text: string;
  author?: string;
  title?: string;
}

export interface NormalizedManualXPostInput {
  url: string;
  text: string;
  author: string;
  title: string;
}

const xHosts = new Set([
  "x.com",
  "www.x.com",
  "mobile.x.com",
  "twitter.com",
  "www.twitter.com",
  "mobile.twitter.com",
]);

const compactLine = (value: string | undefined) => value?.replace(/\s+/gu, " ").trim() || "";

const clipped = (value: string, maxLength: number) =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;

export const normalizeManualXPostInput = (input: ManualXPostInput): NormalizedManualXPostInput => {
  let parsed: URL;
  try {
    parsed = new URL(input.url.trim());
  } catch {
    throw new Error("请输入有效的 X 原帖链接");
  }
  if (parsed.protocol !== "https:" || !xHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("请输入有效的 X 原帖链接（x.com 或 twitter.com）");
  }
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/u);
  if (!match) throw new Error("X 链接必须包含 /status/ 和帖子编号");

  const text = input.text.replace(/\r\n?/gu, "\n").trim();
  if (text.length < 10) throw new Error("请粘贴至少 10 个字符的 X 原帖正文");
  if (text.length > 12_000) throw new Error("X 原帖正文不能超过 12000 个字符");

  const handle = match[1];
  const suppliedAuthor = compactLine(input.author).replace(/^@+/u, "");
  const author = `@${suppliedAuthor || handle}`;
  const title = compactLine(input.title) || `${author}：${clipped(compactLine(text), 80)}`;

  return {
    url: `https://x.com/${handle}/status/${match[2]}`,
    text,
    author,
    title,
  };
};

export const buildManualXPostEvidence = (
  input: NormalizedManualXPostInput,
  capturedAt = new Date().toISOString(),
): EvidenceBundle => {
  const bundle = buildLinkEvidenceBundle({
    sourceUrl: input.url,
    canonicalUrl: input.url,
    title: input.title,
    rawSourceText: input.text,
    extractedText: input.text,
    removedNoise: [],
    images: [],
    capturedAt,
  });
  return {
    ...bundle,
    warnings: [
      ...bundle.warnings,
      "正文由用户复制粘贴；请核对账号身份、原帖链接和上下文后再作为事实使用。",
    ],
  };
};
