import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { auditLegacyCss } from "./legacy-css-analysis.js";

const filesIn = async (directory: string): Promise<string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesIn(file) : Promise.resolve(/\.(?:tsx?|[cm]?js|html)$/u.test(file) ? [file] : []);
  }))).flat();
};
const [file, mode] = process.argv.slice(2);
const imports = await readFile("src/design/index.css", "utf8");
const allowed = [...imports.matchAll(/@import "([^"\n]+)" layer\(legacy\)/gu)].map(match => path.resolve("src/design", match[1]!));
if (!file || !allowed.includes(path.resolve(file))) throw new Error("Specify exactly one imported legacy CSS file");
const references = await Promise.all((await Promise.all(["src", "server", "chrome-extension"].map(filesIn))).flat().map(file => readFile(file, "utf8")));
const result = auditLegacyCss(await readFile(file, "utf8"), references);
if (mode === "--write") await writeFile(file, result.css);
else if (mode) throw new Error("Only --write is supported");
console.log(JSON.stringify({ file, beforeBytes: result.beforeBytes, afterBytes: result.afterBytes, removedSelectors: result.removedSelectors }, null, 2));
