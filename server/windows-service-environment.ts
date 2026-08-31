import path from "node:path";

export const windowsServicePath = (input: {
  currentPath?: string;
  nodeExecutable: string;
  appData?: string;
  codexExecutableDirectories?: string[];
}) => {
  const windowsPath = path.win32;
  const candidates = [
    ...(input.currentPath ?? "").split(windowsPath.delimiter),
    windowsPath.dirname(input.nodeExecutable),
    ...(input.appData ? [windowsPath.join(input.appData, "npm")] : []),
    ...(input.codexExecutableDirectories ?? []),
  ].map((entry) => entry.trim()).filter(Boolean);
  const seen = new Set<string>();
  return candidates.filter((entry) => {
    const key = entry.replace(/[\\/]+$/u, "").toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(windowsPath.delimiter);
};
