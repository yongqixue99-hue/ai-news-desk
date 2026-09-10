import { extractPage } from "./extractor.js";
import { readState } from "./storage.js";
import type { Candidate, DraftSource, ExtractedPage } from "./types.js";
export type CommunityDraftMode = "article" | "source" | "translation" | "curation";

interface CommunityBlock { kind: "heading" | "paragraph" | "quote" | "list-item"; text: string; }
const trimBlocksToEvidenceBudget = (blocks: CommunityBlock[], maximumCharacters = 28_000) => {
  const result: CommunityBlock[] = [];
  let used = 0;
  for (const block of blocks) {
    const text = cleanText(block.text);
    if (!text || used + text.length > maximumCharacters || result.length >= 80) break;
    result.push({ ...block, text });
    used += text.length;
  }
  return result;
};

const fallbackBlocks = (text: string): CommunityBlock[] => {
  const sentences = text
    .split(/(?<=[。！？!?])\s+/u)
    .map((sentence) => cleanText(sentence))
    .filter(Boolean);
  if (!sentences.length) return [];
  const blocks: CommunityBlock[] = [];
  for (let index = 0; index < sentences.length; index += 3) {
    blocks.push({ kind: "paragraph", text: sentences.slice(index, index + 3).join(" ") });
  }
  return blocks;
};

const sourceBlocks = (page: ExtractedPage, candidate: Candidate) => {
  const blocks = (page.blocks || [])
    .map((block) => ({ kind: block.kind, text: cleanText(block.text) }))
    .filter((block) => block.text && block.text !== page.title && block.text !== candidate.title) as CommunityBlock[];
  return trimBlocksToEvidenceBudget(blocks.length ? blocks : fallbackBlocks(page.text));
};


const cleanText = (value: unknown, maximum = 8_000) =>
  (typeof value === "string" ? value : "").replace(/\s+/g, " ").trim().slice(0, maximum);

const normalizedUrl = (value: string | undefined) => {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/u, "") || "/";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(?:utm_.+|ref|source|spm|from)$/iu.test(key)) url.searchParams.delete(key);
    }
    return url.toString().toLocaleLowerCase();
  } catch {
    return value.trim().toLocaleLowerCase();
  }
};

export const hasLinkedCommunitySource = (candidate: Candidate) => Boolean(
  candidate.engagement?.discussionUrl
  && normalizedUrl(candidate.engagement.discussionUrl) !== normalizedUrl(candidate.canonicalUrl || candidate.url),
);

type CommunityPageExtractor = (url: string, imageLimit: number) => Promise<ExtractedPage>;

export const extractLinkedCommunitySource = async (
  candidate: Candidate,
  imageLimit: number,
  extractor: CommunityPageExtractor = extractPage,
  retryDelayMs = 350,
) => {
  if (!hasLinkedCommunitySource(candidate)) {
    throw new Error("这条社区线索没有独立的关联来源");
  }
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await extractor(candidate.canonicalUrl || candidate.url, imageLimit);
    } catch (error) {
      lastError = error;
      if (attempt === 0 && retryDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
  }
  throw new Error(`关联来源连续两次读取失败：${lastError instanceof Error ? lastError.message : String(lastError)}`);
};

export const mergeDraftSources = (sources: DraftSource[]) => {
  const merged = new Map<string, DraftSource>();
  const kindRank: Record<DraftSource["kind"], number> = {
    supporting: 0,
    "original-report": 1,
    primary: 2,
  };
  for (const source of sources) {
    const key = normalizedUrl(source.url);
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...source });
      continue;
    }
    merged.set(key, {
      ...(kindRank[source.kind] > kindRank[current.kind] ? source : current),
      verified: current.verified || source.verified,
    });
  }
  return [...merged.values()];
};

const sourceNameFor = (sourceUrl: string) => {
  try {
    const hostname = new URL(sourceUrl).hostname.replace(/^www\./u, "");
    if (hostname === "github.com") return "GitHub";
    if (hostname === "youtube.com" || hostname === "youtu.be") return "YouTube";
    return hostname;
  } catch {
    return "关联来源";
  }
};

/**
 * A community card may point at a real article, repository or product page.
 * Article mode deliberately derives a non-community candidate from that page
 * so one cached comment can never become the factual spine of the story.
 */
