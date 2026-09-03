import { buildLinkEvidenceBundle, type EvidenceBundle } from "./intake-review.js";
import { load } from "cheerio";

export interface ManualXPostInput {
  url: string;
  text?: string;
  author?: string;
  title?: string;
}

export interface NormalizedManualXPostInput {
  url: string;
  text: string;
  author: string;
  title: string;
  acquisition: "manual-copy" | "official-oembed";
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

const normalizeXPostUrl = (value: string) => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("请输入有效的 X 原帖链接");
  }
  if (parsed.protocol !== "https:" || !xHosts.has(parsed.hostname.toLowerCase())) {
    throw new Error("请输入有效的 X 原帖链接（x.com 或 twitter.com）");
  }
  const match = parsed.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)/u);
  if (!match) throw new Error("X 链接必须包含 /status/ 和帖子编号");

  return {
    url: `https://x.com/${match[1]}/status/${match[2]}`,
    handle: match[1],
  };
};

export const normalizeManualXPostInput = (input: ManualXPostInput): NormalizedManualXPostInput => {
  const normalizedUrl = normalizeXPostUrl(input.url);

  const text = (input.text || "").replace(/\r\n?/gu, "\n").trim();
  if (text.length < 10) throw new Error("请粘贴至少 10 个字符的 X 原帖正文");
  if (text.length > 12_000) throw new Error("X 原帖正文不能超过 12000 个字符");

  const suppliedAuthor = compactLine(input.author).replace(/^@+/u, "");
  const author = `@${suppliedAuthor || normalizedUrl.handle}`;
  const title = compactLine(input.title) || `${author}：${clipped(compactLine(text), 80)}`;

  return {
    url: normalizedUrl.url,
    text,
    author,
    title,
    acquisition: "manual-copy",
  };
};

type XPostFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export const resolveXPostInput = async (
  input: ManualXPostInput,
  fetcher: XPostFetch = fetch,
): Promise<NormalizedManualXPostInput> => {
  if ((input.text || "").trim().length >= 10) return normalizeManualXPostInput(input);

  const normalizedUrl = normalizeXPostUrl(input.url);
  const endpoint = new URL("https://publish.x.com/oembed");
  endpoint.searchParams.set("url", normalizedUrl.url);
  endpoint.searchParams.set("omit_script", "true");
  endpoint.searchParams.set("dnt", "true");
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error("X 官方 oEmbed 读取超时；请重试或手工粘贴正文");
    }
    throw new Error("暂时无法连接 X 官方 oEmbed；请重试或手工粘贴正文");
  }
  if (!response.ok) {
    throw new Error(`X 官方 oEmbed 暂时无法读取这条原帖（HTTP ${response.status}）；请手工粘贴正文`);
  }
  const payload = await response.json().catch(() => ({})) as { html?: unknown };
  const html = typeof payload.html === "string" ? payload.html : "";
  const $ = load(html);
  const paragraph = $("blockquote p").first();
  paragraph.find("br").replaceWith("\n");
  const text = paragraph.text().replace(/\r\n?/gu, "\n").trim();
  if (text.length < 10) throw new Error("X 官方 oEmbed 没有返回完整正文；请手工粘贴原帖内容");

  return {
    ...normalizeManualXPostInput({ ...input, url: normalizedUrl.url, text }),
    acquisition: "official-oembed",
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
      input.acquisition === "official-oembed"
        ? "正文来自 X 官方 oEmbed；请核对账号身份、原帖链接和上下文，媒体原图需另行补充。"
        : "正文由用户复制粘贴；请核对账号身份、原帖链接和上下文后再作为事实使用。",
    ],
  };
};
