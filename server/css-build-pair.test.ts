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
    assert.deepEqual(await verifyCssBuildPair(before, after), { beforeHref: "/__before/assets/old.css", afterHref: "/assets/new.css" });
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
