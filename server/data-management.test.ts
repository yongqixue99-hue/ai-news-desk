import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createPortableWorkflowArchive, createWorkflowBackup, verifyWorkflowBackup } from "./data-management.js";
import { LocalDatabase } from "./local-database.js";

test("workflow backups are checksummed and round-trip the complete state", () => {
  const state = createDefaultState();
  const backup = createWorkflowBackup(state, "2026-08-13T00:00:00.000Z");
  assert.equal(verifyWorkflowBackup(backup).state.settings.scheduleTime, state.settings.scheduleTime);
  state.settings.scheduleTime = "01:23";
  assert.notEqual(backup.state.settings.scheduleTime, state.settings.scheduleTime);
});

test("a modified backup is rejected instead of silently restoring partial data", () => {
  const backup = createWorkflowBackup(createDefaultState());
  backup.state.settings.scheduleTime = "09:00";
  assert.throws(() => verifyWorkflowBackup(backup), /校验失败/);
});

test("portable archive contains a consistent database, media, materials and checksummed manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-portable-backup-"));
  const state = createDefaultState();
  const legacyStatePath = path.join(root, "state.json");
  await writeFile(legacyStatePath, JSON.stringify(state), "utf8");
  await mkdir(path.join(root, "media"));
  await mkdir(path.join(root, "materials"));
  await writeFile(path.join(root, "media", "draft-image.png"), "image-bytes", "utf8");
  await writeFile(path.join(root, "materials", "source-chart.png"), "chart-bytes", "utf8");
  const database = await LocalDatabase.open({ workflowRoot: root, legacyStatePath, initialState: createDefaultState });
  try {
    const archive = await createPortableWorkflowArchive({
      workflowRoot: root,
      database,
      state,
      createdAt: "2026-08-30T12:00:00.000Z",
    });
    const entries = execFileSync("tar", ["-tzf", archive.archivePath], { encoding: "utf8" });
    assert.match(entries, /newsdesk\.db/u);
    assert.match(entries, /media\/draft-image\.png/u);
    assert.match(entries, /materials\/source-chart\.png/u);
    assert.match(entries, /state-backup\.json/u);
    assert.match(entries, /manifest\.json/u);
    assert.equal(archive.manifest.secretsIncluded, false);
    assert.ok(archive.manifest.files.every((file) => /^[a-f0-9]{64}$/u.test(file.sha256)));
    assert.ok(archive.manifest.files.some((file) => file.path === "newsdesk.db"));
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
