import type { SourceMaterialSnapshot, StoryView } from "./product-types.js";
import { readSourceWithSnapshot, type SourceSnapshotReadResult } from "./source-snapshot.js";
import { sourceReadingContent } from "./source-reading-content.js";
import { storyById } from "./story-desk.js";
import type { Candidate, WorkflowState } from "./types.js";

const maximumSourceCharacters = 48_000;

const compactText = (value: string) => value
  .replace(/<[^>]+>/gu, " ")
  .replace(/\r\n?/gu, "\n")
  .replace(/[\t\f\v ]+/gu, " ")
  .replace(/\n{3,}/gu, "\n\n")
  .trim();

/** Removes cached replies so a source-preserving route cannot silently turn
 * other people's comments into the author's original post. */
export const originalCommunityPostText = (candidate: Candidate) => compactText(
  candidate.excerpt.split(/---\s*Top Comments\s*---/iu)[0] || "",
);

const languageFor = (value: string): SourceMaterialSnapshot["originalLanguage"] => {
  const chinese = (value.match(/[\u3400-\u9fff]/gu) ?? []).length;
  const latin = (value.match(/[a-z]/giu) ?? []).length;
  if (chinese >= 20 && chinese >= latin * 0.35) return "zh";
  if (latin >= 40 && chinese <= latin * 0.08) return "en";
  return "mixed";
};

const sourceLabelFor = (url: string, fallback: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./u, "") || fallback;
  } catch {
    return fallback;
  }
};

const candidateForSignal = (state: WorkflowState, signal: StoryView["signals"][number]) => state.runs
  .find((run) => run.id === signal.runId)?.candidates
  .find((candidate) => candidate.id === signal.candidateId);

export interface SourceMaterialLoaderDependencies {
  readExternalSource: (input: { url: string; imageLimit: number }) => Promise<SourceSnapshotReadResult>;
}

const defaultReadExternalSource: SourceMaterialLoaderDependencies["readExternalSource"] = (input) =>
  readSourceWithSnapshot(input);

const clipped = (value: string) => ({
  text: value.slice(0, maximumSourceCharacters),
  truncated: value.length > maximumSourceCharacters,
});

/**
 * Captures exactly one primary source for the explicit `source` route. Linked
 * community posts use the linked page; self-contained posts use only the post
 * body before cached comments. The snapshot is safe editing material, not a
 * factual endorsement.
 */
export const loadSourceMaterialSnapshots = async (
  state: WorkflowState,
  storyId: string,
  dependencies: Partial<SourceMaterialLoaderDependencies> = {},
): Promise<SourceMaterialSnapshot[]> => {
  const story = storyById(state, storyId);
  if (!story) throw new Error("Story 不存在或已经退出当前数据");
  const readExternalSource = dependencies.readExternalSource ?? defaultReadExternalSource;
  const selfContained = story.signals
    .filter((signal) => signal.isCommunity && !signal.linkedSource)
    .map((signal) => ({ signal, candidate: candidateForSignal(state, signal) }))
    .find((entry): entry is typeof entry & { candidate: Candidate } => Boolean(entry.candidate));

  if (selfContained) {
    const originalText = originalCommunityPostText(selfContained.candidate);
    if (originalText.length < 80) {
      throw new Error("社区主帖正文过短，不能生成原文工作副本");
    }
    const snapshot = clipped(originalText);
    const url = selfContained.signal.discussionUrl
      || selfContained.candidate.canonicalUrl
      || selfContained.candidate.url;
    return [{
      signalId: `${selfContained.signal.runId}:${selfContained.signal.candidateId}`,
      sourceKind: "community-post",
      sourceLabel: selfContained.signal.sourceName,
      url,
      author: selfContained.candidate.author,
      originalTitle: selfContained.candidate.title,
      originalText: snapshot.text,
      originalLanguage: languageFor(snapshot.text),
      basis: "community-post",
      capturedAt: selfContained.candidate.fetchedAt,
      truncated: snapshot.truncated,
      rightsNotice: "社区主帖仅作为私有编辑工作副本；发布前需核对作者、引用范围及转载或翻译权限。",
    }];
  }

  const primarySignal = [...story.signals]
    .sort((left, right) => Number(Boolean(right.factBearing)) - Number(Boolean(left.factBearing)))
    .find((signal) => signal.factBearing ?? !signal.isCommunity);
  if (!primarySignal) throw new Error("当前没有可读取的原始来源正文");
  const candidate = candidateForSignal(state, primarySignal);
  if (!candidate) throw new Error("原始来源候选已经不存在");
  const requestedUrl = candidate.canonicalUrl || candidate.url;
  const read = await readExternalSource({ url: requestedUrl, imageLimit: 0 });
  const reading = sourceReadingContent(read.page);
  const sourceBlocks = reading.blocks ?? [];
  const originalText = reading.text;
  if (originalText.trim().length < 240) throw new Error("原始来源正文过短，不能生成忠实整理工作副本");
  const snapshot = clipped(originalText);
  const url = read.page.canonicalUrl || read.page.url || requestedUrl;
  return [{
    signalId: `${primarySignal.runId}:${primarySignal.candidateId}`,
    sourceKind: primarySignal.linkedSource ? "linked-page" : "article",
    sourceLabel: sourceLabelFor(url, primarySignal.sourceName),
    url,
    author: read.page.author || primarySignal.author,
    originalTitle: read.page.title || candidate.title,
    originalText: snapshot.text,
    blocks: sourceBlocks.length ? structuredClone(sourceBlocks).filter((_block, index) => sourceBlocks.slice(0, index + 1).reduce((size, block) => size + block.text.length + 2, 0) <= maximumSourceCharacters) : undefined,
    originalLanguage: languageFor(snapshot.text),
    basis: "full-source",
    capturedAt: read.capturedAt,
    fromCache: read.fromCache,
    truncated: snapshot.truncated || Boolean(read.page.textTruncated),
    extractionWarnings: reading.extractionWarnings,
    rightsNotice: "来源正文仅作为私有编辑工作副本；发布前需核对作者、引用范围及转载或翻译权限。",
  }];
};
