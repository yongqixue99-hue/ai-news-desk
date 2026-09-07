import type { Candidate } from "./types.js";
import { interleaveBySource } from "./source-diversity.js";
import { candidateOpportunity, opportunityPriority } from "./newsworthiness.js";

export interface CandidateHomeOptions {
  now?: string;
  expiryHours?: number;
  secondaryCount?: number;
  recommendationMode?: "focused" | "balanced";
}

export interface CandidateHomeComposition {
  active: Candidate[];
  featured?: Candidate;
  recommended: Candidate[];
  others: Candidate[];
  expired: Candidate[];
}

const isEditoriallyActive = (candidate: Candidate) =>
  candidate.selected
  || candidate.status === "drafted"
  || candidate.userFeedback === "interested"
  || candidate.userFeedback === "published";

export const composeCandidateHome = (
  rankedCandidates: Candidate[],
  options: CandidateHomeOptions = {},
): CandidateHomeComposition => {
  const nowMs = Date.parse(options.now ?? new Date().toISOString());
  const expiryMs = (options.expiryHours ?? 48) * 3_600_000;
  const current: Candidate[] = [];
  const protectedStale: Candidate[] = [];
  const expired: Candidate[] = [];

  for (const candidate of rankedCandidates) {
    const publishedAt = Date.parse(candidate.publishedAt);
    const stale = !Number.isFinite(publishedAt)
      || (Number.isFinite(nowMs) && nowMs - publishedAt > expiryMs);
    if (candidate.technicalArticle) protectedStale.push(candidate);
    else if (!stale) current.push(candidate);
    else if (isEditoriallyActive(candidate)) protectedStale.push(candidate);
    else expired.push(candidate);
  }

  const secondaryCount = Math.max(0, Math.floor(options.secondaryCount ?? 4));
  const diversifiedCurrent = interleaveBySource(current, (candidate) => candidate.sourceName);
  const focused = options.recommendationMode === "focused";
  const chosen = focused ? [...current].filter((candidate) => candidateOpportunity(candidate).lane !== "routine" || candidate.selected || candidate.userFeedback === "interested")
    .sort((left, right) => opportunityPriority(candidateOpportunity(right)) - opportunityPriority(candidateOpportunity(left))) : diversifiedCurrent;
  const promoted = new Set(chosen.slice(0, secondaryCount + 1).map((candidate) => candidate.id));
  const active = [...diversifiedCurrent, ...protectedStale];
  return {
    active,
    featured: chosen[0],
    recommended: chosen.slice(1, secondaryCount + 1),
    others: [...diversifiedCurrent.filter((candidate) => !promoted.has(candidate.id)), ...protectedStale],
    expired,
  };
};
