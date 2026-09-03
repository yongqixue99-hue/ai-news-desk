import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resolveCodexExecutable } from "./codex-executable.js";

test("Windows resolves the newest Codex Desktop executable without relying on PATH", async (context) => {
  const localAppData = await mkdtemp(path.join(os.tmpdir(), "newsdesk-codex-path-"));
  context.after(() => rm(localAppData, { recursive: true, force: true }));
  const oldExecutable = path.join(localAppData, "OpenAI", "Codex", "bin", "old-build", "codex.exe");
  const currentExecutable = path.join(localAppData, "OpenAI", "Codex", "bin", "current-build", "codex.exe");
  await mkdir(path.dirname(oldExecutable), { recursive: true });
  await mkdir(path.dirname(currentExecutable), { recursive: true });
  await writeFile(oldExecutable, "old");
  await writeFile(currentExecutable, "current");
  await utimes(oldExecutable, new Date("2026-09-01T00:00:00Z"), new Date("2026-09-01T00:00:00Z"));
  await utimes(currentExecutable, new Date("2026-09-03T00:00:00Z"), new Date("2026-09-03T00:00:00Z"));

  assert.equal(resolveCodexExecutable({
    platform: "win32",
    localAppData,
    userProfile: undefined,
  }), currentExecutable);
});
