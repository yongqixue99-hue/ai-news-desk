import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, open, rm, stat, type FileHandle } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { createGunzip } from "node:zlib";
import { LOCAL_DATABASE_SCHEMA_VERSION } from "./local-database.js";
import { verifyWorkflowBackup, type PortableBackupManifest } from "./data-management.js";
import { WORKFLOW_STATE_VERSION, type WorkflowState } from "./types.js";

const TAR_BLOCK_BYTES = 512;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_STATE_BACKUP_BYTES = 256 * 1024 * 1024;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024 * 1024;
const DEFAULT_MAX_ENTRIES = 200_000;
const MAX_IGNORED_APPLEDOUBLE_ENTRY_BYTES = 64 * 1024 * 1024;
const MAX_IGNORED_APPLEDOUBLE_TOTAL_BYTES = 256 * 1024 * 1024;

export type PortableArchiveInspectionErrorCode =
  | "archive-unreadable"
  | "archive-too-large"
  | "archive-too-many-entries"
  | "archive-malformed"
  | "unsafe-entry"
  | "forbidden-entry"
  | "path-collision"
  | "manifest-missing"
  | "manifest-invalid"
  | "archive-incompatible"
  | "archive-integrity-failed";

export class PortableArchiveInspectionError extends Error {
  readonly code: PortableArchiveInspectionErrorCode;

  constructor(code: PortableArchiveInspectionErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortableArchiveInspectionError";
    this.code = code;
  }
}

export interface PortableArchiveInspectionReport {
  valid: true;
  archiveSha256: string;
  archiveBytes: number;
  payloadFileCount: number;
  payloadBytes: number;
  manifest: PortableBackupManifest;
}

export interface PortableArchiveInspectionOptions {
  maxUncompressedBytes?: number;
  maxEntries?: number;
}

export interface PortableArchiveSnapshotInspection {
  report: PortableArchiveInspectionReport;
  /** Verified state for server-side dry-run planning. Never serialize this object directly. */
  state: WorkflowState;
}

export interface VerifiedPortableArchive extends PortableArchiveSnapshotInspection {
  /** Ephemeral, verified extraction root. It only exists for the callback lifetime. */
  payloadRoot: string;
}

interface TarFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

interface WindowsArchivePath {
  path: string;
  kind: "file" | "directory";
}

class BufferedArchiveReader {
  private readonly iterator: AsyncIterator<Buffer>;
  private readonly maxBytes: number;
  private buffered: Buffer = Buffer.alloc(0);
  private ended = false;
  private bytesRead = 0;

  constructor(stream: NodeJS.ReadableStream, maxBytes: number) {
    this.iterator = stream[Symbol.asyncIterator]() as AsyncIterator<Buffer>;
    this.maxBytes = maxBytes;
  }

  private async fill() {
    if (this.ended) return false;
    const next = await this.iterator.next();
    if (next.done) {
      this.ended = true;
      return false;
    }
    const chunk = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    this.bytesRead += chunk.length;
    if (this.bytesRead > this.maxBytes) {
      throw new PortableArchiveInspectionError("archive-too-large", "完整归档解压后的内容超过安全上限");
    }
    this.buffered = this.buffered.length === 0 ? chunk : Buffer.concat([this.buffered, chunk]);
    return true;
  }

  async readExactly(bytes: number): Promise<Buffer | undefined> {
    while (this.buffered.length < bytes && await this.fill()) {
      // Continue until enough bytes are buffered or the stream ends.
    }
    if (this.buffered.length === 0 && this.ended) return undefined;
    if (this.buffered.length < bytes) {
      throw new PortableArchiveInspectionError("archive-malformed", "完整归档被截断，tar 数据块不完整");
    }
    const result = this.buffered.subarray(0, bytes);
    this.buffered = this.buffered.subarray(bytes);
    return result;
  }

  async consume(bytes: number, onChunk?: (chunk: Buffer) => void | Promise<void>) {
    let remaining = bytes;
    while (remaining > 0) {
      if (this.buffered.length === 0 && !await this.fill()) {
        throw new PortableArchiveInspectionError("archive-malformed", "完整归档被截断，文件内容不完整");
      }
      const size = Math.min(remaining, this.buffered.length);
      const chunk = this.buffered.subarray(0, size);
      this.buffered = this.buffered.subarray(size);
      remaining -= size;
      await onChunk?.(chunk);
    }
  }

