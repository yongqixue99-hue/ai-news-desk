import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  acquireWindowsServiceLogLock,
  classifyWindowsServiceLogEncoding,
  prepareWindowsServiceLog,
} from "./windows-service-log.js";

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

const temporaryLogPath = () =>
  path.join(mkdtempSync(path.join(os.tmpdir(), "ai-news-desk-service-log-")), "windows-service.log");

test("classifies BOM and BOM-less UTF-16 service logs before UTF-8 validation", () => {
  const utf16WithBom = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("2026-08-31 INFO 旧日志\r\n", "utf16le"),
    Buffer.from("2026-08-31 INFO newly appended UTF-8\n", "utf8"),
  ]);
  assert.equal(classifyWindowsServiceLogEncoding(utf16WithBom), "utf16le-bom");
  assert.equal(
    classifyWindowsServiceLogEncoding(Buffer.from("2026-08-31 INFO old log\r\n", "utf16le")),
    "probable-utf16le",
  );
  assert.equal(
    classifyWindowsServiceLogEncoding(Buffer.from("ab\n", "utf16le")),
    "probable-utf16le",
  );
});

test("preserves a mixed legacy log and starts a PowerShell-readable UTF-8 log", () => {
  const logPath = temporaryLogPath();
  const original = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("2026-08-31 INFO 旧日志\r\n", "utf16le"),
    Buffer.from("2026-08-31 INFO appended UTF-8\n", "utf8"),
  ]);
  writeFileSync(logPath, original);

  const result = prepareWindowsServiceLog({
    logPath,
    maximumLogBytes: 5 * 1024 * 1024,
    retainedLogs: 3,
    now: new Date("2026-08-31T03:04:05.678Z"),
  });

  assert.equal(result.archiveReason, "legacy-encoding");
  assert.equal(result.encoding, "utf16le-bom");
  assert.match(result.archivedPath ?? "", /legacy-utf16le-bom-20260831T030405678Z$/u);
  assert.deepEqual(readFileSync(result.archivedPath!), original);
  assert.deepEqual(readFileSync(logPath), UTF8_BOM);

  writeFileSync(logPath, Buffer.from("2026-08-31 INFO 新日志\n", "utf8"), { flag: "a" });
  assert.doesNotThrow(() => new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(logPath)));
});

test("archives a BOM-less UTF-8 log once so PowerShell 5.1 can read future Chinese lines", () => {
  const logPath = temporaryLogPath();
  const original = Buffer.from("2026-08-31 INFO 已是 UTF-8\n", "utf8");
  writeFileSync(logPath, original);

  const result = prepareWindowsServiceLog({
    logPath,
    maximumLogBytes: 5 * 1024 * 1024,
    retainedLogs: 3,
  });

  assert.equal(result.encoding, "utf8");
  assert.equal(result.archiveReason, "utf8-bom-upgrade");
  assert.deepEqual(readFileSync(result.archivedPath!), original);
  assert.deepEqual(readFileSync(logPath), UTF8_BOM);

  const secondResult = prepareWindowsServiceLog({
    logPath,
    maximumLogBytes: 5 * 1024 * 1024,
    retainedLogs: 3,
  });
  assert.equal(secondResult.encoding, "utf8-bom");
  assert.equal(secondResult.archivedPath, undefined);
});

test("moves an invalid non-UTF-8 log aside without losing its bytes", () => {
  const logPath = temporaryLogPath();
  const original = Buffer.from([0x32, 0x30, 0x32, 0x36, 0x0a, 0xc3, 0x28]);
  writeFileSync(logPath, original);

  const result = prepareWindowsServiceLog({
    logPath,
    maximumLogBytes: 5 * 1024 * 1024,
    retainedLogs: 3,
    now: new Date("2026-08-31T03:04:05.678Z"),
  });

  assert.equal(result.encoding, "invalid-utf8");
  assert.deepEqual(readFileSync(result.archivedPath!), original);
  assert.deepEqual(readFileSync(logPath), UTF8_BOM);
});

test("keeps an oversized legacy-encoded log in permanent legacy storage", () => {
  const logPath = temporaryLogPath();
  const original = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("oversized legacy log\n".repeat(20), "utf16le"),
  ]);
  writeFileSync(logPath, original);

  const result = prepareWindowsServiceLog({
    logPath,
    maximumLogBytes: 32,
    retainedLogs: 3,
    now: new Date("2026-08-31T03:04:05.678Z"),
  });

  assert.equal(result.archiveReason, "legacy-encoding");
  assert.match(result.archivedPath ?? "", /\.legacy-utf16le-bom-/u);
  assert.deepEqual(readFileSync(result.archivedPath!), original);
  assert.deepEqual(readFileSync(logPath), UTF8_BOM);
});

test("an active OS lock rejects a competing writer before it can touch the log", async () => {
  const logPath = temporaryLogPath();
  const original = Buffer.from("do not touch", "utf8");
  writeFileSync(logPath, original);
  const first = await acquireWindowsServiceLogLock({ logPath });

  await assert.rejects(
    acquireWindowsServiceLogLock({ logPath }),
    /already owned by another active process/u,
  );
  assert.deepEqual(readFileSync(logPath), original);

  await first.release();
  const next = await acquireWindowsServiceLogLock({ logPath });
  await next.release();
});
