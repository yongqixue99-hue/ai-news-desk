import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { checksumForState, createPortableWorkflowArchive, createWorkflowBackup } from "./data-management.js";
import { LOCAL_DATABASE_SCHEMA_VERSION, LocalDatabase } from "./local-database.js";
import { inspectPortableArchive, PortableArchiveInspectionError } from "./portable-archive-inspector.js";
import { WORKFLOW_STATE_VERSION } from "./types.js";

const tarHeader = (name: string, bytes: number, type = "0", linkName = "") => {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, "utf8");
  const writeOctal = (value: number, offset: number, length: number) => {
    header.write(`${value.toString(8).padStart(length - 1, "0")}\0`, offset, length, "ascii");
  };
  writeOctal(0o644, 100, 8);
  writeOctal(0, 108, 8);
  writeOctal(0, 116, 8);
  writeOctal(bytes, 124, 12);
  writeOctal(0, 136, 12);
  header.fill(32, 148, 156);
  header.write(type, 156, 1, "ascii");
  header.write(linkName, 157, 100, "utf8");
  header.write("ustar\0", 257, 6, "ascii");
  header.write("00", 263, 2, "ascii");
  const checksum = header.reduce((total, byte) => total + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148, 8, "ascii");
  return header;
};

const writeTarGzip = async (
  archivePath: string,
  entries: Array<{ name: string; content?: string; type?: string; linkName?: string }>,
  trailingEntries: Array<{ name: string; content?: string; type?: string; linkName?: string }> = [],
  trailingZeroBytes = 0,
) => {
  const blocks: Buffer[] = [];
  const appendEntries = (items: typeof entries) => items.forEach((entry) => {
    const content = Buffer.from(entry.content ?? "", "utf8");
    blocks.push(tarHeader(entry.name, content.length, entry.type, entry.linkName), content);
    const padding = (512 - (content.length % 512)) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  });
  appendEntries(entries);
  blocks.push(Buffer.alloc(1024));
  appendEntries(trailingEntries);
  if (trailingEntries.length > 0) blocks.push(Buffer.alloc(1024));
  if (trailingZeroBytes > 0) blocks.push(Buffer.alloc(trailingZeroBytes));
  await writeFile(archivePath, gzipSync(Buffer.concat(blocks)));
};

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const paxRecord = (key: string, value: string) => {
  const body = `${key}=${value}\n`;
  let length = Buffer.byteLength(body) + 2;
  while (true) {
    const record = `${length} ${body}`;
    const actualLength = Buffer.byteLength(record);
    if (actualLength === length) return record;
    length = actualLength;
  }
};

const portableManifest = (files: Array<{ path: string; content: string }>, overrides: Record<string, unknown> = {}) => ({
  format: "ai-news-desk-portable-backup",
  version: 1,
  createdAt: "2026-08-30T12:00:00.000Z",
  databaseSchemaVersion: LOCAL_DATABASE_SCHEMA_VERSION,
  stateVersion: WORKFLOW_STATE_VERSION,
  stateChecksum: "a".repeat(64),
  secretsIncluded: false,
  files: files.map((file) => ({
    path: file.path,
    bytes: Buffer.byteLength(file.content),
    sha256: sha256(file.content),
  })),
  ...overrides,
});

