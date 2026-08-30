import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { format } from "node:util";
import { windowsServicePath } from "../server/windows-service-environment.ts";

process.env.NODE_ENV = "production";

const codexBinRoot = process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "OpenAI", "Codex", "bin")
  : "";
const codexExecutableDirectories = codexBinRoot && existsSync(codexBinRoot)
  ? readdirSync(codexBinRoot, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    const directory = path.join(codexBinRoot, entry.name);
    return existsSync(path.join(directory, "codex.exe")) ? [directory] : [];
  })
  : [];
process.env.PATH = windowsServicePath({
  currentPath: process.env.PATH,
  nodeExecutable: process.execPath,
  appData: process.env.APPDATA,
  codexExecutableDirectories,
});

const projectPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const configuredRoot = process.env.AI_NEWS_DESK_WORKFLOW_ROOT?.trim();
const workflowPath = configuredRoot
  ? path.resolve(projectPath, configuredRoot)
  : path.join(projectPath, ".workflow");
const logDirectory = path.join(workflowPath, "logs");
const logPath = path.join(logDirectory, "windows-service.log");
const maximumLogBytes = 5 * 1024 * 1024;
const retainedLogs = 3;

mkdirSync(logDirectory, { recursive: true });
if (existsSync(logPath) && statSync(logPath).size >= maximumLogBytes) {
  for (let index = retainedLogs - 1; index >= 1; index -= 1) {
    const source = `${logPath}.${index}`;
    if (existsSync(source)) renameSync(source, `${logPath}.${index + 1}`);
  }
  renameSync(logPath, `${logPath}.1`);
}

const log = createWriteStream(logPath, { flags: "a" });
const write = (level, values) => {
  log.write(`${new Date().toISOString()} ${level} ${format(...values)}\n`);
};
console.log = (...values) => write("INFO", values);
console.info = (...values) => write("INFO", values);
console.warn = (...values) => write("WARN", values);
console.error = (...values) => write("ERROR", values);
process.on("warning", (warning) => console.warn(warning.stack || warning.message));
process.on("exit", (code) => {
  write("INFO", [`service process exited with code ${code}`]);
  log.end();
});

await import("../server/index.ts");
