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

// Reusing the rendered DOM is valid only when CSS is the sole build change.
// Prove that every other byte is unchanged before taking any screenshots.
export async function verifyCssBuildPair(before, after) {
  const oldFiles = await files(before), newFiles = await files(after);
  const oldCss = oldFiles.filter(file => file.endsWith(".css"));
  const newCss = newFiles.filter(file => file.endsWith(".css"));
  assert.equal(oldCss.length, 1, "Exactly one CSS bundle is required in before build");
  assert.equal(newCss.length, 1, "Exactly one CSS bundle is required in after build");
  const rest = values => values.filter(file => file !== "index.html" && !file.endsWith(".css"));
  assert.deepEqual(rest(newFiles), rest(oldFiles), "Non-CSS asset list changed");
  for (const name of rest(oldFiles)) {
    assert.equal(Buffer.compare(await readFile(path.join(before, name)), await readFile(path.join(after, name))), 0, `Non-CSS asset changed: ${name}`);
  }
  const oldHtml = await readFile(path.join(before, "index.html"), "utf8");
  const newHtml = await readFile(path.join(after, "index.html"), "utf8");
  assert.equal(oldHtml.replaceAll(`/${oldCss[0]}`, "/__verified_css__"), newHtml.replaceAll(`/${newCss[0]}`, "/__verified_css__"), "HTML changed beyond CSS");
  return { beforeHref: `/__before/${oldCss[0]}`, afterHref: `/${newCss[0]}` };
}