test("a complete portable archive can be inspected without importing it", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-archive-inspection-"));
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

    const report = await inspectPortableArchive(archive.archivePath);

    assert.equal(report.valid, true);
    assert.equal(report.manifest.createdAt, "2026-08-30T12:00:00.000Z");
    assert.equal(report.manifest.databaseSchemaVersion, LOCAL_DATABASE_SCHEMA_VERSION);
    assert.equal(report.manifest.stateVersion, WORKFLOW_STATE_VERSION);
    assert.equal(report.payloadFileCount, 4);
    assert.ok(report.payloadBytes > 0);
    assert.match(report.archiveSha256, /^[a-f0-9]{64}$/u);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects a parent traversal path before any extraction", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-unsafe-archive-"));
  const archivePath = path.join(root, "unsafe.tar.gz");
  try {
    await writeTarGzip(archivePath, [{ name: "../escape.txt", content: "escape" }]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "unsafe-entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects symbolic links instead of following them", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-linked-archive-"));
  const archivePath = path.join(root, "linked.tar.gz");
  try {
    await writeTarGzip(archivePath, [{
      name: "media/company-logo.png",
      type: "2",
      linkName: "../../outside.png",
    }]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "unsafe-entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects a payload whose SHA-256 differs from the manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-tampered-archive-"));
  const archivePath = path.join(root, "tampered.tar.gz");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: "{}" },
  ];
  const manifest = portableManifest(files);
  manifest.files[0]!.sha256 = "0".repeat(64);
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-integrity-failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects undeclared payload categories even when they are checksummed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-forbidden-archive-"));
  const archivePath = path.join(root, "forbidden.tar.gz");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: "{}" },
    { path: "secrets.json", content: "do-not-import" },
  ];
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(portableManifest(files)) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "forbidden-entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection reports paths that would collide on Windows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-colliding-archive-"));
  const archivePath = path.join(root, "colliding.tar.gz");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: "{}" },
    { path: "media/Logo.png", content: "upper" },
    { path: "media/logo.png", content: "lower" },
  ];
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(portableManifest(files)) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "path-collision",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection cross-checks the state backup checksum against the manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-state-checksum-"));
  const archivePath = path.join(root, "state-checksum.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
  ];
  const manifest = portableManifest(files, { stateChecksum: "0".repeat(64) });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-integrity-failed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection stops when declared content exceeds the configured safety limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-oversized-archive-"));
  const archivePath = path.join(root, "oversized.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database-payload" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
  ];
  const manifest = portableManifest(files, { stateChecksum: backup.checksum });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath, { maxUncompressedBytes: 8 }),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-too-large",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects file names reserved by Windows", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-windows-name-"));
  const archivePath = path.join(root, "windows-name.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
    { path: "media/CON.png", content: "not-a-real-image" },
  ];
  const manifest = portableManifest(files, { stateChecksum: backup.checksum });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "unsafe-entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection bounds the number of tar entries", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-many-entry-archive-"));
  const archivePath = path.join(root, "many-entries.tar.gz");
  try {
    await writeTarGzip(archivePath, [
      { name: "newsdesk.db", content: "" },
      { name: "state-backup.json", content: "" },
      { name: "manifest.json", content: "" },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath, { maxEntries: 2 }),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-too-many-entries",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects hidden entries after the tar end marker", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-trailing-entry-"));
  const archivePath = path.join(root, "trailing-entry.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
  ];
  const manifest = portableManifest(files, { stateChecksum: backup.checksum });
  try {
    await writeTarGzip(
      archivePath,
      [
        ...files.map((file) => ({ name: file.path, content: file.content })),
        { name: "manifest.json", content: JSON.stringify(manifest) },
      ],
      [{ name: "secrets.json", content: "hidden" }],
    );

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-malformed",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects a global PAX path override", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-global-pax-"));
  const archivePath = path.join(root, "global-pax.tar.gz");
  try {
    await writeTarGzip(archivePath, [
      { name: "GlobalHead", type: "g", content: paxRecord("path", "../escape") },
      { name: "newsdesk.db", content: "database" },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "unsafe-entry",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects a directory and file with the same Windows path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-path-type-collision-"));
  const archivePath = path.join(root, "path-type-collision.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
    { path: "media/logo.png", content: "image" },
  ];
  const manifest = portableManifest(files, { stateChecksum: backup.checksum });
  try {
    await writeTarGzip(archivePath, [
      { name: "media/logo.png", type: "5" },
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "path-collision",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection checks the state version inside the verified backup", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-inner-state-version-"));
  const archivePath = path.join(root, "inner-state-version.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  (backup.state as unknown as { version: number }).version = 99;
  backup.checksum = checksumForState(backup.state);
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
  ];
  const manifest = portableManifest(files, { stateChecksum: backup.checksum });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);

    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-incompatible",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection verifies the SQLite schema version instead of trusting the manifest", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-database-version-"));
  const state = createDefaultState();
  const legacyStatePath = path.join(root, "state.json");
  const staging = path.join(root, "altered");
  const alteredArchivePath = path.join(root, "altered.tar.gz");
  await writeFile(legacyStatePath, JSON.stringify(state), "utf8");
  const database = await LocalDatabase.open({ workflowRoot: root, legacyStatePath, initialState: createDefaultState });
  try {
    const archive = await createPortableWorkflowArchive({
      workflowRoot: root,
      database,
      state,
      createdAt: "2026-08-30T12:00:00.000Z",
    });
    await mkdir(staging);
    execFileSync("tar", ["-xzf", archive.archivePath, "-C", staging]);
    const manifestPath = path.join(staging, "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.databaseSchemaVersion = LOCAL_DATABASE_SCHEMA_VERSION - 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    execFileSync("tar", ["-czf", alteredArchivePath, "-C", staging, "."]);

    await assert.rejects(
      inspectPortableArchive(alteredArchivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-integrity-failed",
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects a manifest from a newer database schema", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-new-schema-"));
  const archivePath = path.join(root, "new-schema.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
  ];
  const manifest = portableManifest(files, {
    databaseSchemaVersion: LOCAL_DATABASE_SCHEMA_VERSION + 1,
    stateChecksum: backup.checksum,
  });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);
    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-incompatible",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects any manifest that claims secrets are included", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-secret-manifest-"));
  const archivePath = path.join(root, "secret-manifest.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
  ];
  const manifest = portableManifest(files, {
    secretsIncluded: true,
    stateChecksum: backup.checksum,
  });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);
    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "manifest-invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection rejects a file that is also another file's parent path", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-parent-file-"));
  const archivePath = path.join(root, "parent-file.tar.gz");
  const backup = createWorkflowBackup(createDefaultState(), "2026-08-30T12:00:00.000Z");
  const files = [
    { path: "newsdesk.db", content: "database" },
    { path: "state-backup.json", content: JSON.stringify(backup) },
    { path: "media/section", content: "parent-file" },
    { path: "media/section/logo.png", content: "child-file" },
  ];
  const manifest = portableManifest(files, { stateChecksum: backup.checksum });
  try {
    await writeTarGzip(archivePath, [
      ...files.map((file) => ({ name: file.path, content: file.content })),
      { name: "manifest.json", content: JSON.stringify(manifest) },
    ]);
    await assert.rejects(
      inspectPortableArchive(archivePath),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "path-collision",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("archive inspection counts zero-filled tar tail data toward the decompression limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-zero-tail-"));
  const archivePath = path.join(root, "zero-tail.tar.gz");
  try {
    await writeTarGzip(
      archivePath,
      [
        { name: "newsdesk.db", content: "db" },
        { name: "state-backup.json", content: "{}" },
        { name: "manifest.json", content: "{}" },
      ],
      [],
      64 * 1024,
    );
    await assert.rejects(
      inspectPortableArchive(archivePath, { maxUncompressedBytes: 8 * 1024 }),
      (error) => error instanceof PortableArchiveInspectionError && error.code === "archive-too-large",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
