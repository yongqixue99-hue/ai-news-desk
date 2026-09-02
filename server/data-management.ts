import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LOCAL_DATABASE_SCHEMA_VERSION, type LocalDatabase } from "./local-database.js";
import type { WorkflowState } from "./types.js";

const execFileAsync = promisify(execFile);

export const EXPORT_FORMAT = "ai-news-desk-backup" as const;
export const EXPORT_VERSION = 1 as const;

export interface WorkflowBackupEnvelope {
  format: typeof EXPORT_FORMAT;
  exportVersion: typeof EXPORT_VERSION;
  exportedAt: string;
  stateVersion: WorkflowState["version"];
  checksum: string;
  state: WorkflowState;
  /** Media files are intentionally not embedded; these paths identify the companion folders. */
  companionFiles: {
    included: false;
    directories: ["media", "materials"];
    note: string;
  };
}

export interface StorageUsage {
  stateBytes: number;
  backupBytes: number;
  databaseBytes: number;
  legacyStateBytes: number;
  mediaBytes: number;
  materialBytes: number;
  jobBytes: number;
  totalBytes: number;
}

export interface PortableBackupManifest {
  format: "ai-news-desk-portable-backup";
  version: 1;
  createdAt: string;
  databaseSchemaVersion: number;
  stateVersion: number;
  stateChecksum: string;
  secretsIncluded: false;
  files: Array<{ path: string; bytes: number; sha256: string }>;
}

const stablePayload = (state: WorkflowState) => JSON.stringify(state);

export const checksumForState = (state: WorkflowState) =>
  createHash("sha256").update(stablePayload(state)).digest("hex");

export const createWorkflowBackup = (
  state: WorkflowState,
  exportedAt = new Date().toISOString(),
): WorkflowBackupEnvelope => {
  const snapshot = structuredClone(state);
  return {
    format: EXPORT_FORMAT,
    exportVersion: EXPORT_VERSION,
    exportedAt,
    stateVersion: snapshot.version,
    checksum: checksumForState(snapshot),
    state: snapshot,
    companionFiles: {
      included: false,
      directories: ["media", "materials"],
      note: "图片文件未嵌入 JSON；完整迁移请同时复制 .workflow/media 与 .workflow/materials。",
    },
  };
};

export const verifyWorkflowBackup = (value: unknown): WorkflowBackupEnvelope => {
  if (!value || typeof value !== "object") throw new Error("备份文件不是有效 JSON 对象");
  const envelope = value as Partial<WorkflowBackupEnvelope>;
  if (envelope.format !== EXPORT_FORMAT || envelope.exportVersion !== EXPORT_VERSION) {
    throw new Error("不是当前工作台支持的备份格式");
  }
  if (!envelope.state || typeof envelope.state !== "object") throw new Error("备份缺少工作流状态");
  if (typeof envelope.checksum !== "string" || checksumForState(envelope.state) !== envelope.checksum) {
    throw new Error("备份校验失败，文件可能不完整或被修改");
  }
  return envelope as WorkflowBackupEnvelope;
};

const directoryBytes = async (directory: string): Promise<number> => {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) total += await directoryBytes(target);
    else if (entry.isFile()) total += (await stat(target).catch(() => undefined))?.size ?? 0;
  }
  return total;
};

const fileBytes = async (filePath: string) =>
  (await stat(filePath).catch(() => undefined))?.size ?? 0;

const filesBelow = async (directory: string, relative = ""): Promise<string[]> => {
  const files: string[] = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true }).catch(() => [])) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await filesBelow(directory, next));
    else if (entry.isFile()) files.push(next);
  }
  return files.sort();
};

