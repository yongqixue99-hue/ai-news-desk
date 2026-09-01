import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPortableWorkflowArchive } from "./data-management.js";
import { createDefaultState } from "./defaults.js";
import { LocalDatabase } from "./local-database.js";
import { importPortableArchive } from "./portable-archive-importer.js";

const makeDatabase = async (root: string, state = createDefaultState()) => {
  await mkdir(root, { recursive: true });
  return LocalDatabase.open({ workflowRoot: root, initialState: () => state });
};

const makeArchive = async (root: string) => {
  const state = createDefaultState();
  state.settings.windowHours = 72;
  state.aiSettings.skills = [];
  state.materials = [{
    id: "material_sony", title: "Sony Music", fileName: "sony.png",
    localPath: "/Users/editor/desk/.workflow/materials/sony.png",
    publicPath: "/materials/sony.png", attribution: "Sony Music", tags: ["Sony Music"], rights: "official",
    allowedPlatforms: ["wechat"], entityTags: ["Sony Music"], fingerprint: "sony", createdAt: "2026-09-01T00:00:00.000Z",
  }];
  await mkdir(path.join(root, "media"), { recursive: true });
  await mkdir(path.join(root, "materials"), { recursive: true });
  await writeFile(path.join(root, "media", "story.png"), "new-story-image", "utf8");
  await writeFile(path.join(root, "materials", "sony.png"), "sony-official-image", "utf8");
  const database = await makeDatabase(root, state);
  try {
    return await createPortableWorkflowArchive({
      workflowRoot: root,
      database,
      state,
      createdAt: "2026-09-01T00:00:00.000Z",
    });
  } finally {
    database.close();
  }
};

test("confirmed portable import replaces state and managed files while retaining a local checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-portable-import-"));
  const sourceRoot = path.join(root, "source");
  const liveRoot = path.join(root, "live");
  const archive = await makeArchive(sourceRoot);
  const liveDatabase = await makeDatabase(liveRoot);
  await mkdir(path.join(liveRoot, "media"), { recursive: true });
  await mkdir(path.join(liveRoot, "materials"), { recursive: true });
  await writeFile(path.join(liveRoot, "media", "old.png"), "old-image", "utf8");
  await writeFile(path.join(liveRoot, "materials", "old.png"), "old-material", "utf8");
  try {
    const result = await importPortableArchive({
      archivePath: archive.archivePath,
      workflowRoot: liveRoot,
      database: liveDatabase,
    });

    assert.equal(result.imported, true);
    assert.equal(result.reused, false);
    assert.equal(result.contents.mediaFiles, 1);
    assert.equal(result.contents.materialFiles, 1);
    assert.equal(await readFile(path.join(liveRoot, "media", "story.png"), "utf8"), "new-story-image");
    assert.equal(await readFile(path.join(liveRoot, "materials", "sony.png"), "utf8"), "sony-official-image");
    await assert.rejects(access(path.join(liveRoot, "media", "old.png")), { code: "ENOENT" });
    const importedState = liveDatabase.readState<ReturnType<typeof createDefaultState>>();
    assert.equal(importedState.settings.windowHours, 72);
    assert.equal(importedState.materials[0]?.localPath, path.win32.join(liveRoot, "materials", "sony.png"));
    assert.equal(liveDatabase.hasWorkflowEvent("backup.portable_imported", result.archiveSha256), true);
    assert.ok(result.checkpointFileName);
    await access(path.join(liveRoot, "backups", result.checkpointFileName!));
  } finally {
    liveDatabase.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("the same portable archive is idempotent after its first successful import", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-portable-idempotent-"));
  const archive = await makeArchive(path.join(root, "source"));
  const liveRoot = path.join(root, "live");
  const liveDatabase = await makeDatabase(liveRoot);
  try {
    const first = await importPortableArchive({ archivePath: archive.archivePath, workflowRoot: liveRoot, database: liveDatabase });
    const second = await importPortableArchive({ archivePath: archive.archivePath, workflowRoot: liveRoot, database: liveDatabase });
    assert.equal(first.imported, true);
    assert.equal(second.imported, false);
    assert.equal(second.reused, true);
    assert.equal(second.checkpointFileName, undefined);
  } finally {
    liveDatabase.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("a database apply failure rolls managed files and state back to the pre-import checkpoint", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-portable-rollback-"));
  const archive = await makeArchive(path.join(root, "source"));
  const liveRoot = path.join(root, "live");
  const liveDatabase = await makeDatabase(liveRoot);
  await mkdir(path.join(liveRoot, "media"), { recursive: true });
  await mkdir(path.join(liveRoot, "materials"), { recursive: true });
  await writeFile(path.join(liveRoot, "media", "old.png"), "old-image", "utf8");
  await writeFile(path.join(liveRoot, "materials", "old.png"), "old-material", "utf8");
  try {
    await assert.rejects(
      importPortableArchive({
        archivePath: archive.archivePath,
        workflowRoot: liveRoot,
        database: liveDatabase,
        replaceDatabaseSnapshot: () => { throw new Error("simulated database apply failure"); },
      }),
      /simulated database apply failure/u,
    );
    assert.equal(await readFile(path.join(liveRoot, "media", "old.png"), "utf8"), "old-image");
    assert.equal(await readFile(path.join(liveRoot, "materials", "old.png"), "utf8"), "old-material");
    assert.equal(
      liveDatabase.readState<ReturnType<typeof createDefaultState>>().settings.windowHours,
      createDefaultState().settings.windowHours,
    );
  } finally {
    liveDatabase.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("portable import refuses to replace a workspace with unfinished background work", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-portable-active-job-"));
  const archive = await makeArchive(path.join(root, "source"));
  const liveRoot = path.join(root, "live");
  const liveDatabase = await makeDatabase(liveRoot);
  try {
    liveDatabase.enqueueJob({ type: "collect-run", idempotencyKey: "still-active", payload: { runId: "run-1" } });
    await assert.rejects(
      importPortableArchive({ archivePath: archive.archivePath, workflowRoot: liveRoot, database: liveDatabase }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "active-jobs",
    );
    assert.equal(liveDatabase.readState<ReturnType<typeof createDefaultState>>().settings.windowHours, createDefaultState().settings.windowHours);
    assert.equal(liveDatabase.hasWorkflowEvent("backup.portable_imported", "anything"), false);
  } finally {
    liveDatabase.close();
    await rm(root, { recursive: true, force: true });
  }
});
