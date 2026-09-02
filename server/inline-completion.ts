import type { ContentPackage } from "./product-types.js";
import { protectedFactAnchors } from "./writing-quality.js";

export interface InlineCompletionPromptInput {
  contentPackage: ContentPackage;
  title: string;
  before: string;
  after?: string;
}

export interface InlineCompletionResult {
  available: boolean;
  text?: string;
  reason?: string;
}

/** Only repaint streamed UI after a clause or sentence has settled. */
export const isStableInlineCompletionPreview = (value: string) => {
  const text = value.trim();
  if (/[。！？.!?][”’"）】]?$/u.test(text)) return true;
  return [...text].length >= 8 && /[，；：,;:][”’"）】]?$/u.test(text);
};

const bounded = (value: string, limit: number, fromEnd = false) => {
  const normalized = value.replace(/\u0000/gu, "").trim();
  if (normalized.length <= limit) return normalized;
  return fromEnd ? normalized.slice(-limit) : normalized.slice(0, limit);
};

const supportedEvidence = (contentPackage: ContentPackage) => {
  const facts = contentPackage.facts
    .filter((fact) => fact.status === "supported")
    .map((fact) => `[${fact.id}] ${fact.text}`);
  const sourceMaterial = contentPackage.intent === "source"
    ? (contentPackage.sourceMaterials ?? []).map((material) =>
        `[来源材料：${material.sourceLabel}] ${bounded(material.originalText, 6_000)}`)
    : [];
  return [...facts, ...sourceMaterial];
};

const allowedEvidenceText = (contentPackage: ContentPackage) => [
  contentPackage.title,
  ...supportedEvidence(contentPackage),
  ...contentPackage.sources.map((source) => source.label),
].join("\n");

export const buildInlineCompletionPrompt = ({
  contentPackage,
  title,
  before,
  after = "",
}: InlineCompletionPromptInput) => {
  const evidence = supportedEvidence(contentPackage);
  const beforeContext = bounded(before, 2_400, true);
  const beforeParagraphs = beforeContext.split(/\n+/u).map((paragraph) => paragraph.trim()).filter(Boolean);
  const currentParagraph = beforeParagraphs.at(-1) ?? beforeContext;
  const previousParagraph = beforeParagraphs.at(-2) ?? "";
  const compactBefore = beforeContext.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN");
  const uncoveredFacts = contentPackage.facts
    .filter((fact) => fact.status === "supported")
    .filter((fact) => !compactBefore.includes(
      fact.text.normalize("NFKC").replace(/\s+/gu, "").toLocaleLowerCase("zh-CN"),
    ))
    .map((fact) => `[${fact.id}] ${fact.text}`)
    .slice(0, 12);
  return {
    system: [
      "你是中文新闻编辑器里的行内补全助手。",
      "只能使用素材包中明确列出的事实或来源材料，不得调用常识补背景，不得创造数字、实体、引语、因果或结论。",
      "未知项只能保持未知，不能替用户补答案。",
      "可以续写一段或预测紧接着的下一段；最多两段，每段只写一句自然中文，段间用一个空行分隔。",
      "当前句未闭合时只补完这一句；当前段已完整时，只有尚未覆盖的事实能服务于文章路由和自然承接，才建议下一段。",
      "不要标题、列表、Markdown、解释或前缀，总计最多 220 个汉字，不要重复光标前后已有正文。",
      "如果证据不足以自然续写，返回空字符串。",
    ].join("\n"),
    user: [
      `【文章标题】${bounded(title, 180)}`,
      `【写作路由】${contentPackage.mode}`,
      "【可用素材】",
      ...(evidence.length ? evidence : ["（没有可用于补全的已支持事实）"]),
      "【尚未覆盖的事实】",
      ...(uncoveredFacts.length ? uncoveredFacts : ["（当前没有明确未覆盖事实，不要为了凑段落而续写）"]),
      "【不可补写的未知项】",
      ...(contentPackage.uncertainties.length ? contentPackage.uncertainties : ["（无）"]),
      "【写作角度，仅用于组织表达，不视为事实】",
      ...(contentPackage.suggestedAngles.length ? contentPackage.suggestedAngles : ["（无）"]),
      `【上一段】${bounded(previousParagraph, 800) || "（无）"}`,
      `【当前段光标前】${bounded(currentParagraph, 1_200, true)}`,
      `【光标后】${bounded(after, 500) || "（空）"}`,
      "【续写】",
    ].join("\n"),
  };
};

const normalizeAnchor = (value: string) => value
  .normalize("NFKC")
  .replace(/\s+/gu, "")
  .toLocaleLowerCase("zh-CN");

const multiWordLatinAnchors = (value: string) =>
  value.match(/\b[A-Z][A-Za-z0-9]*(?:\s+[A-Z][A-Za-z0-9]*)+\b/gu) ?? [];

const completionAnchors = (value: string) => [
  ...protectedFactAnchors(value),
  ...multiWordLatinAnchors(value),
];

const completionParagraphs = (value: string) => {
  const unwrapped = value
    .replace(/^```(?:text|markdown)?\s*/iu, "")
    .replace(/\s*```$/u, "")
    .replace(/^(?:续写|建议|补全)[：:]\s*/u, "")
    .trim();
  const paragraphs = unwrapped.split(/\r?\n\s*\r?\n+/u).flatMap((paragraph) => {
    const compact = paragraph
      .replace(/^\s*(?:[-*+]\s+|#{1,6}\s+)/u, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (!compact) return [];
    const sentence = compact.match(/^[\s\S]*?[。！？!?](?:[”’"）】])?/u)?.[0] ?? compact;
    const boundedSentence = [...sentence.trim()].slice(0, 120).join("");
    return boundedSentence ? [boundedSentence] : [];
  });
  const accepted: string[] = [];
  let characters = 0;
  for (const paragraph of paragraphs.slice(0, 2)) {
    const remaining = 220 - characters;
    if (remaining <= 0) break;
    const boundedParagraph = [...paragraph].slice(0, remaining).join("").trim();
    if (!boundedParagraph) continue;
    accepted.push(boundedParagraph);
    characters += [...boundedParagraph].length;
  }
  return accepted;
};

export const prepareInlineCompletion = ({
  raw,
  contentPackage,
  before = "",
  after = "",
}: {
  raw: string;
  contentPackage: ContentPackage;
  before?: string;
  after?: string;
}): InlineCompletionResult => {
  const paragraphs = completionParagraphs(raw);
  const text = paragraphs.join("\n\n");
  if (!text) return { available: false, reason: "模型没有返回可用建议" };
  const surrounding = [normalizeAnchor(before), normalizeAnchor(after)];
  const repeated = paragraphs.some((paragraph) => {
    const fingerprint = normalizeAnchor(paragraph);
    return fingerprint.length >= 8 && surrounding.some((part) => part.includes(fingerprint));
  });
  if (repeated) return { available: false, reason: "模型建议与现有正文重复" };
  const allowed = normalizeAnchor(allowedEvidenceText(contentPackage));
  const unsupported = completionAnchors(text)
    .filter((anchor) => !allowed.includes(normalizeAnchor(anchor)));
  if (unsupported.length) {
    return { available: false, reason: "模型建议包含素材包外的新数字或实体" };
  }
  return { available: true, text };
};
