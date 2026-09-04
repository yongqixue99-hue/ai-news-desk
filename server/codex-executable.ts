import { existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

interface CodexExecutableEnvironment {
  platform?: NodeJS.Platform;
  localAppData?: string;
  userProfile?: string;
}

const executableCandidates = (binRoot: string) => {
  if (!existsSync(binRoot)) return [];
  try {
    return readdirSync(binRoot, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory()) return [];
      const executable = path.join(binRoot, entry.name, "codex.exe");
      if (!existsSync(executable)) return [];
      try {
        const stats = statSync(executable);
        return stats.isFile() ? [{ executable, modifiedAt: stats.mtimeMs }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
};

export const resolveCodexExecutable = (
  environment: CodexExecutableEnvironment = {},
) => {
  const platform = environment.platform ?? process.platform;
  if (platform !== "win32") return "codex";

  const localAppData = Object.hasOwn(environment, "localAppData")
    ? environment.localAppData
    : process.env.LOCALAPPDATA;
  const userProfile = Object.hasOwn(environment, "userProfile")
    ? environment.userProfile
    : process.env.USERPROFILE;
  const localRoots = [
    localAppData,
    userProfile
      ? path.join(userProfile, "AppData", "Local")
      : undefined,
  ].filter((entry): entry is string => Boolean(entry?.trim()));
  const seen = new Set<string>();
  const candidates = localRoots.flatMap((root) => {
    const key = path.resolve(root).toLocaleLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return executableCandidates(path.join(root, "OpenAI", "Codex", "bin"));
  });
  candidates.sort((left, right) => right.modifiedAt - left.modifiedAt);
  return candidates[0]?.executable ?? "codex";
};
