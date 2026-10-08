import { artifactFromRun, type RunArtifactReader } from "./run-artifacts.js";
import type { Candidate, WorkflowRun } from "./types.js";
/** Default work uses display candidates. Retained evidence is read only when explicitly selected. */
export const candidatePool = (run: WorkflowRun, explicitIds?: ReadonlySet<string>, readArtifact?: RunArtifactReader): Candidate[] => {
  if (!explicitIds) return run.candidates;
  return [...new Map([...run.candidates, ...(artifactFromRun(run, "evidenceCandidates", readArtifact) ?? [])].filter(candidate => explicitIds.has(candidate.id)).map(candidate => [candidate.id, candidate])).values()]
    .map(candidate => run.candidates.find(visible => visible.id === candidate.id) ?? candidate);
};
export const candidateFromRun = (run: WorkflowRun | undefined, id: string, readArtifact?: RunArtifactReader) => run?.candidates.find(candidate => candidate.id === id) ?? (run ? artifactFromRun(run, "evidenceCandidates", readArtifact)?.find(candidate => candidate.id === id) : undefined);
