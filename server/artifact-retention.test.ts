import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pruneJobArtifacts, removeRunJobArtifacts } from "./artifact-retention.js";

test("job artifacts keep only the newest bounded set", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-desk-job-retention-"));
  try {
    for (let index = 0; index < 4; index += 1) {
      const file = path.join(root, `job-${index}.json`);
      await writeFile(file, String(index));
      const at = new Date(`2026-08-2${index + 1}T00:00:00.000Z`);
      await utimes(file, at, at);
    }
    const result = await pruneJobArtifacts(root, {
      now: new Date("2026-08-30T00:00:00.000Z"),
      maxAgeMs: 30 * 86_400_000,
      maxFiles: 2,
    });

    assert.equal(result.removed, 2);
    assert.deepEqual((await readdir(root)).sort(), ["job-2.json", "job-3.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("run cleanup removes only exact run-prefixed artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "news-desk-run-cleanup-"));
  try {
    await Promise.all([
      writeFile(path.join(root, "run-1-candidate.json"), "1"),
      writeFile(path.join(root, "run-1.output.json"), "1"),
      writeFile(path.join(root, "run-10-candidate.json"), "10"),
      writeFile(path.join(root, "unrelated.json"), "x"),
    ]);
    assert.equal((await removeRunJobArtifacts(root, "run-1")).removed, 2);
    assert.deepEqual((await readdir(root)).sort(), ["run-10-candidate.json", "unrelated.json"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
