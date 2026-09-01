import assert from "node:assert/strict";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPortableWorkflowArchive } from "./data-management.js";
import { createDefaultState } from "./defaults.js";
import { LocalDatabase } from "./local-database.js";
import { PortableArchiveUploadError, previewPortableArchiveUpload } from "./portable-archive-upload.js";

test("a streamed portable archive upload is previewed and its temporary file is removed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-upload-preview-"));
  const sourceRoot = path.join(root, "source", ".workflow");
  const temporaryParentDirectory = path.join(root, "uploads");
  await mkdir(path.join(sourceRoot, "media"), { recursive: true });
  await mkdir(path.join(sourceRoot, "materials"), { recursive: true });
  await mkdir(temporaryParentDirectory, { recursive: true });
  const state = createDefaultState();
  state.aiSettings.skills = [];
  const legacyStatePath = path.join(sourceRoot, "state.json");
  await writeFile(legacyStatePath, JSON.stringify(state), "utf8");
  const database = await LocalDatabase.open({ workflowRoot: sourceRoot, legacyStatePath, initialState: createDefaultState });
  try {
    const archive = await createPortableWorkflowArchive({ workflowRoot: sourceRoot, database, state });

    const preview = await previewPortableArchiveUpload(createReadStream(archive.archivePath), {
      windowsWorkflowRoot: path.join(root, "destination", ".workflow"),
      temporaryParentDirectory,
    });

    assert.equal(preview.dryRun, true);
    assert.equal(preview.imported, false);
    assert.deepEqual(await readdir(temporaryParentDirectory), []);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("archive upload stops at the compressed-byte limit and still cleans partial files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-upload-limit-"));
  try {
    await assert.rejects(
      previewPortableArchiveUpload(Readable.from([Buffer.alloc(9)]), {
        windowsWorkflowRoot: "E:\\desk\\.workflow",
        temporaryParentDirectory: root,
        maxCompressedBytes: 8,
      }),
      (error) => error instanceof PortableArchiveUploadError && error.code === "upload-too-large",
    );
    assert.deepEqual(await readdir(root), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
