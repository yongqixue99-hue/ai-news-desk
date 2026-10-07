import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { verifyCssBuildPair } from "../scripts/ui-preview/css-pair.mjs";

test("CSS-only comparison rejects changes to scripts, page structure or a second stylesheet", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "newsdesk-css-pair-"));
  const before = path.join(root, "before"), after = path.join(root, "after");
  try {
    for (const [dir, css] of [[before, "old.css"], [after, "new.css"]]) {
      await mkdir(path.join(dir!, "assets"), { recursive: true });
      await writeFile(path.join(dir!, "index.html"), `<link rel="stylesheet" href="/assets/${css}"><div id="root"></div>`);
      await writeFile(path.join(dir!, "assets", css!), "/* CSS may differ */");
      await writeFile(path.join(dir!, "assets/site.js"), "/* original application */");
    }
    assert.deepEqual(await verifyCssBuildPair(before, after), { beforeHref: "/__before/assets/old.css", afterHref: "/assets/new.css", unchangedCss: true });
    await writeFile(path.join(after, "assets/new.css"), "body { color: red; }");
    assert.equal((await verifyCssBuildPair(before, after)).unchangedCss, false);
    await writeFile(path.join(after, "assets/site.js"), "/* changed application */");
    await assert.rejects(verifyCssBuildPair(before, after), /Non-CSS asset changed/u);
    await writeFile(path.join(after, "assets/site.js"), "/* original application */");
    await writeFile(path.join(after, "index.html"), '<link rel="stylesheet" href="/assets/new.css"><div id="changed"></div>');
    await assert.rejects(verifyCssBuildPair(before, after), /HTML changed beyond CSS/u);
    await writeFile(path.join(after, "index.html"), '<link rel="stylesheet" href="/assets/new.css"><div id="root"></div>');
    await writeFile(path.join(after, "assets/extra.css"), "/* extra */");
    await assert.rejects(verifyCssBuildPair(before, after), /Exactly one CSS bundle/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("bundler hash renames preserve identical code but cannot hide a code change", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "newsdesk-css-hashes-"));
  const before = path.join(root, "before"), after = path.join(root, "after");
  try {
    for (const [dir, hash] of [[before, "AAAAAAAA"], [after, "BBBBBBBB"]]) {
      await mkdir(path.join(dir!, "assets"), { recursive: true });
      await writeFile(path.join(dir!, "index.html"), `<link rel="stylesheet" href="/assets/index-${hash}.css"><script src="/assets/index-${hash}.js"></script>`);
      await writeFile(path.join(dir!, "assets", `index-${hash}.css`), "/* CSS differs */");
      await writeFile(path.join(dir!, "assets", `index-${hash}.js`), `const stylesheet="index-${hash}.css";const article=42;`);
    }
    assert.deepEqual(await verifyCssBuildPair(before, after), { beforeHref: "/__before/assets/index-AAAAAAAA.css", afterHref: "/assets/index-BBBBBBBB.css", unchangedCss: true });
    await writeFile(path.join(after, "assets/index-BBBBBBBB.js"), 'const stylesheet="index-BBBBBBBB.css";const article=43;');
    await assert.rejects(verifyCssBuildPair(before, after), /Non-CSS asset changed/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
