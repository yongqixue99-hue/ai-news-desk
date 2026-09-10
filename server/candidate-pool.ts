import type { Candidate, WorkflowRun } from "./types.js";
/** Default work uses display candidates. Retained evidence is read only when explicitly selected. */
export const candidatePool = (run: WorkflowRun, explicitIds?: ReadonlySet<string>): Candidate[] => {
  if (!explicitIds) return run.candidates;
  return [...new Map([...run.candidates, ...(run.evidenceCandidates ?? [])].filter(candidate => explicitIds.has(candidate.id)).map(candidate => [candidate.id, candidate])).values()]
    .map(candidate => run.candidates.find(visible => visible.id === candidate.id) ?? candidate);
};
export const candidateFromRun = (run: WorkflowRun | undefined, id: string) => run?.candidates.find(candidate => candidate.id === id) ?? run?.evidenceCandidates?.find(candidate => candidate.id === id);
