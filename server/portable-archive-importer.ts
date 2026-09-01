import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createPortableWorkflowArchive } from "./data-management.js";
import { createDefaultState, upgradeState } from "./defaults.js";
import type { LocalDatabase } from "./local-database.js";
import { withVerifiedPortableArchive } from "./portable-archive-inspector.js";
import { rebasePortableArchiveState, type PortableArchiveRelocationPlan } from "./portable-archive-relocation.js";
import type { WorkflowState } from "./types.js";

const IMPORT_EVENT_TYPE = "backup.portable_imported";
let importActive = false;

export const isPortableArchiveImportActive = () => importActive;

export class PortableArchiveImportError extends Error {
  readonly code: "import-busy" | "active-jobs" | "archive-changed" | "post-import-verification-failed";

  constructor(code: PortableArchiveImportError["code"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PortableArchiveImportError";
    this.code = code;
  }
}

export interface PortableArchiveImportResult {
  imported: boolean;
  reused: boolean;
  archiveSha256: string;
  checkpointFileName?: string;
  contents: {
    sources: number;
    runs: number;
    drafts: number;
    materials: number;
    mediaFiles: number;
    materialFiles: number;
  };
  relocation: PortableArchiveRelocationPlan;
  warnings: string[];
}

export interface PortableArchiveImportOptions {
  archivePath: string;
  workflowRoot: string;
  database: LocalDatabase;
  expectedArchiveSha256?: string;
  /** Called after full verification and before the first durable write. */
  confirmArchive?: (archiveSha256: string) => void | Promise<void>;
  replaceDatabaseSnapshot?: (snapshotPath: string) => void | Promise<void>;
}

const pathExists = async (target: string) => Boolean(await stat(target).catch(() => undefined));

const filesBelow = async (root: string, relative = ""): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true }).catch(() => [])) {
    const next = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await filesBelow(root, next));
    else if (entry.isFile()) result.push(next.split(path.sep).join("/"));
  }
  return result.sort();
};

const sha256ForFile = async (filePath: string) => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
};

const verifyInstalledManagedFiles = async (
  workflowRoot: string,
  expectedFiles: Array<{ path: string; bytes: number; sha256: string }>,
) => {
  const expected = expectedFiles
    .filter((file) => file.path.startsWith("media/") || file.path.startsWith("materials/"))
    .sort((left, right) => left.path.localeCompare(right.path));
  const actualPaths = [
    ...await filesBelow(path.join(workflowRoot, "media")).then((files) => files.map((file) => `media/${file}`)),
    ...await filesBelow(path.join(workflowRoot, "materials")).then((files) => files.map((file) => `materials/${file}`)),
  ].sort();
  if (!isDeepStrictEqual(actualPaths, expected.map((file) => file.path))) {
    throw new PortableArchiveImportError("post-import-verification-failed", "导入后的图片文件集合与归档清单不一致");
  }
  for (const file of expected) {
    const target = path.join(workflowRoot, ...file.path.split("/"));
    const info = await stat(target);
    if (info.size !== file.bytes || await sha256ForFile(target) !== file.sha256) {
      throw new PortableArchiveImportError("post-import-verification-failed", `导入后的图片校验失败：${file.path}`);
    }
  }
};

