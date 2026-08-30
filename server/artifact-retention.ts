import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

interface JobArtifactRetentionOptions {
  now?: Date;
  maxAgeMs?: number;
  maxFiles?: number;
}

const filesIn = async (root: string) => {
  const entries = await readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return Promise.all(entries
    .filter((entry) => entry.isFile())
    .map(async (entry) => ({
      name: entry.name,
      path: path.join(root, entry.name),
      mtimeMs: (await stat(path.join(root, entry.name))).mtimeMs,
    })));
};

export const pruneJobArtifacts = async (
  root: string,
  options: JobArtifactRetentionOptions = {},
) => {
  const maxAgeMs = Math.max(0, options.maxAgeMs ?? 14 * 86_400_000);
  const maxFiles = Math.max(0, Math.floor(options.maxFiles ?? 200));
  const cutoff = (options.now ?? new Date()).getTime() - maxAgeMs;
  const files = (await filesIn(root)).sort((left, right) => right.mtimeMs - left.mtimeMs || left.name.localeCompare(right.name));
  const removedPaths: string[] = [];
  for (const [index, file] of files.entries()) {
    if (file.mtimeMs >= cutoff && index < maxFiles) continue;
    await rm(file.path, { force: true });
    removedPaths.push(file.path);
  }
  return { removed: removedPaths.length, removedPaths };
};

export const removeRunJobArtifacts = async (root: string, runId: string) => {
  if (!/^[a-zA-Z0-9_-]+$/u.test(runId)) throw new Error("运行 ID 格式不正确");
  const prefixes = [`${runId}-`, `${runId}.`];
  const targets = (await filesIn(root)).filter((file) => prefixes.some((prefix) => file.name.startsWith(prefix)));
  for (const target of targets) await rm(target.path, { force: true });
  return { removed: targets.length, removedPaths: targets.map((target) => target.path) };
};