const sha256ForFile = async (filePath: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const copyDirectoryIfPresent = async (source: string, destination: string) => {
  const info = await stat(source).catch(() => undefined);
  if (info?.isDirectory()) await cp(source, destination, { recursive: true, preserveTimestamps: true });
  else await mkdir(destination, { recursive: true });
};

/**
 * Builds a portable archive containing a consistent SQLite snapshot, media,
 * reusable materials and a checksummed manifest. Keychain credentials and
 * runtime job scratch files are intentionally outside the staging boundary.
 */
export const createPortableWorkflowArchive = async (input: {
  workflowRoot: string;
  database: LocalDatabase;
  state: WorkflowState;
  createdAt?: string;
}) => {
  const createdAt = input.createdAt ?? new Date().toISOString();
  const backupsRoot = path.join(input.workflowRoot, "backups");
  await mkdir(backupsRoot, { recursive: true });
  const staging = await mkdtemp(path.join(backupsRoot, ".portable-building-"));
  const databasePath = path.join(staging, "newsdesk.db");
  try {
    input.database.createSnapshot(databasePath);
    await copyDirectoryIfPresent(path.join(input.workflowRoot, "media"), path.join(staging, "media"));
    await copyDirectoryIfPresent(path.join(input.workflowRoot, "materials"), path.join(staging, "materials"));
    const lightBackup = createWorkflowBackup(input.state, createdAt);
    await writeFile(path.join(staging, "state-backup.json"), `${JSON.stringify(lightBackup, null, 2)}\n`, "utf8");

    const payloadFiles = await filesBelow(staging);
    const files = await Promise.all(payloadFiles.map(async (relativePath) => ({
      path: relativePath.split(path.sep).join("/"),
      bytes: await fileBytes(path.join(staging, relativePath)),
      sha256: await sha256ForFile(path.join(staging, relativePath)),
    })));
    const manifest: PortableBackupManifest = {
      format: "ai-news-desk-portable-backup",
      version: 1,
      createdAt,
      databaseSchemaVersion: LOCAL_DATABASE_SCHEMA_VERSION,
      stateVersion: input.state.version,
      stateChecksum: checksumForState(input.state),
      secretsIncluded: false,
      files,
    };
    await writeFile(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const fileName = `ai-news-desk-full-${createdAt.replace(/[:.]/gu, "-")}.tar.gz`;
    const archivePath = path.join(backupsRoot, fileName);
    await execFileAsync("tar", ["-czf", archivePath, "-C", staging, "."], {
      maxBuffer: 1024 * 1024,
      // macOS bsdtar otherwise serializes Finder/resource-fork metadata as
      // undeclared `._*` AppleDouble files. They are not application data and
      // make an otherwise valid portable archive fail its own manifest gate.
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    await prunePortableArchives(backupsRoot, 5);
    return { archivePath, fileName, manifest };
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
};

export const prunePortableArchives = async (backupsRoot: string, keep = 5) => {
  const entries = await readdir(backupsRoot, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const archives = entries
    .filter((entry) => entry.isFile() && /^ai-news-desk-full-.+\.tar\.gz$/u.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  const removedPaths = archives.slice(Math.max(0, Math.floor(keep))).map((name) => path.join(backupsRoot, name));
  await Promise.all(removedPaths.map((target) => rm(target, { force: true })));
  return { removed: removedPaths.length, removedPaths };
};

export const storageUsageFor = async (workflowRoot: string): Promise<StorageUsage> => {
  await mkdir(workflowRoot, { recursive: true });
  const [databaseBytes, walBytes, shmBytes, legacyStateBytes, legacyBackupBytes, migrationBackupBytes, mediaBytes, materialBytes, jobBytes] = await Promise.all([
    fileBytes(path.join(workflowRoot, "newsdesk.db")),
    fileBytes(path.join(workflowRoot, "newsdesk.db-wal")),
    fileBytes(path.join(workflowRoot, "newsdesk.db-shm")),
    fileBytes(path.join(workflowRoot, "state.json")),
    fileBytes(path.join(workflowRoot, "state.json.bak")),
    directoryBytes(path.join(workflowRoot, "backups")),
    directoryBytes(path.join(workflowRoot, "media")),
    directoryBytes(path.join(workflowRoot, "materials")),
    directoryBytes(path.join(workflowRoot, "jobs")),
  ]);
  const sqliteBytes = databaseBytes + walBytes + shmBytes;
  const backupBytes = legacyBackupBytes + migrationBackupBytes;
  return {
    stateBytes: sqliteBytes,
    backupBytes,
    databaseBytes: sqliteBytes,
    legacyStateBytes,
    mediaBytes,
    materialBytes,
    jobBytes,
    totalBytes: sqliteBytes + legacyStateBytes + backupBytes + mediaBytes + materialBytes + jobBytes,
  };
};