  async consumeRemaining(onChunk: (chunk: Buffer) => void) {
    if (this.buffered.length > 0) {
      onChunk(this.buffered);
      this.buffered = Buffer.alloc(0);
    }
    while (await this.fill()) {
      if (this.buffered.length > 0) {
        onChunk(this.buffered);
        this.buffered = Buffer.alloc(0);
      }
    }
  }
}

const textField = (block: Buffer, offset: number, length: number) => {
  const field = block.subarray(offset, offset + length);
  const nul = field.indexOf(0);
  return field.subarray(0, nul < 0 ? field.length : nul).toString("utf8");
};

const octalField = (block: Buffer, offset: number, length: number) => {
  const value = textField(block, offset, length).replace(/\0/gu, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) {
    throw new PortableArchiveInspectionError("archive-malformed", "完整归档包含无法识别的 tar 数值字段");
  }
  return Number.parseInt(value, 8);
};

const verifyHeaderChecksum = (header: Buffer) => {
  const expected = octalField(header, 148, 8);
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index] ?? 0;
  }
  if (actual !== expected) {
    throw new PortableArchiveInspectionError("archive-malformed", "完整归档的 tar 头校验失败");
  }
};

const normalizedTarPath = (value: string) => value.replace(/\\/gu, "/").replace(/^(?:\.\/)+/u, "");

/**
 * Older macOS exports can contain AppleDouble sidecars even though those files
 * were never part of the manifest. We may discard a regular sidecar without
 * extracting it, but only after ruling out absolute and traversal paths. All
 * other entries continue through the strict cross-platform path validator.
 */
const ignorableAppleDoublePath = (value: string) => {
  const normalized = normalizedTarPath(value);
  const segments = normalized.split("/");
  if (!normalized
    || normalized.startsWith("/")
    || /^[A-Za-z]:/u.test(normalized)
    || segments.some((segment) => !segment || segment === "." || segment === ".." || /[\u0000-\u001f]/u.test(segment))) {
    return undefined;
  }
  return segments.at(-1)?.startsWith("._") ? normalized : undefined;
};

const safeTarPath = (value: string) => {
  const normalized = normalizedTarPath(value);
  const segments = normalized.split("/");
  const invalidWindowsSegment = segments.some((segment) => /[<>:"|?*\u0000-\u001f]/u.test(segment)
    || segment.endsWith(" ")
    || segment.endsWith(".")
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(segment)
    || Buffer.byteLength(segment, "utf16le") / 2 > 255);
  if (!normalized
    || normalized.startsWith("/")
    || /^[A-Za-z]:/u.test(normalized)
    || segments.includes("..")
    || invalidWindowsSegment) {
    throw new PortableArchiveInspectionError("unsafe-entry", `完整归档包含不安全路径：${value || "(empty)"}`);
  }
  return segments.filter((segment) => segment && segment !== ".").join("/");
};

const allowedPayloadPath = (entryPath: string) => entryPath === "newsdesk.db"
  || entryPath === "state-backup.json"
  || /^media\/.+/u.test(entryPath)
  || /^materials\/.+/u.test(entryPath);

const windowsPathKey = (entryPath: string) => entryPath.normalize("NFC").toLocaleLowerCase("en-US");

const registerWindowsPath = (
  paths: Map<string, WindowsArchivePath>,
  entryPath: string,
  kind: WindowsArchivePath["kind"],
) => {
  const key = windowsPathKey(entryPath);
  const existing = paths.get(key);
  if (existing) {
    throw new PortableArchiveInspectionError(
      "path-collision",
      `完整归档中的路径在 Windows 上会冲突：${existing.path} / ${entryPath}`,
    );
  }
  const segments = entryPath.split("/");
  for (let length = 1; length < segments.length; length += 1) {
    const ancestor = paths.get(windowsPathKey(segments.slice(0, length).join("/")));
    if (ancestor?.kind === "file") {
      throw new PortableArchiveInspectionError(
        "path-collision",
        `完整归档中的文件不能同时作为目录：${ancestor.path} / ${entryPath}`,
      );
    }
  }
  if (kind === "file") {
    const descendantPrefix = `${key}/`;
    const descendant = [...paths.entries()].find(([candidate]) => candidate.startsWith(descendantPrefix))?.[1];
    if (descendant) {
      throw new PortableArchiveInspectionError(
        "path-collision",
        `完整归档中的文件不能覆盖已有目录：${entryPath} / ${descendant.path}`,
      );
    }
  }
  paths.set(key, { path: entryPath, kind });
};

const headerPath = (header: Buffer) => {
  const name = textField(header, 0, 100);
  const prefix = textField(header, 345, 155);
  return normalizedTarPath(prefix ? `${prefix}/${name}` : name);
};

const paxValues = (buffer: Buffer) => {
  const values = new Map<string, string>();
  let offset = 0;
  while (offset < buffer.length) {
    const space = buffer.indexOf(32, offset);
    if (space < 0) break;
    const length = Number.parseInt(buffer.subarray(offset, space).toString("ascii"), 10);
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > buffer.length) {
      throw new PortableArchiveInspectionError("archive-malformed", "完整归档包含损坏的 PAX 元数据");
    }
    const record = buffer.subarray(space + 1, offset + length - 1).toString("utf8");
    const equals = record.indexOf("=");
    if (equals > 0) values.set(record.slice(0, equals), record.slice(equals + 1));
    offset += length;
  }
  return values;
};

