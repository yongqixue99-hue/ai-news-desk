import { createHash } from "node:crypto";
import { load } from "cheerio";
import type { StoryView } from "./product-types.js";
import type { SourceImage } from "./types.js";

interface CommonsMetadataValue {
  value?: string;
}

interface CommonsImageInfo {
  width?: number;
  height?: number;
  url?: string;
  thumburl?: string;
  thumbwidth?: number;
  thumbheight?: number;
  descriptionurl?: string;
  mime?: string;
  extmetadata?: Record<string, CommonsMetadataValue>;
}

interface CommonsPage {
  pageid?: number;
  index?: number;
  title?: string;
  imageinfo?: CommonsImageInfo[];
}

interface CommonsSearchResponse {
  query?: { pages?: CommonsPage[] };
}

export interface OnlineImageSearchOptions {
  fetcher?: typeof fetch;
  priority?: 3 | 4;
}

export type EditorialImageSearchStory = Pick<StoryView, "id" | "title" | "originalTitle" | "summary">;

const plainText = (value: string | undefined) => {
  if (!value?.trim()) return "";
  const $ = load(`<body>${value}</body>`);
  return $("body").text().replace(/\s+/gu, " ").trim();
};

const normalizedKey = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const genericIdentityTerms = new Set([
  "ai", "nobel", "the", "a", "an", "new", "ceo", "chief", "company", "researcher",
  "人工智能", "诺贝尔", "诺贝尔奖", "得主", "公司", "集团", "负责人", "创始人", "首席执行官",
]);

const knownEntityPattern = /\b(?:Sony\s+Music|OpenAI|Anthropic|Google\s+DeepMind|DeepMind|Microsoft|NVIDIA|Meta|Apple|Amazon|xAI|Tesla|GitHub|Hugging\s+Face)\b|(?:索尼音乐|索尼|微软|英伟达|谷歌|苹果|亚马逊|腾讯|阿里巴巴|字节跳动|华为|小米|百度|智谱|月之暗面|深度求索)/giu;

const canonicalEntityAliases: Array<[RegExp, string]> = [
  [/索尼\s*(?:music|音乐)/iu, "Sony Music"],
  [/微软/u, "Microsoft"],
  [/英伟达/u, "NVIDIA"],
  [/谷歌\s*deepmind|谷歌深度思维/iu, "Google DeepMind"],
  [/谷歌/u, "Google"],
  [/苹果公司|苹果/u, "Apple Inc."],
  [/亚马逊/u, "Amazon"],
  [/腾讯/u, "Tencent"],
  [/阿里巴巴/u, "Alibaba"],
  [/字节跳动/u, "ByteDance"],
  [/华为/u, "Huawei"],
  [/小米/u, "Xiaomi"],
  [/百度/u, "Baidu"],
  [/深度求索/u, "DeepSeek"],
];

const canonicalKnownEntity = (value: string) => ({
  apple: "Apple Inc.",
  meta: "Meta Platforms",
  amazon: "Amazon.com",
  facebook: "Meta Platforms",
}[normalizedKey(value)] ?? value);

const englishRoleNames = (value: string) => [
  ...value.matchAll(
    /(?:Nobel\s+laureate|CEO|chief\s+executive|founder|co-founder|scientist|researcher|诺贝尔奖得主|科学家|研究员|创始人|负责人|首席执行官)[：:\s]+([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})/giu,
  ),
  ...value.matchAll(
    /\b([A-Z][A-Za-z'’.-]+(?:\s+[A-Z][A-Za-z'’.-]+){1,3})\s*,?\s+(?:CEO|chief\s+executive|founder|co-founder|scientist|researcher)\b/giu,
  ),
].map((match) => match[1]!.trim());

const chineseRoleNames = (value: string) => [...value.matchAll(
  /(?:诺贝尔奖得主|科学家|研究员|创始人|负责人|首席执行官|CEO)[：:\s]*([\p{Script=Han}·]{2,8})/giu,
)].map((match) => match[1]!.trim());

