import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPortableWorkflowArchive } from "./data-management.js";
import { createDefaultState } from "./defaults.js";
import { LocalDatabase } from "./local-database.js";
import { previewPortableArchive } from "./portable-archive-preview.js";

test("portable archive preview reports contents and relocations without importing any files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-archive-preview-"));
  const sourceRoot = path.join(root, "source", ".workflow");
  const destinationRoot = path.join(root, "destination", ".workflow");
  const state = createDefaultState();
  state.aiSettings.skills = [];
  state.materials = [{
    id: "sony",
    title: "Sony Music",
    fileName: "sony.png",
    localPath: "/Users/editor/desk/.workflow/materials/sony.png",
    publicPath: "/materials/sony.png",
    attribution: "Sony Music",
    tags: ["Sony Music"], rights: "official", allowedPlatforms: [], entityTags: ["Sony Music"],
    fingerprint: "sony", createdAt: "2026-09-01T00:00:00.000Z",
  }];
  await mkdir(path.join(sourceRoot, "materials"), { recursive: true });
  await mkdir(path.join(sourceRoot, "media"), { recursive: true });
  await writeFile(path.join(sourceRoot, "materials", "sony.png"), "sony", "utf8");
  const legacyStatePath = path.join(sourceRoot, "state.json");
  await writeFile(legacyStatePath, JSON.stringify(state), "utf8");
  const database = await LocalDatabase.open({ workflowRoot: sourceRoot, legacyStatePath, initialState: createDefaultState });
  try {
    const archive = await createPortableWorkflowArchive({
      workflowRoot: sourceRoot,
      database,
      state,
      createdAt: "2026-09-01T00:00:00.000Z",
    });

    const preview = await previewPortableArchive(archive.archivePath, destinationRoot);

    assert.equal(preview.valid, true);
    assert.equal(preview.dryRun, true);
    assert.equal(preview.imported, false);
    assert.equal(preview.credentialsExcluded, true);
    assert.deepEqual(preview.contents, {
      sources: state.sources.length,
      runs: 0,
      drafts: 0,
      materials: 1,
      mediaFiles: 0,
      materialFiles: 1,
    });
    assert.deepEqual(preview.relocation.counts, { relocatable: 1, missing: 0, blocked: 0, unchanged: 0 });
    assert.equal(await stat(destinationRoot).catch(() => undefined), undefined);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
