import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

type Entry = { id: string; source: string; date: string; bytes: number; sha256: string };
type Original = { path: string; bytes: number; sha256: string; chunks: string[] };
const checksum = (value: string) => createHash("sha256").update(value).digest("hex");

test("archived README and handoff reproduce every original byte in their original order", async () => {
  const manifest = JSON.parse(await readFile("docs/history/document-archive.json", "utf8")) as { entries: Entry[]; originals: Original[] };
  const log = await readFile("CHANGELOG.md", "utf8");
  const bodies = new Map<string, string>();
  let lastDate = "9999-99-99", lastOffset = -1;
  for (const entry of manifest.entries) {
    const marker = `<!-- legacy:${entry.id} -->\n`;
    const start = log.indexOf(marker);
    assert.ok(start >= 0, `Missing original ${entry.id}`);
    assert.equal(log.lastIndexOf(marker), start, `Duplicate original ${entry.id}`);
    assert.ok(start > lastOffset, "History is rendered in manifest order");
    assert.ok(entry.date <= lastDate, "History is in reverse chronological order");
    const end = log.indexOf(`\n<!-- end:${entry.id} -->`, start + marker.length);
    assert.ok(end > start);
    const body = log.slice(start + marker.length, end);
    assert.equal(Buffer.byteLength(body), entry.bytes, entry.id);
    assert.equal(checksum(body), entry.sha256, entry.id);
    bodies.set(entry.id, body); lastDate = entry.date; lastOffset = start;
  }
  for (const original of manifest.originals) {
    const restored = original.chunks.map(id => { assert.ok(bodies.has(id), id); return bodies.get(id)!; }).join("");
    assert.equal(Buffer.byteLength(restored), original.bytes, original.path);
    assert.equal(checksum(restored), original.sha256, original.path);
  }
  assert.deepEqual(manifest.originals.map(item => item.path), ["README.md", "docs/WINDOWS-DEVELOPMENT-HANDOFF.md"]);
});

test("README leads with purpose, startup, daily flow and working documentation links", async () => {
  const text = await readFile("README.md", "utf8");
  const headings = ["## 这是什么", "## 本地启动", "## 日常流程", "## 文档索引"];
  const offsets = headings.map(heading => text.indexOf(heading));
  assert.ok(offsets.every(offset => offset >= 0));
  assert.deepEqual([...offsets].sort((a, b) => a - b), offsets);
  assert.ok(offsets[1]! < text.indexOf("## 已实现的工作流"), "Startup precedes the feature reference");
  const index = text.slice(offsets[3], text.indexOf("## 已实现的工作流"));
  for (const file of ["AGENTS.md", "CHANGELOG.md", "docs/mature-personal-product.md", "docs/WINDOWS-DEVELOPMENT-HANDOFF.md", "docs/2026-10-07-optimization-plan.md", "docs/2026-10-07-optimization-progress.md"]) {
    assert.ok(index.includes(`](${file})`), file);
    await readFile(file);
  }
});

test("handoff exposes current status, locked decisions and next work without historical headings", async () => {
  const text = await readFile("docs/WINDOWS-DEVELOPMENT-HANDOFF.md", "utf8");
  for (const heading of ["## 当前状态", "## 已锁定的决定", "## 下一步"]) assert.ok(text.includes(heading), heading);
  assert.doesNotMatch(text, /^## .*2026-\d\d-\d\d/mu);
  assert.match(text, /\]\(\.\.\/CHANGELOG\.md\)/u);
  const agents = await readFile("AGENTS.md", "utf8");
  for (const file of ["README.md", "docs/mature-personal-product.md", "docs/WINDOWS-DEVELOPMENT-HANDOFF.md", "docs/2026-10-07-optimization-plan.md"]) {
    assert.ok(agents.includes(file)); await readFile(path.resolve(file));
  }
});