const identityQueriesForStory = (story: EditorialImageSearchStory) => {
  const text = [story.originalTitle, story.title, story.summary].filter(Boolean).join("\n");
  const canonicalAliases = canonicalEntityAliases.flatMap(([pattern, canonical]) =>
    pattern.test(text) ? [canonical] : []);
  const entities = [
    ...canonicalAliases,
    ...(text.match(knownEntityPattern) ?? []).map(canonicalKnownEntity),
    ...englishRoleNames(text),
    ...chineseRoleNames(text),
  ];
  const seen = new Set<string>();
  return entities
    .map((value) => value.replace(/\s+/gu, " ").trim())
    .filter((value) => {
      const key = normalizedKey(value);
      if (!key || genericIdentityTerms.has(key) || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => right.split(/\s+/u).length - left.split(/\s+/u).length || right.length - left.length)
    .slice(0, 3);
};

interface NormalizedLicense {
  id: string;
  url: string;
}

const normalizedLicense = (
  rawName: string,
  rawUrl: string,
  sourceUrl: string,
): NormalizedLicense | undefined => {
  const name = rawName.normalize("NFKC").trim();
  if (/public domain/iu.test(name)) return { id: "PUBLIC-DOMAIN", url: sourceUrl };
  if (/\bcc0\b/iu.test(name)) {
    return { id: "CC0-1.0", url: rawUrl || "https://creativecommons.org/publicdomain/zero/1.0/" };
  }
  const match = name.match(/\bcc\s+by(-sa)?\s+(\d+(?:\.\d+)?)/iu);
  if (!match) return undefined;
  const shareAlike = Boolean(match[1]);
  const version = match[2]!;
  return {
    id: `CC-BY${shareAlike ? "-SA" : ""}-${version}`,
    url: rawUrl || `https://creativecommons.org/licenses/by${shareAlike ? "-sa" : ""}/${version}/`,
  };
};

const commonsEndpointFor = (query: string, limit: number) => {
  const endpoint = new URL("https://commons.wikimedia.org/w/api.php");
  endpoint.searchParams.set("action", "query");
  endpoint.searchParams.set("format", "json");
  endpoint.searchParams.set("formatversion", "2");
  endpoint.searchParams.set("generator", "search");
  endpoint.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
  endpoint.searchParams.set("gsrnamespace", "6");
  endpoint.searchParams.set("gsrlimit", String(Math.max(4, Math.min(12, limit * 4))));
  endpoint.searchParams.set("prop", "imageinfo");
  endpoint.searchParams.set("iiprop", "url|size|mime|extmetadata");
  endpoint.searchParams.set("iiurlwidth", "1600");
  endpoint.searchParams.set("origin", "*");
  return endpoint;
};

const sourceImageFor = (
  page: CommonsPage,
  priority: 3 | 4,
  query: string,
): SourceImage | undefined => {
  const info = page.imageinfo?.[0];
  const metadata = info?.extmetadata ?? {};
  const sourceUrl = info?.descriptionurl?.trim() || "";
  const remoteUrl = info?.thumburl?.trim() || info?.url?.trim() || "";
  if (!info || !sourceUrl || !remoteUrl || !/^image\//iu.test(info.mime || "")) return undefined;
  if (priority === 3) {
    const identityKey = normalizedKey(query);
    const identityText = normalizedKey([
      page.title || "",
      plainText(metadata.ImageDescription?.value),
      plainText(metadata.Categories?.value),
    ].join(" "));
    if (identityKey && !identityText.includes(identityKey)) return undefined;
  }
  const license = normalizedLicense(
    plainText(metadata.LicenseShortName?.value),
    plainText(metadata.LicenseUrl?.value),
    sourceUrl,
  );
  if (!license) return undefined;
  const restrictions = plainText(metadata.Restrictions?.value);
  const attribution = plainText(metadata.Artist?.value)
    || plainText(metadata.Credit?.value)
    || "Wikimedia Commons contributor";
  const fallbackCaption = (page.title || "Wikimedia Commons image")
    .replace(/^File:/iu, "")
    .replace(/\.[a-z0-9]{2,5}$/iu, "")
    .trim();
  const caption = plainText(metadata.ImageDescription?.value).slice(0, 220) || fallbackCaption;
  const brandIdentifier = /\b(?:logos?|logotype|brand\s+mark|trademark)\b|徽标|标志|品牌标识/iu.test(
    `${page.title || ""} ${caption} ${plainText(metadata.Categories?.value)}`,
  );
  const trademarked = /trademark/iu.test(restrictions) || brandIdentifier;
  const evidence = [
    `Wikimedia Commons 文件页标注 ${plainText(metadata.LicenseShortName?.value)}。`,
    trademarked ? "该素材含商标限制，发布前必须人工复核使用场景，不得暗示品牌背书。" : "许可元数据已记录，发布时必须保留署名与许可链接。",
  ].join("");
  return {
    id: `commons_${page.pageid ?? createHash("sha1").update(sourceUrl).digest("hex").slice(0, 12)}`,
    url: remoteUrl,
    caption,
    attribution: `${attribution} / Wikimedia Commons`,
    sourceUrl,
    width: info.thumbwidth || info.width,
    height: info.thumbheight || info.height,
    selected: true,
    rights: trademarked ? "check-required" : "licensed",
    evidenceNote: evidence,
    licenseId: license.id,
    licenseUrl: license.url,
    modificationNote: "在线检索并缓存，尚未进行内容性修改。",
    allowedPlatforms: trademarked ? [] : ["wechat", "xiaoheihe"],
    entityTags: priority === 3 ? [query] : [],
    editorialPriority: priority,
    editorialOrigin: priority === 3 ? "entity-library" : "related-library",
  };
};

const fetchCommons = async (
  query: string,
  priority: 3 | 4,
  limit: number,
  fetcher: typeof fetch,
) => {
  const response = await fetcher(commonsEndpointFor(query, limit), {
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "AI-News-Desk/0.1 (licensed editorial image lookup)" },
  });
  if (!response.ok) throw new Error(`Wikimedia Commons 图片检索失败：HTTP ${response.status}`);
  const payload = await response.json() as CommonsSearchResponse;
  const seen = new Set<string>();
  return (payload.query?.pages ?? [])
    .sort((left, right) => (left.index ?? Number.MAX_SAFE_INTEGER) - (right.index ?? Number.MAX_SAFE_INTEGER)
      || Number(left.pageid ?? 0) - Number(right.pageid ?? 0))
    .flatMap((page) => {
      const image = sourceImageFor(page, priority, query);
      if (!image || seen.has(image.url)) return [];
      seen.add(image.url);
      return [image];
    })
    .slice(0, limit);
};

/**
 * Searches a rights-auditable public image source. Entity/person queries are
 * exhausted before a broader event query, preserving the editorial 3 > 4
 * order without treating arbitrary web thumbnails as reusable assets.
 */
export const searchLicensedEditorialImages = async (
  story: EditorialImageSearchStory,
  requestedLimit = 2,
  options: OnlineImageSearchOptions = {},
): Promise<SourceImage[]> => {
  const limit = Math.max(0, Math.min(4, Math.floor(requestedLimit)));
  if (!limit) return [];
  const fetcher = options.fetcher ?? fetch;
  if (options.priority !== 4) {
    for (const query of identityQueriesForStory(story)) {
      const images = await fetchCommons(query, 3, limit, fetcher).catch(() => []);
      if (images.length) return images;
    }
  }
  if (options.priority === 3) return [];
  const relatedQueries = [...new Set([story.originalTitle, story.title]
    .map((value) => value?.replace(/\s+/gu, " ").trim())
    .filter((value): value is string => Boolean(value)))]
    .slice(0, 2);
  for (const query of relatedQueries) {
    const images = await fetchCommons(query, 4, limit, fetcher).catch(() => []);
    if (images.length) return images;
  }
  return [];
};
