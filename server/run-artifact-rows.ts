import { createHash } from "node:crypto";
import { runArtifactKinds, type RunArtifactKind } from "./run-artifacts.js";
import type { WorkflowRun } from "./types.js";

/** Server-only: verifies stored rows. Kept apart so client bundles never load node:crypto. */
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