const parseManifest = (buffer: Buffer): PortableBackupManifest => {
  let value: unknown;
  try {
    value = JSON.parse(buffer.toString("utf8"));
  } catch (error) {
    throw new PortableArchiveInspectionError("manifest-invalid", "完整归档的 manifest.json 不是有效 JSON", { cause: error });
  }
  if (!value || typeof value !== "object") {
    throw new PortableArchiveInspectionError("manifest-invalid", "完整归档的 manifest.json 不是有效对象");
  }
  const manifest = value as Partial<PortableBackupManifest>;
  if (manifest.format !== "ai-news-desk-portable-backup" || manifest.version !== 1) {
    throw new PortableArchiveInspectionError("archive-incompatible", "完整归档格式或版本不受当前工作台支持");
  }
  if (manifest.secretsIncluded !== false) {
    throw new PortableArchiveInspectionError("manifest-invalid", "完整归档声明包含密钥，已拒绝继续检查");
  }
  if (!Number.isInteger(manifest.databaseSchemaVersion) || manifest.databaseSchemaVersion! < 1
    || manifest.databaseSchemaVersion! > LOCAL_DATABASE_SCHEMA_VERSION) {
    throw new PortableArchiveInspectionError("archive-incompatible", "完整归档的数据库版本高于当前工作台支持范围");
  }
  if (!Number.isInteger(manifest.stateVersion) || manifest.stateVersion! < 1
    || manifest.stateVersion! > WORKFLOW_STATE_VERSION) {
    throw new PortableArchiveInspectionError("archive-incompatible", "完整归档的工作流状态版本高于当前工作台支持范围");
  }
  if (typeof manifest.createdAt !== "string" || !Number.isFinite(Date.parse(manifest.createdAt))) {
    throw new PortableArchiveInspectionError("manifest-invalid", "完整归档缺少有效的创建时间");
  }
  if (!Array.isArray(manifest.files)) {
    throw new PortableArchiveInspectionError("manifest-invalid", "完整归档缺少文件校验清单");
  }
  return manifest as PortableBackupManifest;
};

