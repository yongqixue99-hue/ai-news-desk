import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

async function files(root, prefix = "") {
  const entries = await readdir(path.join(root, prefix), { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const name = path.posix.join(prefix, entry.name);
    return entry.isDirectory() ? files(root, name) : [name];
  }))).flat().sort();
}

// Prove that CSS is the sole build change before taking any screenshots.
// Bundle hashes can rename JS files that only reference the changed CSS. Match
// their logical names and normalize only known asset references, never code.
export async function verifyCssBuildPair(before, after) {
  const oldFiles = await files(before), newFiles = await files(after);
  const oldCss = oldFiles.filter(file => file.endsWith(".css"));
  const newCss = newFiles.filter(file => file.endsWith(".css"));
  assert.equal(oldCss.length, 1, "Exactly one CSS bundle is required in before build");
  assert.equal(newCss.length, 1, "Exactly one CSS bundle is required in after build");
  const rest = values => values.filter(file => file !== "index.html" && !file.endsWith(".css"));
  const role = name => name.replace(/-([A-Za-z0-9_-]{8})(\.js)$/u, "$2");
  const map = values => new Map(values.map(name => [role(name), name]));
  const oldMap = map(rest(oldFiles)), newMap = map(rest(newFiles));
  assert.equal(oldMap.size, rest(oldFiles).length, "Duplicate logical assets in before build");
  assert.equal(newMap.size, rest(newFiles).length, "Duplicate logical assets in after build");
  assert.deepEqual([...newMap.keys()].sort(), [...oldMap.keys()].sort(), "Non-CSS asset list changed");
  const normalize = (text, mapping, css) => {
    const refs = [...mapping].map(([logical, actual]) => [path.posix.basename(actual), path.posix.basename(logical)]);
    refs.push([path.posix.basename(css), "__verified_css__"]);
    for (const [actual, logical] of refs) text = text.replaceAll(actual, logical);
    return text;
  };
  for (const [logical, oldName] of oldMap) {
    const newName = newMap.get(logical);
    const oldBytes = await readFile(path.join(before, oldName)), newBytes = await readFile(path.join(after, newName));
    if (logical.endsWith(".js") && oldName !== newName) {
      assert.equal(normalize(oldBytes.toString("utf8"), oldMap, oldCss[0]), normalize(newBytes.toString("utf8"), newMap, newCss[0]), `Non-CSS asset changed: ${logical}`);
    } else assert.equal(Buffer.compare(oldBytes, newBytes), 0, `Non-CSS asset changed: ${logical}`);
  }
  const oldHtml = await readFile(path.join(before, "index.html"), "utf8");
  const newHtml = await readFile(path.join(after, "index.html"), "utf8");
  assert.equal(normalize(oldHtml, oldMap, oldCss[0]), normalize(newHtml, newMap, newCss[0]), "HTML changed beyond CSS and bundle references");
  return { beforeHref: `/__before/${oldCss[0]}`, afterHref: `/${newCss[0]}` };
}
