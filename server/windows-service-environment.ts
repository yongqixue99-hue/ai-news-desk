import path from "node:path";

export const windowsServicePath = (input: {
  currentPath?: string;
  nodeExecutable: string;
  appData?: string;
  codexExecutableDirectories?: string[];
}) => {
  const candidates = [
    ...(input.currentPath ?? "").split(path.delimiter),
    path.dirname(input.nodeExecutable),
    ...(input.appData ? [path.join(input.appData, "npm")] : []),
    ...(input.codexExecutableDirectories ?? []),
  ].map((entry) => entry.trim()).filter(Boolean);
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    const key = entry.replace(/[\\/]+$/u, "").toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(path.delimiter);
};
