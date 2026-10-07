import postcss, { type Rule, type Container, type Document } from "postcss";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/** Include textual assets as well as code; imported markup also owns class names. */
export async function collectLegacyCssReferences(directories: string[]): Promise<string[]> {
  const filesIn = async (directory: string): Promise<string[]> => {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(entry => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? filesIn(file) : Promise.resolve(/\.(?:tsx?|[cm]?js|html|svg|json|md|txt)$/u.test(file) ? [file] : []);
    }))).flat();
  };
  return Promise.all((await Promise.all(directories.map(filesIn))).flat().map(file => readFile(file, "utf8")));
}

/** Conservative evidence of use. CSS is deliberately not reference material. */
export function auditLegacyCss(css: string, references: string[]) {
  const reference = references.join("\n");
  const prefixes = [...reference.matchAll(/[`"']([^`"'\n]*?)(?:\$\{|["']\s*\+)/gu)]
    .map(match => match[1]!.trim().split(/\s+/u).at(-1)!)
    .filter(prefix => /^[\w-]+$/u.test(prefix));
  const used = (name: string) => reference.includes(name) || prefixes.some(prefix => name.startsWith(prefix));
  const root = postcss.parse(css);
  const removedSelectors: string[] = [];
  root.walkRules(rule => {
    // Unknown syntax is retained. :not(.missing), for example, matches live nodes.
    const selectors: string[] = [rule.selector];
    let ancestor: Container | Document | undefined = rule.parent;
    while (ancestor) {
      if (ancestor.type === "rule") selectors.push((ancestor as Rule).selector);
      ancestor = ancestor.parent;
    }
    rule.walkRules(child => { selectors.push(child.selector); });
    if (selectors.some(selector => /[\\\[(]|layout-|preview-article-title/u.test(selector))) return;
    if (selectors.some(selector => selector.split(",").some(arm => !/\.[\w-]+/u.test(arm)))) return;
    const classes = selectors.flatMap(selector => [...selector.matchAll(/\.([\w-]+)/gu)].map(match => match[1]!));
    if (!classes.length || classes.some(used)) return;
    removedSelectors.push(rule.selector);
    rule.remove();
  });
  const result = root.toString();
  return { css: result, removedSelectors, beforeBytes: Buffer.byteLength(css), afterBytes: Buffer.byteLength(result) };
}
