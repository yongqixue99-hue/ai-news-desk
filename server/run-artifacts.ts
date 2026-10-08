import { createHash } from "node:crypto";
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

export interface RunArtifactRow { run_id: string; kind: string; json: string; checksum: string; updated_at: string }
export const decodeRunArtifact = (row: RunArtifactRow): unknown[] => {
  if (!runArtifactKinds.includes(row.kind as RunArtifactKind)
    || createHash("sha256").update(row.json).digest("hex") !== row.checksum) throw new Error("运行明细校验失败");
  const value: unknown = JSON.parse(row.json);
  if (!Array.isArray(value)) throw new Error("运行明细必须是数组");
  return value;
};

/** Shared by full backups and read-only portable inspection. It mutates only a fresh decoded object. */
export const hydrateRunArtifacts = <T>(state: T, rows: RunArtifactRow[]): T => {
  const runs = (state as { runs?: WorkflowRun[] }).runs;
  const byId = new Map((Array.isArray(runs) ? runs : []).map(run => [run.id, run]));
  for (const row of rows) {
    const value = decodeRunArtifact(row);
    const run = byId.get(row.run_id);
    if (run && !Object.hasOwn(run, row.kind)) Object.assign(run, { [row.kind]: value });
  }
  return state;
};
