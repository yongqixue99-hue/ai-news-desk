// Browser-reachable: views import these helpers. Row decoding and checksums live in run-artifact-rows.ts.
import type { WorkflowRun } from "./types.js";

export const runArtifactKinds = ["discoveryTrace", "evidenceCandidates", "aggregationItems"] as const;
export type RunArtifactKind = typeof runArtifactKinds[number];
export type RunArtifactValue<K extends RunArtifactKind> = NonNullable<WorkflowRun[K]>;
export type RunArtifactReader = <K extends RunArtifactKind>(runId: string, kind: K) => RunArtifactValue<K> | undefined;

/** An explicit field, including an explicit clear, takes precedence over persisted history. */
export const artifactFromRun = <K extends RunArtifactKind>(run: WorkflowRun, kind: K, read?: RunArtifactReader): RunArtifactValue<K> | undefined =>
  Object.hasOwn(run, kind) ? run[kind] as RunArtifactValue<K> | undefined : read?.(run.id, kind);

/** One owned snapshot per projection. Repeated evidence matching must not clone a large trace per candidate. */
export const snapshotArtifactReader = (read?: RunArtifactReader): RunArtifactReader | undefined => {
  if (!read) return undefined;
  const values = new Map<string, unknown>();
  return <K extends RunArtifactKind>(runId: string, kind: K): RunArtifactValue<K> | undefined => {
    const key = JSON.stringify([runId, kind]);
    if (!values.has(key)) values.set(key, read(runId, kind));
    return values.get(key) as RunArtifactValue<K> | undefined;
  };
};

/** Used only on the private clone passed to a storage mutator, never on a cached projection. */
export const materializeRunArtifactForMutation = <K extends RunArtifactKind>(run: WorkflowRun, kind: K, read: RunArtifactReader) => {
  if (!Object.hasOwn(run, kind)) {
    const value = read(run.id, kind);
    if (value !== undefined) Object.assign(run, { [kind]: value });
  }
  return run[kind];
};