const stageManagedDirectories = async (payloadRoot: string, workflowRoot: string) => {
  const id = randomUUID();
  const incomingRoot = path.join(workflowRoot, `.portable-import-${id}`);
  await mkdir(incomingRoot, { recursive: false });
  for (const directory of ["media", "materials"] as const) {
    const source = path.join(payloadRoot, directory);
    const destination = path.join(incomingRoot, directory);
    if (await pathExists(source)) await cp(source, destination, { recursive: true, preserveTimestamps: true });
    else await mkdir(destination, { recursive: true });
  }
  const records: Array<{ live: string; rollback: string; hadLive: boolean; installed: boolean }> = [];
  try {
    for (const directory of ["media", "materials"] as const) {
      const live = path.join(workflowRoot, directory);
      const rollback = path.join(workflowRoot, `.portable-import-rollback-${id}-${directory}`);
      const hadLive = await pathExists(live);
      if (hadLive) await rename(live, rollback);
      const record = { live, rollback, hadLive, installed: false };
      records.push(record);
      await rename(path.join(incomingRoot, directory), live);
      record.installed = true;
    }
  } catch (error) {
    for (const record of [...records].reverse()) {
      if (record.installed) await rm(record.live, { recursive: true, force: true }).catch(() => undefined);
      if (record.hadLive) await rename(record.rollback, record.live).catch(() => undefined);
    }
    await rm(incomingRoot, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return {
    async rollback() {
      for (const record of [...records].reverse()) {
        if (record.installed) await rm(record.live, { recursive: true, force: true });
        if (record.hadLive) await rename(record.rollback, record.live);
      }
      await rm(incomingRoot, { recursive: true, force: true });
    },
    async commit() {
      for (const record of records) if (record.hadLive) await rm(record.rollback, { recursive: true, force: true });
      await rm(incomingRoot, { recursive: true, force: true });
    },
  };
};

const contentsFor = (state: WorkflowState, manifestFiles: Array<{ path: string }>) => ({
  sources: state.sources?.length ?? 0,
  runs: state.runs?.length ?? 0,
  drafts: state.drafts?.length ?? 0,
  materials: state.materials?.length ?? 0,
  mediaFiles: manifestFiles.filter((file) => file.path.startsWith("media/")).length,
  materialFiles: manifestFiles.filter((file) => file.path.startsWith("materials/")).length,
});

export const importPortableArchive = async (
  options: PortableArchiveImportOptions,
): Promise<PortableArchiveImportResult> => {
  if (importActive) throw new PortableArchiveImportError("import-busy", "另一个完整归档导入正在进行中");
  importActive = true;
  try {
    return await withVerifiedPortableArchive(options.archivePath, {}, async (verified) => {
      if (options.expectedArchiveSha256 && verified.report.archiveSha256 !== options.expectedArchiveSha256) {
        throw new PortableArchiveImportError("archive-changed", "导入文件与刚才预检的归档不一致");
      }
      await options.confirmArchive?.(verified.report.archiveSha256);
      const upgradedState = upgradeState(structuredClone(verified.state));
      const rebased = rebasePortableArchiveState(
        upgradedState,
        verified.report.manifest,
        options.workflowRoot,
      );
      // SQLite JSON fragments intentionally canonicalize away undefined optional
      // properties, so verify against the exact representation that is persisted.
      const persistedState = JSON.parse(JSON.stringify(rebased.state)) as WorkflowState;
      const contents = contentsFor(persistedState, verified.report.manifest.files);
      const warnings = rebased.plan.entries
        .filter((entry) => entry.status === "missing" || entry.status === "blocked")
        .map((entry) => `${entry.ownerType}/${entry.ownerId}/${entry.field}：${entry.reason}`);
      if (options.database.hasWorkflowEvent(IMPORT_EVENT_TYPE, verified.report.archiveSha256)) {
        return {
          imported: false,
          reused: true,
          archiveSha256: verified.report.archiveSha256,
          contents,
          relocation: rebased.plan,
          warnings,
        };
      }
      const activeJobs = options.database.listJobs(500).filter((job) =>
        job.status === "queued" || job.status === "running" || job.status === "retrying");
      if (activeJobs.length > 0) {
        throw new PortableArchiveImportError("active-jobs", `仍有 ${activeJobs.length} 个后台任务未结束，暂不能覆盖工作台`);
      }

      const currentState = options.database.readState<WorkflowState>();
      const checkpoint = await createPortableWorkflowArchive({
        workflowRoot: options.workflowRoot,
        database: options.database,
        state: currentState,
      });
      const backupsRoot = path.join(options.workflowRoot, "backups");
      await mkdir(backupsRoot, { recursive: true });
      const rollbackDatabasePath = path.join(backupsRoot, `.portable-import-rollback-${randomUUID()}.db`);
      const readyDatabasePath = path.join(verified.payloadRoot, "ready.db");
      options.database.createSnapshot(rollbackDatabasePath);
      try {
        const importedDatabase = await (await import("./local-database.js")).LocalDatabase.open({
          workflowRoot: verified.payloadRoot,
          databasePath: path.join(verified.payloadRoot, "newsdesk.db"),
          initialState: createDefaultState,
        });
        try {
          importedDatabase.writeState(persistedState);
          importedDatabase.recordWorkflowEvent({
            type: IMPORT_EVENT_TYPE,
            subjectType: "backup",
            subjectId: verified.report.archiveSha256,
            payload: {
              checkpointFileName: checkpoint.fileName,
              relocatedPaths: rebased.plan.counts.relocatable,
              warnings: warnings.length,
            },
          });
          importedDatabase.createSnapshot(readyDatabasePath);
        } finally {
          importedDatabase.close();
        }

        const managedDirectories = await stageManagedDirectories(verified.payloadRoot, options.workflowRoot);
        const replaceDatabase = options.replaceDatabaseSnapshot
          ?? ((snapshotPath: string) => options.database.replaceFromSnapshot(snapshotPath));
        let databaseReplaced = false;
        try {
          await replaceDatabase(readyDatabasePath);
          databaseReplaced = true;
          await verifyInstalledManagedFiles(options.workflowRoot, verified.report.manifest.files);
          const installedState = options.database.readState<WorkflowState>();
          if (!isDeepStrictEqual(installedState, persistedState)
            || !options.database.hasWorkflowEvent(IMPORT_EVENT_TYPE, verified.report.archiveSha256)) {
            throw new PortableArchiveImportError("post-import-verification-failed", "导入后的数据库状态未通过一致性校验");
          }
          await managedDirectories.commit();
        } catch (error) {
          const rollbackErrors: unknown[] = [];
          if (databaseReplaced) {
            try { await replaceDatabase(rollbackDatabasePath); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
          }
          try { await managedDirectories.rollback(); } catch (rollbackError) { rollbackErrors.push(rollbackError); }
          if (rollbackErrors.length > 0) {
            throw new AggregateError([error, ...rollbackErrors], "完整归档导入失败，且自动回滚未能完整完成");
          }
          throw error;
        }
      } finally {
        await rm(rollbackDatabasePath, { force: true });
      }

      return {
        imported: true,
        reused: false,
        archiveSha256: verified.report.archiveSha256,
        checkpointFileName: checkpoint.fileName,
        contents,
        relocation: rebased.plan,
        warnings,
      };
    });
  } finally {
    importActive = false;
  }
};