const readTarFiles = async (
  archivePath: string,
  options: PortableArchiveInspectionOptions,
  payloadRoot: string,
) => {
  const gunzip = createGunzip();
  const source = createReadStream(archivePath);
  const archiveHash = createHash("sha256");
  let archiveBytes = 0;
  source.on("data", (chunk: Buffer) => {
    archiveHash.update(chunk);
    archiveBytes += chunk.length;
  });
  source.on("error", (error) => gunzip.destroy(error));
  const reader = new BufferedArchiveReader(
    source.pipe(gunzip),
    options.maxUncompressedBytes ?? DEFAULT_MAX_UNCOMPRESSED_BYTES,
  );
  const files = new Map<string, TarFileRecord>();
  const windowsPaths = new Map<string, WindowsArchivePath>();
  let manifestBuffer: Buffer | undefined;
  let stateBackupBuffer: Buffer | undefined;
  let nextPaxPath: string | undefined;
  let nextLongPath: string | undefined;
  let entryCount = 0;
  let ignoredAppleDoubleBytes = 0;

  while (true) {
    const header = await reader.readExactly(TAR_BLOCK_BYTES);
    if (!header) {
      throw new PortableArchiveInspectionError("archive-malformed", "完整归档缺少 tar 结束标记");
    }
    if (header.every((byte) => byte === 0)) {
      const secondEndBlock = await reader.readExactly(TAR_BLOCK_BYTES);
      if (!secondEndBlock || !secondEndBlock.every((byte) => byte === 0)) {
        throw new PortableArchiveInspectionError("archive-malformed", "完整归档的 tar 结束标记不完整");
      }
      let hasTrailingContent = false;
      await reader.consumeRemaining((chunk) => {
        if (chunk.some((byte) => byte !== 0)) hasTrailingContent = true;
      });
      if (hasTrailingContent) {
        throw new PortableArchiveInspectionError("archive-malformed", "完整归档在 tar 结束标记后包含隐藏内容");
      }
      break;
    }
    entryCount += 1;
    if (entryCount > (options.maxEntries ?? DEFAULT_MAX_ENTRIES)) {
      throw new PortableArchiveInspectionError("archive-too-many-entries", "完整归档的文件条目数量超过安全上限");
    }
    verifyHeaderChecksum(header);
    const size = octalField(header, 124, 12);
    const typeFlag = String.fromCharCode(header[156] ?? 0);
    const rawPath = nextPaxPath ?? nextLongPath ?? headerPath(header);
    const isRegularFile = typeFlag === "0" || typeFlag === "\0";
    const appleDoubleEntryPath = isRegularFile ? ignorableAppleDoublePath(rawPath) : undefined;
    if (appleDoubleEntryPath) {
      ignoredAppleDoubleBytes += size;
      if (size > MAX_IGNORED_APPLEDOUBLE_ENTRY_BYTES
        || ignoredAppleDoubleBytes > MAX_IGNORED_APPLEDOUBLE_TOTAL_BYTES) {
        throw new PortableArchiveInspectionError("archive-too-large", "完整归档中的 macOS 元数据超过安全上限");
      }
    }
    const regularEntryPath = isRegularFile && !appleDoubleEntryPath ? safeTarPath(rawPath) : undefined;
    nextPaxPath = undefined;
    nextLongPath = undefined;
    const chunks: Buffer[] = [];
    const normalizedRawPath = normalizedTarPath(rawPath);
    const shouldBuffer = typeFlag === "x" || typeFlag === "g" || typeFlag === "L"
      || normalizedRawPath === "manifest.json" || normalizedRawPath === "state-backup.json";
    const bufferLimit = normalizedRawPath === "state-backup.json" ? MAX_STATE_BACKUP_BYTES : MAX_MANIFEST_BYTES;
    if (shouldBuffer && size > bufferLimit) {
      throw new PortableArchiveInspectionError("archive-malformed", "完整归档的元数据文件异常过大");
    }
    let extractedFile: FileHandle | undefined;
    if (regularEntryPath) {
      registerWindowsPath(windowsPaths, regularEntryPath, "file");
      if (regularEntryPath !== "manifest.json" && !allowedPayloadPath(regularEntryPath)) {
        throw new PortableArchiveInspectionError("forbidden-entry", `完整归档包含不允许导入的文件：${regularEntryPath}`);
      }
      if (files.has(regularEntryPath)) {
        throw new PortableArchiveInspectionError("archive-malformed", `完整归档包含重复文件：${regularEntryPath}`);
      }
      if (regularEntryPath !== "manifest.json") {
        const extractedPath = path.join(payloadRoot, ...regularEntryPath.split("/"));
        await mkdir(path.dirname(extractedPath), { recursive: true });
        extractedFile = await open(extractedPath, "wx");
      }
    }
    const hash = createHash("sha256");
    try {
      await reader.consume(size, async (chunk) => {
        hash.update(chunk);
        if (shouldBuffer) chunks.push(Buffer.from(chunk));
        if (extractedFile) await extractedFile.write(chunk);
      });
    } finally {
      await extractedFile?.close();
    }
    const padding = (TAR_BLOCK_BYTES - (size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if (padding) await reader.consume(padding);
    const buffered = shouldBuffer ? Buffer.concat(chunks) : undefined;

    if (typeFlag === "x" || typeFlag === "g") {
      const paxPath = paxValues(buffered ?? Buffer.alloc(0)).get("path");
      if (typeFlag === "g" && paxPath) {
        throw new PortableArchiveInspectionError("unsafe-entry", "完整归档包含不允许的全局 PAX 路径覆盖");
      }
      if (typeFlag === "x" && paxPath) nextPaxPath = ignorableAppleDoublePath(paxPath) ?? safeTarPath(paxPath);
      continue;
    }
    if (typeFlag === "L") {
      const longPath = (buffered ?? Buffer.alloc(0)).toString("utf8").replace(/\0+$/gu, "");
      nextLongPath = ignorableAppleDoublePath(longPath) ?? safeTarPath(longPath);
      continue;
    }
    if (typeFlag === "5") {
      if (rawPath && rawPath !== "." && rawPath !== "./") {
        const directoryPath = safeTarPath(rawPath);
        registerWindowsPath(windowsPaths, directoryPath, "directory");
      }
      continue;
    }
    if (typeFlag === "1" || typeFlag === "2") {
      throw new PortableArchiveInspectionError("unsafe-entry", `完整归档包含不允许的文件链接：${rawPath}`);
    }
    if (typeFlag !== "0" && typeFlag !== "\0") {
      throw new PortableArchiveInspectionError("archive-malformed", `完整归档包含不支持的 tar 条目类型：${typeFlag || "unknown"}`);
    }
    if (appleDoubleEntryPath) continue;
    const entryPath = regularEntryPath ?? safeTarPath(rawPath);
    files.set(entryPath, { path: entryPath, bytes: size, sha256: hash.digest("hex") });
    if (entryPath === "manifest.json") manifestBuffer = buffered;
    if (entryPath === "state-backup.json") stateBackupBuffer = buffered;
  }
  return { files, manifestBuffer, stateBackupBuffer, archiveSha256: archiveHash.digest("hex"), archiveBytes };
};

const databaseSnapshotFor = (databasePath: string) => {
  let database: DatabaseSync | undefined;
  try {
    database = new DatabaseSync(databasePath, { readOnly: true });
    const row = database.prepare("SELECT value FROM metadata WHERE key = 'schema_version'").get() as { value?: unknown } | undefined;
    const version = Number(row?.value);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("missing schema version");
    }
    const rows = database.prepare("SELECT key, value_json, checksum FROM state_fragments ORDER BY key").all() as unknown as Array<{
      key: string;
      value_json: string;
      checksum: string;
    }>;
    if (rows.length === 0) throw new Error("missing state fragments");
    const state: Record<string, unknown> = {};
    for (const row of rows) {
      if (createHash("sha256").update(row.value_json).digest("hex") !== row.checksum) {
        throw new Error(`invalid state fragment: ${row.key}`);
      }
      state[row.key] = JSON.parse(row.value_json) as unknown;
    }
    return { version, state };
  } catch (error) {
    throw new PortableArchiveInspectionError("archive-integrity-failed", "完整归档内的 SQLite 数据库无法只读校验", { cause: error });
  } finally {
    database?.close();
  }
};

const verifyPortableArchiveIn = async (
  archivePath: string,
  options: PortableArchiveInspectionOptions,
  stagingRoot: string,
): Promise<VerifiedPortableArchive> => {
  try {
    if (!(await stat(archivePath)).isFile()) throw new Error("not a file");
  } catch (error) {
    throw new PortableArchiveInspectionError("archive-unreadable", "无法读取指定的完整归档文件", { cause: error });
  }

    let parsed;
    try {
      parsed = await readTarFiles(archivePath, options, stagingRoot);
    } catch (error) {
      if (error instanceof PortableArchiveInspectionError) throw error;
      throw new PortableArchiveInspectionError("archive-malformed", "完整归档不是有效的 gzip/tar 文件", { cause: error });
    }
    if (!parsed.manifestBuffer) {
      throw new PortableArchiveInspectionError("manifest-missing", "完整归档缺少 manifest.json");
    }
    const manifest = parseManifest(parsed.manifestBuffer);
    const payloadFiles = new Map(parsed.files);
    payloadFiles.delete("manifest.json");
    const expectedPaths = new Set<string>();
    for (const expected of manifest.files) {
      if (!expected || typeof expected.path !== "string" || typeof expected.sha256 !== "string"
        || !Number.isSafeInteger(expected.bytes) || expected.bytes < 0) {
        throw new PortableArchiveInspectionError("manifest-invalid", "完整归档的文件校验清单包含无效记录");
      }
      const expectedPath = safeTarPath(expected.path);
      if (expectedPaths.has(expectedPath)) {
        throw new PortableArchiveInspectionError("manifest-invalid", `manifest 包含重复文件：${expectedPath}`);
      }
      expectedPaths.add(expectedPath);
      const actual = payloadFiles.get(expectedPath);
      if (!actual || actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256) {
        throw new PortableArchiveInspectionError("archive-integrity-failed", `完整归档文件校验失败：${expectedPath}`);
      }
    }
    const unlisted = [...payloadFiles.keys()].filter((entryPath) => !expectedPaths.has(entryPath));
    if (unlisted.length > 0 || expectedPaths.size !== payloadFiles.size) {
      throw new PortableArchiveInspectionError("archive-integrity-failed", "完整归档的实际文件集合与 manifest 不一致");
    }
    for (const required of ["newsdesk.db", "state-backup.json"]) {
      if (!payloadFiles.has(required)) {
        throw new PortableArchiveInspectionError("archive-integrity-failed", `完整归档缺少必要文件：${required}`);
      }
    }
    let stateBackup;
    try {
      stateBackup = verifyWorkflowBackup(JSON.parse(parsed.stateBackupBuffer?.toString("utf8") ?? ""));
    } catch (error) {
      throw new PortableArchiveInspectionError(
        "archive-integrity-failed",
        "完整归档的状态快照与 manifest 不一致",
        { cause: error },
      );
    }
    const innerStateVersion = (stateBackup.state as { version?: unknown }).version;
    if (!Number.isInteger(innerStateVersion) || (innerStateVersion as number) < 1
      || (innerStateVersion as number) > WORKFLOW_STATE_VERSION) {
      throw new PortableArchiveInspectionError("archive-incompatible", "完整归档内的真实工作流状态版本不受支持");
    }
    if (stateBackup.checksum !== manifest.stateChecksum
      || stateBackup.stateVersion !== manifest.stateVersion
      || innerStateVersion !== manifest.stateVersion
      || stateBackup.exportedAt !== manifest.createdAt) {
      throw new PortableArchiveInspectionError("archive-integrity-failed", "完整归档的状态快照与 manifest 不一致");
    }
    const databaseSnapshot = databaseSnapshotFor(path.join(stagingRoot, "newsdesk.db"));
    const databaseSchemaVersion = databaseSnapshot.version;
    if (databaseSchemaVersion > LOCAL_DATABASE_SCHEMA_VERSION) {
      throw new PortableArchiveInspectionError("archive-incompatible", "完整归档内的真实 SQLite 版本高于当前工作台支持范围");
    }
    if (databaseSchemaVersion !== manifest.databaseSchemaVersion) {
      throw new PortableArchiveInspectionError("archive-integrity-failed", "完整归档内的 SQLite 版本与 manifest 不一致");
    }
    if (!isDeepStrictEqual(databaseSnapshot.state, stateBackup.state)) {
      throw new PortableArchiveInspectionError("archive-integrity-failed", "完整归档内的 SQLite 状态与状态快照不一致");
    }

    return {
      report: {
        valid: true,
        archiveSha256: parsed.archiveSha256,
        archiveBytes: parsed.archiveBytes,
        payloadFileCount: payloadFiles.size,
        payloadBytes: [...payloadFiles.values()].reduce((total, file) => total + file.bytes, 0),
        manifest,
      },
      state: stateBackup.state,
      payloadRoot: stagingRoot,
    };
};

export const withVerifiedPortableArchive = async <T>(
  archivePath: string,
  options: PortableArchiveInspectionOptions,
  action: (archive: VerifiedPortableArchive) => Promise<T> | T,
): Promise<T> => {
  const stagingRoot = await mkdtemp(path.join(os.tmpdir(), "ai-news-archive-inspection-"));
  try {
    return await action(await verifyPortableArchiveIn(archivePath, options, stagingRoot));
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
};

export const inspectPortableArchiveSnapshot = async (
  archivePath: string,
  options: PortableArchiveInspectionOptions = {},
): Promise<PortableArchiveSnapshotInspection> => withVerifiedPortableArchive(
  archivePath,
  options,
  ({ report, state }) => ({ report, state }),
);

export const inspectPortableArchive = async (
  archivePath: string,
  options: PortableArchiveInspectionOptions = {},
): Promise<PortableArchiveInspectionReport> => (await inspectPortableArchiveSnapshot(archivePath, options)).report;
