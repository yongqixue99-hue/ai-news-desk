import { readdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

// Avoid shell-specific ** expansion; include root-level and nested tests on
// macOS, Windows and Linux alike. Child arguments never pass through a shell.
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const found = await Promise.all(entries.map(async entry => {
    const name = path.join(directory, entry.name);
    if (entry.isDirectory()) return discover(name);
    return entry.isFile() && /\.test\.tsx?$/u.test(entry.name) ? [name] : [];
  }));
  return found.flat();
}
const files = (await Promise.all(["server", "src", "chrome-extension"].map(discover))).flat().sort();
if (process.argv.includes("--list")) process.stdout.write(`${files.join("\n")}\n`);
else {
  const options = process.argv.slice(2).filter(option => /^--test-concurrency=[1-9]\d*$/u.test(option));
  const child = spawn(process.execPath, ["--test", ...options, "--import", "tsx", ...files], { stdio: "inherit", shell: false });
  child.on("error", error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
  child.on("exit", (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
