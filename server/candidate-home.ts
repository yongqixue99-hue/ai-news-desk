import type { Candidate } from "./types.js";

export interface CandidateHomeOptions {
  now?: string;
  expiryHours?: number;
  secondaryCount?: number;
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
    if (!stale) current.push(candidate);
    else if (isEditoriallyActive(candidate)) protectedStale.push(candidate);
    else expired.push(candidate);
  }

  const secondaryCount = Math.max(0, Math.floor(options.secondaryCount ?? 4));
  const active = [...current, ...protectedStale];
  return {
    active,
    featured: current[0],
    recommended: current.slice(1, secondaryCount + 1),
    others: [...current.slice(secondaryCount + 1), ...protectedStale],
    expired,
  };
};
