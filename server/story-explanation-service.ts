import { buildCandidateBriefingEvidence } from "./candidate-briefing.js";
import { extractPage } from "./extractor.js";
import { enrichCandidateBriefings } from "./horizon.js";
import { extractRenderedPageText } from "./page-screenshot.js";
import { readState, updateState } from "./storage.js";
import { applyTechnicalSourceMetadata } from "./technical-article.js";
import { storyById } from "./story-desk.js";
import type { SourceRole } from "./types.js";

const roleRank: Record<SourceRole | "discovery", number> = {
  official: 6,
  research: 5,
  verification: 4,
  discovery: 3,
  community: 1,
};

const basisRank = { "full-source": 3, excerpt: 2, title: 1 } as const;

/**
 * Expands one Story from scan-level metadata into a cached Chinese explanation.
 * It deliberately enriches only the best factual source: the remaining source
 * summaries stay visible for comparison, while one click costs one model pass.
 */
export const enrichStoryExplanation = async (storyId: string) => {
  const state = await readState();
  const story = storyById(state, storyId);
  if (!story) throw new Error("Story 不存在");
  const preferredSignals = [...story.signals].sort((left, right) =>
    Number(left.isCommunity) - Number(right.isCommunity)
      || roleRank[right.sourceRole ?? "discovery"] - roleRank[left.sourceRole ?? "discovery"]
      || basisRank[right.briefingBasis ?? "title"] - basisRank[left.briefingBasis ?? "title"]);
  const signal = preferredSignals[0];
  if (!signal) throw new Error("这个 Story 没有可读取的来源");
  const run = state.runs.find((entry) => entry.id === signal.runId);
  const candidate = run?.candidates.find((entry) => entry.id === signal.candidateId);
  if (!run || !candidate) throw new Error("Story 来源已不存在");

  const extractedSourceText = new Map<string, string>();
  try {
    const page = await extractPage(candidate.canonicalUrl || candidate.url, 0);
    if (candidate.technicalArticle) await updateState(current => {
      const target = current.runs.find(entry => entry.id === run.id)?.candidates.find(entry => entry.id === candidate.id);
      if (target) applyTechnicalSourceMetadata(target, page);
    });
    if (page.text.trim().length >= 80) extractedSourceText.set(candidate.id, page.text.slice(0, 12_000));
  } catch {
    try {
      const page = await extractRenderedPageText(candidate.canonicalUrl || candidate.url, 12_000);
      extractedSourceText.set(candidate.id, page.text);
    } catch {
      // RSS excerpts and public community text remain a safe fallback. The model
      // receives an explicit evidence basis and may not pretend it read the page.
    }
  }
  const evidence = buildCandidateBriefingEvidence([candidate], extractedSourceText);
  if (!evidence[0]?.text.trim()) throw new Error("来源没有可用于讲解的正文或摘要");
  const result = await enrichCandidateBriefings(run.id, {
    candidateIds: [candidate.id],
    extractedSourceText,
    force: true,
  });
  if (!result.completed) throw new Error("正文讲解生成失败，请稍后重试");
  const updatedStory = storyById(await readState(), storyId);
  if (!updatedStory?.explanation || updatedStory.explanation.status !== "ready") {
    throw new Error("来源只返回了扫描级信息，尚未形成完整讲解");
  }
  return updatedStory;
};
