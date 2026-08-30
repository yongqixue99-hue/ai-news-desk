import { isNeutralImagePublishReady } from "./image-readiness.js";
import type { StoryView } from "./product-types.js";
import type { ImageMaterial, SourceImage } from "./types.js";

const genericTags = new Set([
  "ai",
  "人工智能",
  "科技",
  "通用",
  "万能素材",
  "示意图",
  "资料图",
  "大模型",
]);

const normalized = (value: string) => value
  .normalize("NFKC")
  .toLocaleLowerCase()
  .replace(/[^\p{L}\p{N}]+/gu, " ")
  .replace(/\s+/gu, " ")
  .trim();

const storySearchText = (story: StoryView) => normalized([
  story.title,
  story.originalTitle,
  story.summary,
  story.whyImportant,
  ...story.topicIds,
  ...story.communityFocus,
  ...story.signals.flatMap((signal) => [
    signal.title,
    signal.titleZh || "",
    signal.summaryZh || "",
    signal.sourceName,
    signal.author || "",
  ]),
].join(" "));

const containsTerm = (haystack: string, rawNeedle: string) => {
  const needle = normalized(rawNeedle);
  if (!needle) return false;
  if (needle.length <= 2 && /^[a-z0-9]+$/u.test(needle)) {
    return new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?:$|\\s)`, "u").test(haystack);
  }
  return haystack.includes(needle);
};

/**
 * Automatic fallbacks are intentionally stricter than manually insertable
 * materials. Official press images remain visible in the library, but an
 * "official" label alone is not permission to redistribute the file.
 */
export const canAutomaticallyInsertMaterial = (
  material: ImageMaterial,
  now = new Date().toISOString(),
) => isNeutralImagePublishReady(material, now);

const organizationNamePattern = /(?:\b(?:openai|anthropic|google|deepmind|meta|facebook|apple|microsoft|nvidia|amazon|xai|tesla|github|hugging\s*face)\b|(?:公司|集团|大学|学院|实验室|研究院|研究所|团队|基金会|工作室|研究中心)$|^(?:百度|腾讯|阿里|字节跳动|华为|小米|商汤|智谱|月之暗面|深度求索)$)/iu;

const explicitPersonName = (value: string) => {
  const match = value.trim().match(/^(?:person|人物|人物姓名|姓名)\s*[:：]\s*(.+)$/iu);
  return match?.[1]?.trim();
};

const looksLikePersonName = (value: string) => {
  const candidate = value.trim();
  if (!candidate || organizationNamePattern.test(candidate)) return false;
  if (/^[\p{Script=Han}·]{2,6}$/u.test(candidate)) return true;
  const words = candidate.split(/[\s·]+/u).filter(Boolean);
  return words.length >= 2
    && words.length <= 5
    && words.every((word) => /^[\p{L}][\p{L}.'’-]*$/u.test(word));
};

const personNamesForMaterial = (material: ImageMaterial) => {
  const titleText = normalized(material.title);
  return [...new Set(material.entityTags.flatMap((tag) => {
    const explicit = explicitPersonName(tag);
    if (explicit) return [explicit];
    return looksLikePersonName(tag) && containsTerm(titleText, tag) ? [tag] : [];
  }))];
};

interface RankedMaterial {
  material: ImageMaterial;
  score: number;
  generic: boolean;
}

const rankMaterialForStory = (
  material: ImageMaterial,
  storyText: string,
): RankedMaterial | undefined => {
  const isPerson = material.tags.some((tag) => /^(?:人物|AI人物|科技人物)$/iu.test(tag.trim()));
  if (isPerson) {
    // A company mention alone must never pull in an old CEO portrait. The
    // person's own name has to occur in the Story; company tags remain useful
    // for manual search in the material library only.
    const personNames = personNamesForMaterial(material);
    const matchedNames = personNames.filter((name) => containsTerm(storyText, name));
    if (!matchedNames.length) return undefined;
    return {
      material,
      score: matchedNames.length * 30,
      generic: false,
    };
  }
  const entityMatches = material.entityTags.filter((tag) => containsTerm(storyText, tag));
  const specificTagMatches = material.tags.filter((tag) =>
    !genericTags.has(normalized(tag)) && containsTerm(storyText, tag));
  const isGeneric = material.tags.some((tag) => genericTags.has(normalized(tag)));
  if (!entityMatches.length && !specificTagMatches.length && !isGeneric) return undefined;
  return {
    material,
    score: entityMatches.length * 20 + specificTagMatches.length * 6 + (isGeneric ? 1 : 0),
    generic: isGeneric && !entityMatches.length && !specificTagMatches.length,
  };
};

export const sourceImageFromRecommendedMaterial = (
  ranked: RankedMaterial,
): SourceImage => ({
  id: `library:${ranked.material.id}`,
  url: ranked.material.publicPath,
  localPath: ranked.material.localPath,
  publicPath: ranked.material.publicPath,
  caption: ranked.generic
    ? `示意图：${ranked.material.title}（非事件现场）`
    : `资料图：${ranked.material.title}`,
  attribution: ranked.material.attribution,
  sourceUrl: ranked.material.sourceUrl || "material-library",
  selected: true,
  rights: ranked.material.rights,
  evidenceNote: ranked.material.evidenceNote,
  evidencePath: ranked.material.evidencePath,
  licenseId: ranked.material.licenseId,
  licenseUrl: ranked.material.licenseUrl,
  modificationNote: ranked.material.modificationNote,
  allowedPlatforms: [...ranked.material.allowedPlatforms],
  expiresAt: ranked.material.expiresAt,
  entityTags: [...ranked.material.entityTags],
  fingerprint: ranked.material.fingerprint,
});

export const recommendMaterialFallbacks = (
  materials: readonly ImageMaterial[],
  story: StoryView,
  limit = 2,
  now = new Date().toISOString(),
) => {
  const storyText = storySearchText(story);
  const seenFingerprints = new Set<string>();
  return materials
    .filter((material) => canAutomaticallyInsertMaterial(material, now))
    .flatMap((material) => {
      const ranked = rankMaterialForStory(material, storyText);
      if (!ranked || seenFingerprints.has(material.fingerprint)) return [];
      seenFingerprints.add(material.fingerprint);
      return [ranked];
    })
    .sort((left, right) => right.score - left.score
      || Number(left.generic) - Number(right.generic)
      || right.material.createdAt.localeCompare(left.material.createdAt)
      || left.material.id.localeCompare(right.material.id))
    .slice(0, Math.max(0, Math.min(6, Math.floor(limit))))
    .map(sourceImageFromRecommendedMaterial);
};
