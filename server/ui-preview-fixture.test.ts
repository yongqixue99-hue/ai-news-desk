import assert from "node:assert/strict";
import test from "node:test";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { once } from "node:events";

test("visual fixture serves distinct old and new builds on one origin without a writable API", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "newsdesk-preview-pair-"));
  for (const version of ["before", "after"]) {
    const dist = path.join(root, version);
    await mkdir(path.join(dist, "assets"), { recursive: true });
    await writeFile(path.join(dist, "index.html"), `<link href="/assets/site.css" rel="stylesheet"><script src="/assets/site.js"></script><p>${version}</p>`);
    await writeFile(path.join(dist, "assets/site.js"), `console.log("${version}")`);
    await writeFile(path.join(dist, "assets/site.css"), `/* ${version} */`);
    if (version === "before") await writeFile(path.join(dist, "assets/old-lazy.js"), 'console.log("old lazy")');
  }
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/ui-preview/fixture.ts"], {
    env: { ...process.env, AI_NEWS_DESK_DIST_ROOT: path.join(root, "after"), AI_NEWS_DESK_PREVIEW_BEFORE_DIST: path.join(root, "before") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    let output = "";
    const origin = await new Promise<string>((resolve, reject) => {
      child.stdout.on("data", chunk => { output += String(chunk); const match = output.match(/http:\/\/127\.0\.0\.1:\d+/u); if (match) resolve(match[0]); });
      child.stderr.on("data", chunk => { output += String(chunk); });
      child.once("exit", code => reject(new Error(`Fixture exited ${code}: ${output}`)));
    });
    const before = await fetch(`${origin}/__before/`);
    assert.equal(before.status, 200);
    assert.equal(await before.text(), '<link href="/__before/assets/site.css" rel="stylesheet"><script src="/__before/assets/site.js"></script><p>before</p>');
    assert.equal(await (await fetch(`${origin}/__before/assets/site.js`)).text(), 'console.log("before")');
    assert.equal(await (await fetch(`${origin}/__before/assets/site.css`)).text(), "/* before */");
    assert.equal(await (await fetch(`${origin}/assets/site.js`)).text(), 'console.log("after")');
    assert.equal(await (await fetch(`${origin}/assets/old-lazy.js`)).text(), 'console.log("old lazy")');
    assert.match(await (await fetch(origin)).text(), /<p>after<\/p>/u);
    assert.equal((await fetch(`${origin}/__before/assets/missing.js`)).status, 404);
    assert.equal((await fetch(`${origin}/api/settings`, { method: "PATCH" })).status, 405);
  } finally {
    const exit = once(child, "exit"); child.kill("SIGTERM"); await exit;
    await rm(root, { recursive: true, force: true });
  }
});