export const buildCommunityArticleInput = (
  candidate: Candidate,
  linkedSourcePage: ExtractedPage,
) => {
  if (!hasLinkedCommunitySource(candidate)) {
    throw new Error("这条社区线索没有独立的关联来源，只能整理社区素材，不能直接写新闻稿");
  }
  const blocks = sourceBlocks(linkedSourcePage, candidate);
  const extractedText = blocks.map((block) => block.text).join("\n").trim();
  if (extractedText.length < 160) {
    throw new Error("关联来源正文过短，无法建立新闻事实主干；请先补充来源再成稿");
  }
  const canonicalUrl = linkedSourcePage.canonicalUrl || linkedSourcePage.url || candidate.url;
  const sourceName = sourceNameFor(canonicalUrl);
  const sourceCandidate: Candidate = {
    ...candidate,
    sourceType: "web",
    sourceName,
    sourceRole: "discovery",
    title: cleanText(linkedSourcePage.title, 500) || candidate.title,
    url: canonicalUrl,
    canonicalUrl,
    excerpt: extractedText.slice(0, 2_400),
    publishedAt: linkedSourcePage.publishedAt || "",
    author: undefined,
    engagement: undefined,
    briefing: undefined,
    communityInsight: undefined,
    clusterSize: 1,
    relatedSources: [sourceName],
    evidence: "已读取关联来源正文",
  };
  return { candidate: sourceCandidate, canonicalUrl, extractedText };
};

const workflowCopyPattern = /(?:这份|本次|当前)?(?:输入资料|输入内容|输入里|证据文本|素材包)|讨论串标题|当前样本|Top Comment|供编辑|后续编辑|发布前(?:应|需|需要)|事实定稿|模型返回|任务数据/iu;

/** Reader copy must never expose the editor's evidence-processing workflow. */
export const validateReaderFacingCommunityArticle = (paragraphs: string[]) => {
  const leaked = paragraphs.find((paragraph) => workflowCopyPattern.test(paragraph));
  if (leaked) {
    throw new Error(`生成正文包含后台处理语言，已停止保存：${leaked.slice(0, 80)}`);
  }
  const sentences = paragraphs.flatMap((paragraph) => paragraph
    .split(/(?<=[。！？!?])/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean));
  const communitySentences = sentences.filter((sentence) =>
    /Hacker News|社区(?:用户|讨论|评论)|讨论串|评论区|高赞评论|Top Comment/iu.test(sentence));
  const communityCharacters = communitySentences.reduce((total, sentence) => total + sentence.length, 0);
  const articleCharacters = sentences.reduce((total, sentence) => total + sentence.length, 0);
  if (
    communitySentences.length >= 2
    && communityCharacters / Math.max(1, articleCharacters) > 0.6
  ) {
    throw new Error("生成正文被社区讨论主导，已停止保存；请重新建立新闻事实主干");
  }
  const aiShell = paragraphs.find((paragraph) =>
    /(?:不是|并非).{0,80}(?:而是|才是)|原因不是|不只是|不仅|真正|其实|本质上|更重要的是|核心在于|关键在于|写得很直白[：:]/u.test(paragraph));
  if (aiShell) {
    throw new Error(`生成正文仍有模板化翻案或讲义腔，已停止保存：${aiShell.slice(0, 80)}`);
  }
  const jargonHeavy = paragraphs.find((paragraph) =>
    (paragraph.match(/\b[A-Za-z][A-Za-z0-9.+_-]*\b/gu) || []).length > 16);
  if (jargonHeavy) {
    throw new Error(`生成正文对普通读者堆入过多英文技术名词，已停止保存：${jargonHeavy.slice(0, 80)}`);
  }
};

const communityCandidate = (candidate: Candidate) => {
  const identity = `${candidate.sourceRole || ""} ${candidate.sourceType} ${candidate.sourceName}`.toLocaleLowerCase();
  return candidate.sourceRole === "community"
    || /community|hackernews|hacker news|reddit|zhihu|知乎|twitter|\bx\b|youtube|tiktok|instagram|last30days/u.test(identity)
    || Boolean(candidate.engagement?.discussionUrl);
};

export const supportsCommunityDraft = (candidate: Candidate) => communityCandidate(candidate);

export const createCommunityDraft = async (
  runId: string,
  candidateId: string,
  mode: CommunityDraftMode,
) => {
  const state = await readState();
  const run = state.runs.find((entry) => entry.id === runId);
  if (!run) throw new Error("运行记录不存在");
  const candidate = run.candidates.find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error("候选内容不存在");
  if (!supportsCommunityDraft(candidate)) throw new Error("这条候选不是社区来源，不能使用社区入稿模式");
  if (mode === "article" && !hasLinkedCommunitySource(candidate)) {
    throw new Error("这条社区线索没有独立的关联来源，只能整理社区原文或观点素材");
  }

  const { editorialIntakeDesk } = await import("./editorial-intake.js");
  const result = await editorialIntakeDesk.createDraft({ runId, candidateId, intent: mode === "article" ? "news" : "source", sourceMode: mode === "article" ? undefined : mode });
  return result.draft;
};
