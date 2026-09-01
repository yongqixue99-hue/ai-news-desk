import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export const LOCAL_DATABASE_SCHEMA_VERSION = 6;

export type DurableJobStatus = "queued" | "running" | "retrying" | "complete" | "failed" | "cancelled";

export interface DurableJobRecord {
  id: string;
  type: string;
  idempotencyKey: string;
  status: DurableJobStatus;
  payload: unknown;
  result?: unknown;
  progress: number;
  stage?: string;
  heartbeatAt?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  nextAttemptAt?: string;
  leaseOwner?: string;
  leaseExpiresAt?: string;
  error?: string;
}

export interface FeedbackEventRecord {
  id: string;
  type: string;
  subjectType: "signal" | "story" | "package" | "draft" | "delivery";
  subjectId: string;
  reason?: string;
  payload?: unknown;
  createdAt: string;
}

export interface WorkflowEventRecord {
  id: string;
  type: string;
  subjectType: string;
  subjectId: string;
  payload?: unknown;
  createdAt: string;
}

interface StateFragmentRow {
  key: string;
  value_json: string;
  checksum: string;
}

interface ContentPackageRow {
  id: string;
  story_id: string;
  mode: string;
  package_json: string;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

interface DiscussionSampleRow {
  sample_json: string;
  content_hash: string;
}

interface SourceSnapshotRow {
  url_key: string;
  requested_url: string;
  canonical_url: string;
  page_json: string;
  content_hash: string;
  captured_at: string;
}

export interface SourceSnapshotRecord<T> {
  urlKey: string;
  requestedUrl: string;
  canonicalUrl: string;
  page: T;
  capturedAt: string;
}

interface JobRow {
  id: string;
  type: string;
  idempotency_key: string;
  status: DurableJobStatus;
  payload_json: string;
  result_json: string | null;
  progress: number;
  stage: string | null;
  heartbeat_at: string | null;
  attempts: number;
  max_attempts: number;
  created_at: string;
  updated_at: string;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  error: string | null;
}

interface EditorialMemoryRow {
  id: string;
  kind: string;
  label: string;
  evidence_count: number;
  enabled: number;
  first_seen_at: string;
  last_seen_at: string;
  evidence_json: string;
}

export interface EditorialMemoryRecord {
  id: string;
  kind: string;
  label: string;
  evidenceCount: number;
  enabled: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
  evidence: Array<{ eventId: string; draftId: string; summary: string; createdAt: string }>;
}

const checksum = (value: string) => createHash("sha256").update(value).digest("hex");
const json = (value: unknown) => JSON.stringify(value);
const parseJson = (value: string | null) => value ? JSON.parse(value) as unknown : undefined;

const jobFromRow = (row: JobRow): DurableJobRecord => ({
  id: row.id,
  type: row.type,
  idempotencyKey: row.idempotency_key,
  status: row.status,
  payload: parseJson(row.payload_json),
  result: parseJson(row.result_json),
  progress: row.progress,
  stage: row.stage ?? undefined,
  heartbeatAt: row.heartbeat_at ?? undefined,
  attempts: row.attempts,
  maxAttempts: row.max_attempts,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  nextAttemptAt: row.next_attempt_at ?? undefined,
  leaseOwner: row.lease_owner ?? undefined,
  leaseExpiresAt: row.lease_expires_at ?? undefined,
  error: row.error ?? undefined,
});

export interface LocalDatabaseOptions {
  workflowRoot: string;
  databasePath?: string;
  legacyStatePath?: string;
  initialState: () => unknown;
  now?: () => string;
}

/**
 * LocalDatabase is the persistence seam for the personal workbench. It owns
 * migration, integrity checks, transactional state replacement, durable jobs
 * and append-only product events behind one small interface.
 */
export class LocalDatabase {
  readonly databasePath: string;
  private readonly db: DatabaseSync;
  private readonly now: () => string;

  private constructor(databasePath: string, db: DatabaseSync, now: () => string) {
    this.databasePath = databasePath;
    this.db = db;
    this.now = now;
  }

  static async open(options: LocalDatabaseOptions) {
    const databasePath = options.databasePath ?? path.join(options.workflowRoot, "newsdesk.db");
    const legacyStatePath = options.legacyStatePath ?? path.join(options.workflowRoot, "state.json");
    await mkdir(options.workflowRoot, { recursive: true });
    const db = new DatabaseSync(databasePath, { timeout: 5_000 });
    const store = new LocalDatabase(databasePath, db, options.now ?? (() => new Date().toISOString()));
    store.initializeSchema();
    await store.importLegacyStateIfNeeded(legacyStatePath, options.initialState);
    store.assertIntegrity();
    return store;
  }

  private initializeSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;

      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS state_fragments (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        checksum TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS workflow_jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        idempotency_key TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL CHECK (status IN ('queued','running','retrying','complete','failed','cancelled')),
        payload_json TEXT NOT NULL,
        result_json TEXT,
        progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
        stage TEXT,
        heartbeat_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        next_attempt_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        error TEXT
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_jobs_status_next_idx
        ON workflow_jobs(status, next_attempt_at, created_at);

      CREATE TABLE IF NOT EXISTS feedback_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        subject_type TEXT NOT NULL CHECK (subject_type IN ('signal','story','package','draft','delivery')),
        subject_id TEXT NOT NULL,
        reason TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS feedback_events_subject_idx
        ON feedback_events(subject_type, subject_id, created_at);

      CREATE TABLE IF NOT EXISTS workflow_events (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        subject_type TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        payload_json TEXT,
        created_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS workflow_events_created_idx
        ON workflow_events(created_at);

      CREATE TABLE IF NOT EXISTS content_packages (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        package_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS content_packages_story_idx
        ON content_packages(story_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS discussion_samples (
        id TEXT PRIMARY KEY,
        story_id TEXT NOT NULL,
        platform TEXT NOT NULL,
        author TEXT NOT NULL,
        permalink TEXT NOT NULL,
        branch_id TEXT,
        published_at TEXT,
        sample_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        captured_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS discussion_samples_story_idx
        ON discussion_samples(story_id, platform, published_at);

      CREATE TABLE IF NOT EXISTS source_snapshots (
        url_key TEXT PRIMARY KEY,
        requested_url TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        page_json TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        captured_at TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS source_snapshots_captured_idx
        ON source_snapshots(captured_at DESC);

      CREATE TABLE IF NOT EXISTS editorial_memories (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        evidence_count INTEGER NOT NULL DEFAULT 0 CHECK (evidence_count >= 0),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        evidence_json TEXT NOT NULL
      ) STRICT;
    `);
    const workflowJobColumns = new Set(
      (this.db.prepare("PRAGMA table_info(workflow_jobs)").all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!workflowJobColumns.has("stage")) this.db.exec("ALTER TABLE workflow_jobs ADD COLUMN stage TEXT");
    if (!workflowJobColumns.has("heartbeat_at")) this.db.exec("ALTER TABLE workflow_jobs ADD COLUMN heartbeat_at TEXT");
    this.db.prepare(`
      INSERT INTO metadata(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(LOCAL_DATABASE_SCHEMA_VERSION));
  }

  private async importLegacyStateIfNeeded(legacyStatePath: string, initialState: () => unknown) {
    const fragmentCount = Number((this.db.prepare("SELECT COUNT(*) AS count FROM state_fragments").get() as { count: number }).count);
    if (fragmentCount > 0) return;

    // Databases created by the first SQLite preview stored the entire state in
    // one row. Convert that row in-place so production never keeps rewriting a
    // multi-megabyte JSON document for a one-field edit.
    const legacyDatabaseRow = this.db.prepare("SELECT state_json, checksum FROM app_state WHERE id = 1").get() as {
      state_json: string;
      checksum: string;
    } | undefined;
    if (legacyDatabaseRow) {
      if (checksum(legacyDatabaseRow.state_json) !== legacyDatabaseRow.checksum) {
        throw new Error("旧版本地数据库状态校验失败");
      }
      this.writeState(JSON.parse(legacyDatabaseRow.state_json) as unknown);
      return;
    }

    let state: unknown;
    let legacyPayload: string | undefined;
    try {
      legacyPayload = await readFile(legacyStatePath, "utf8");
      state = JSON.parse(legacyPayload) as unknown;
      const backupDirectory = path.join(path.dirname(legacyStatePath), "backups");
      await mkdir(backupDirectory, { recursive: true });
      const migrationBackup = path.join(backupDirectory, "state-before-sqlite-v2.json");
      await copyFile(legacyStatePath, migrationBackup, constants.COPYFILE_EXCL).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      state = initialState();
    }

    this.writeState(state);
    const importedAt = this.now();
    this.db.prepare(`INSERT OR REPLACE INTO metadata(key, value) VALUES ('imported_at', ?)`).run(importedAt);
    if (legacyPayload) {
      this.db.prepare(`INSERT OR REPLACE INTO metadata(key, value) VALUES ('legacy_checksum', ?)`).run(checksum(legacyPayload));
    }
  }

  private assertIntegrity() {
    const result = this.db.prepare("PRAGMA quick_check").get() as { quick_check?: string } | undefined;
    if (!result || result.quick_check !== "ok") throw new Error("本地数据库完整性检查失败");
    const rows = this.db.prepare("SELECT key, value_json, checksum FROM state_fragments").all() as unknown as StateFragmentRow[];
    if (!rows.length || rows.some((row) => checksum(row.value_json) !== row.checksum)) {
      throw new Error("本地数据库状态校验失败");
    }
  }

  readState<T>(): T {
    const rows = this.db.prepare("SELECT key, value_json, checksum FROM state_fragments ORDER BY key").all() as unknown as StateFragmentRow[];
    if (!rows.length) throw new Error("本地数据库尚未初始化");
    const state: Record<string, unknown> = {};
    for (const row of rows) {
      if (checksum(row.value_json) !== row.checksum) throw new Error(`本地数据库状态切片损坏：${row.key}`);
      state[row.key] = JSON.parse(row.value_json) as unknown;
    }
    return state as T;
  }

  writeState(state: unknown) {
    if (!state || typeof state !== "object" || Array.isArray(state)) {
      throw new Error("本地状态必须是一个对象");
    }
    const fragments = Object.entries(state as Record<string, unknown>).map(([key, value]) => {
      const payload = json(value);
      return { key, payload, checksum: checksum(payload) };
    });
    const updatedAt = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const upsert = this.db.prepare(`
        INSERT INTO state_fragments(key, value_json, checksum, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          value_json = excluded.value_json,
          checksum = excluded.checksum,
          updated_at = excluded.updated_at
        WHERE state_fragments.checksum <> excluded.checksum
      `);
      for (const fragment of fragments) {
        upsert.run(fragment.key, fragment.payload, fragment.checksum, updatedAt);
      }
      const keys = new Set(fragments.map((fragment) => fragment.key));
      const existingKeys = this.db.prepare("SELECT key FROM state_fragments").all() as unknown as Array<{ key: string }>;
      const remove = this.db.prepare("DELETE FROM state_fragments WHERE key = ?");
      for (const row of existingKeys) if (!keys.has(row.key)) remove.run(row.key);
      const manifestPayload = json({ keys: [...keys].sort() });
      this.db.prepare(`
        INSERT INTO app_state(id, state_json, checksum, updated_at)
        VALUES (1, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          state_json = excluded.state_json,
          checksum = excluded.checksum,
          updated_at = excluded.updated_at
      `).run(manifestPayload, checksum(manifestPayload), updatedAt);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  enqueueJob(input: {
    type: string;
    idempotencyKey: string;
    payload: unknown;
    maxAttempts?: number;
  }): { job: DurableJobRecord; reused: boolean } {
    const current = this.db.prepare("SELECT * FROM workflow_jobs WHERE idempotency_key = ?").get(input.idempotencyKey) as JobRow | undefined;
    if (current && ["queued", "running", "retrying", "complete"].includes(current.status)) {
      return { job: jobFromRow(current), reused: true };
    }
    const createdAt = this.now();
    const job: DurableJobRecord = {
      id: `job_${randomUUID()}`,
      type: input.type,
      idempotencyKey: input.idempotencyKey,
      status: "queued",
      payload: structuredClone(input.payload),
      progress: 0,
      attempts: 0,
      maxAttempts: Math.max(1, Math.floor(input.maxAttempts ?? 3)),
      createdAt,
      updatedAt: createdAt,
    };
    this.db.prepare(`
      INSERT INTO workflow_jobs(
        id, type, idempotency_key, status, payload_json, progress,
        attempts, max_attempts, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        id = excluded.id,
        type = excluded.type,
        status = excluded.status,
        payload_json = excluded.payload_json,
        result_json = NULL,
        progress = excluded.progress,
        attempts = excluded.attempts,
        max_attempts = excluded.max_attempts,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        next_attempt_at = NULL,
        lease_owner = NULL,
        lease_expires_at = NULL,
        stage = NULL,
        heartbeat_at = NULL,
        error = NULL
    `).run(
      job.id,
      job.type,
      job.idempotencyKey,
      job.status,
      json(job.payload),
      job.progress,
      job.attempts,
      job.maxAttempts,
      job.createdAt,
      job.updatedAt,
    );
    return { job, reused: false };
  }

  listJobs(limit = 100): DurableJobRecord[] {
    return (this.db.prepare(`
      SELECT * FROM workflow_jobs ORDER BY created_at DESC LIMIT ?
    `).all(Math.max(1, Math.min(500, Math.floor(limit)))) as unknown as JobRow[]).map(jobFromRow);
  }

  getJob(jobId: string): DurableJobRecord | undefined {
    const row = this.db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(jobId) as unknown as JobRow | undefined;
    return row ? jobFromRow(row) : undefined;
  }

  cancelQueuedJob(idempotencyKey: string): DurableJobRecord | undefined {
    const updatedAt = this.now();
    this.db.prepare(`
      UPDATE workflow_jobs
      SET status = 'cancelled', updated_at = ?, next_attempt_at = NULL,
          lease_owner = NULL, lease_expires_at = NULL, stage = '已取消',
          heartbeat_at = ?, error = '已由用户取消'
      WHERE idempotency_key = ? AND status IN ('queued','retrying')
    `).run(updatedAt, updatedAt, idempotencyKey);
    const row = this.db.prepare("SELECT * FROM workflow_jobs WHERE idempotency_key = ?").get(idempotencyKey) as unknown as JobRow | undefined;
    return row ? jobFromRow(row) : undefined;
  }

  /** Called only after this process owns the HTTP port, so the old worker is gone. */
  recoverRunningJobs() {
    const recoveredAt = this.now();
    return this.db.prepare(`
      UPDATE workflow_jobs
      SET status = 'retrying', updated_at = ?, next_attempt_at = ?,
          lease_owner = NULL, lease_expires_at = NULL,
          stage = '等待自动重试', heartbeat_at = ?,
          error = '任务进程中断，已在启动时恢复'
      WHERE status = 'running'
    `).run(recoveredAt, recoveredAt, recoveredAt).changes;
  }

  claimNextJob(input: {
    workerId: string;
    types?: string[];
    leaseMs?: number;
  }): DurableJobRecord | undefined {
    const now = this.now();
    const leaseExpiresAt = new Date(Date.parse(now) + Math.max(5_000, input.leaseMs ?? 60_000)).toISOString();
    const types = [...new Set(input.types?.filter(Boolean) ?? [])];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // A process may die after claiming work. Expired leases become retryable
      // before the next selection, so a restart never strands the task.
      this.db.prepare(`
        UPDATE workflow_jobs
        SET status = 'retrying', lease_owner = NULL, lease_expires_at = NULL,
            next_attempt_at = ?, updated_at = ?, stage = '等待自动重试', heartbeat_at = ?,
            error = COALESCE(error, '任务进程中断，已自动恢复')
        WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= ?
      `).run(now, now, now, now);
      const typeClause = types.length ? `AND type IN (${types.map(() => "?").join(",")})` : "";
      const row = this.db.prepare(`
        SELECT * FROM workflow_jobs
        WHERE status IN ('queued','retrying')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
          ${typeClause}
        ORDER BY created_at ASC
        LIMIT 1
      `).get(now, ...types) as JobRow | undefined;
      if (!row) {
        this.db.exec("COMMIT");
        return undefined;
      }
      this.db.prepare(`
        UPDATE workflow_jobs
        SET status = 'running', attempts = attempts + 1, lease_owner = ?,
            lease_expires_at = ?, updated_at = ?, stage = COALESCE(stage, '开始处理'),
            heartbeat_at = ?, error = NULL
        WHERE id = ?
      `).run(input.workerId, leaseExpiresAt, now, now, row.id);
      const claimed = this.db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(row.id) as unknown as JobRow;
      this.db.exec("COMMIT");
      return jobFromRow(claimed);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  updateJobProgress(jobId: string, workerId: string, progress: number, stage?: string, leaseMs = 10 * 60_000) {
    const updatedAt = this.now();
    const leaseExpiresAt = new Date(Date.parse(updatedAt) + Math.max(5_000, leaseMs)).toISOString();
    const result = this.db.prepare(`
      UPDATE workflow_jobs
      SET progress = ?, stage = COALESCE(?, stage), heartbeat_at = ?,
          lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(
      Math.max(0, Math.min(1, progress)),
      stage?.trim() || null,
      updatedAt,
      leaseExpiresAt,
      updatedAt,
      jobId,
      workerId,
    );
    if (!result.changes) throw new Error("任务租约已失效，不能继续更新进度");
  }

  heartbeatJob(jobId: string, workerId: string, stage?: string, leaseMs = 10 * 60_000) {
    const heartbeatAt = this.now();
    const leaseExpiresAt = new Date(Date.parse(heartbeatAt) + Math.max(5_000, leaseMs)).toISOString();
    const result = this.db.prepare(`
      UPDATE workflow_jobs
      SET stage = COALESCE(?, stage), heartbeat_at = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(stage?.trim() || null, heartbeatAt, leaseExpiresAt, heartbeatAt, jobId, workerId);
    if (!result.changes) throw new Error("任务租约已失效，不能继续发送心跳");
  }

  completeJob(jobId: string, workerId: string, result?: unknown): DurableJobRecord {
    const updatedAt = this.now();
    const update = this.db.prepare(`
      UPDATE workflow_jobs
      SET status = 'complete', result_json = ?, progress = 1, updated_at = ?,
          heartbeat_at = ?, next_attempt_at = NULL, lease_owner = NULL,
          lease_expires_at = NULL, error = NULL
      WHERE id = ? AND status = 'running' AND lease_owner = ?
    `).run(result === undefined ? null : json(result), updatedAt, updatedAt, jobId, workerId);
    if (!update.changes) throw new Error("任务租约已失效，不能标记完成");
    return jobFromRow(this.db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(jobId) as unknown as JobRow);
  }

  failJob(jobId: string, workerId: string, error: string, retryDelayMs = 30_000): DurableJobRecord {
    const current = this.db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(jobId) as JobRow | undefined;
    if (!current || current.status !== "running" || current.lease_owner !== workerId) {
      throw new Error("任务租约已失效，不能记录失败");
    }
    const updatedAt = this.now();
    const retrying = current.attempts < current.max_attempts;
    const nextAttemptAt = retrying
      ? new Date(Date.parse(updatedAt) + Math.max(1_000, retryDelayMs)).toISOString()
      : null;
    this.db.prepare(`
      UPDATE workflow_jobs
      SET status = ?, updated_at = ?, next_attempt_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, stage = ?, heartbeat_at = ?, error = ?
      WHERE id = ?
    `).run(
      retrying ? "retrying" : "failed",
      updatedAt,
      nextAttemptAt,
      retrying ? "等待自动重试" : "处理失败",
      updatedAt,
      error.slice(0, 1_500),
      jobId,
    );
    return jobFromRow(this.db.prepare("SELECT * FROM workflow_jobs WHERE id = ?").get(jobId) as unknown as JobRow);
  }

  saveContentPackage<T extends { id: string; storyId: string; mode: string; createdAt: string }>(contentPackage: T): T {
    const packageJson = json(contentPackage);
    const updatedAt = this.now();
    this.db.prepare(`
      INSERT INTO content_packages(id, story_id, mode, package_json, content_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        story_id = excluded.story_id,
        mode = excluded.mode,
        package_json = excluded.package_json,
        content_hash = excluded.content_hash,
        updated_at = excluded.updated_at
    `).run(
      contentPackage.id,
      contentPackage.storyId,
      contentPackage.mode,
      packageJson,
      checksum(packageJson),
      contentPackage.createdAt,
      updatedAt,
    );
    return structuredClone(contentPackage);
  }

  getContentPackage<T>(packageId: string): T | undefined {
    const row = this.db.prepare("SELECT * FROM content_packages WHERE id = ?").get(packageId) as ContentPackageRow | undefined;
    if (!row) return undefined;
    if (checksum(row.package_json) !== row.content_hash) throw new Error("素材包校验失败");
    return JSON.parse(row.package_json) as T;
  }

  latestContentPackageForStory<T>(storyId: string): T | undefined {
    const row = this.db.prepare(`
      SELECT * FROM content_packages WHERE story_id = ? ORDER BY updated_at DESC LIMIT 1
    `).get(storyId) as ContentPackageRow | undefined;
    if (!row) return undefined;
    if (checksum(row.package_json) !== row.content_hash) throw new Error("素材包校验失败");
    return JSON.parse(row.package_json) as T;
  }

  saveSourceSnapshot<T>(input: {
    urlKey: string;
    requestedUrl: string;
    canonicalUrl: string;
    page: T;
    capturedAt?: string;
  }): SourceSnapshotRecord<T> {
    const pageJson = json(input.page);
    const capturedAt = input.capturedAt ?? this.now();
    this.db.prepare(`
      INSERT INTO source_snapshots(
        url_key, requested_url, canonical_url, page_json, content_hash, captured_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(url_key) DO UPDATE SET
        requested_url = excluded.requested_url,
        canonical_url = excluded.canonical_url,
        page_json = excluded.page_json,
        content_hash = excluded.content_hash,
        captured_at = excluded.captured_at
    `).run(
      input.urlKey,
      input.requestedUrl,
      input.canonicalUrl,
      pageJson,
      checksum(pageJson),
      capturedAt,
    );
    return {
      urlKey: input.urlKey,
      requestedUrl: input.requestedUrl,
      canonicalUrl: input.canonicalUrl,
      page: structuredClone(input.page),
      capturedAt,
    };
  }

  getSourceSnapshot<T>(urlKey: string): SourceSnapshotRecord<T> | undefined {
    const row = this.db.prepare("SELECT * FROM source_snapshots WHERE url_key = ?").get(urlKey) as unknown as SourceSnapshotRow | undefined;
    if (!row) return undefined;
    if (checksum(row.page_json) !== row.content_hash) throw new Error("来源快照校验失败");
    return {
      urlKey: row.url_key,
      requestedUrl: row.requested_url,
      canonicalUrl: row.canonical_url,
      page: JSON.parse(row.page_json) as T,
      capturedAt: row.captured_at,
    };
  }

  replaceDiscussionSamples<T extends {
    id: string;
    platform: string;
    author: string;
    permalink: string;
    branchId?: string;
    publishedAt?: string;
  }>(storyId: string, platform: string, samples: T[]): T[] {
    const capturedAt = this.now();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM discussion_samples WHERE story_id = ? AND platform = ?").run(storyId, platform);
      const insert = this.db.prepare(`
        INSERT INTO discussion_samples(
          id, story_id, platform, author, permalink, branch_id, published_at,
          sample_json, content_hash, captured_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const sample of samples) {
        const sampleJson = json(sample);
        insert.run(
          sample.id,
          storyId,
          platform,
          sample.author,
          sample.permalink,
          sample.branchId ?? null,
          sample.publishedAt ?? null,
          sampleJson,
          checksum(sampleJson),
          capturedAt,
        );
      }
      this.db.exec("COMMIT");
      return structuredClone(samples);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listDiscussionSamples<T>(storyId: string, limit = 200): T[] {
    const rows = this.db.prepare(`
      SELECT sample_json, content_hash FROM discussion_samples
      WHERE story_id = ?
      ORDER BY published_at ASC, rowid ASC
      LIMIT ?
    `).all(storyId, Math.max(1, Math.min(500, Math.floor(limit)))) as unknown as DiscussionSampleRow[];
    return rows.map((row) => {
      if (checksum(row.sample_json) !== row.content_hash) throw new Error("社区样本校验失败");
      return JSON.parse(row.sample_json) as T;
    });
  }

  recordEditorialMemoryEvidence(input: {
    kind: string;
    label: string;
    eventId: string;
    draftId: string;
    summary: string;
    createdAt?: string;
  }): EditorialMemoryRecord {
    const createdAt = input.createdAt ?? this.now();
    const id = `writing_memory_${input.kind}`;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.db.prepare("SELECT * FROM editorial_memories WHERE kind = ?").get(input.kind) as EditorialMemoryRow | undefined;
      const currentEvidence = current
        ? JSON.parse(current.evidence_json) as EditorialMemoryRecord["evidence"]
        : [];
      const duplicate = currentEvidence.some((entry) => entry.eventId === input.eventId);
      const evidence = duplicate ? currentEvidence : [{
        eventId: input.eventId,
        draftId: input.draftId,
        summary: input.summary.slice(0, 500),
        createdAt,
      }, ...currentEvidence].slice(0, 20);
      this.db.prepare(`
        INSERT INTO editorial_memories(
          id, kind, label, evidence_count, enabled,
          first_seen_at, last_seen_at, evidence_json
        ) VALUES (?, ?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(kind) DO UPDATE SET
          label = excluded.label,
          evidence_count = editorial_memories.evidence_count + ?,
          last_seen_at = excluded.last_seen_at,
          evidence_json = excluded.evidence_json
      `).run(
        id,
        input.kind,
        input.label,
        duplicate ? 0 : 1,
        createdAt,
        createdAt,
        json(evidence),
        duplicate ? 0 : 1,
      );
      const record = this.db.prepare("SELECT * FROM editorial_memories WHERE kind = ?").get(input.kind) as unknown as EditorialMemoryRow;
      this.db.exec("COMMIT");
      return this.editorialMemoryFromRow(record);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private editorialMemoryFromRow(row: EditorialMemoryRow): EditorialMemoryRecord {
    return {
      id: row.id,
      kind: row.kind,
      label: row.label,
      evidenceCount: row.evidence_count,
      enabled: row.enabled === 1,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      evidence: JSON.parse(row.evidence_json) as EditorialMemoryRecord["evidence"],
    };
  }

  listEditorialMemories(): EditorialMemoryRecord[] {
    return (this.db.prepare(`
      SELECT * FROM editorial_memories ORDER BY evidence_count DESC, last_seen_at DESC
    `).all() as unknown as EditorialMemoryRow[]).map((row) => this.editorialMemoryFromRow(row));
  }

  setEditorialMemoryEnabled(memoryId: string, enabled: boolean): EditorialMemoryRecord | undefined {
    this.db.prepare("UPDATE editorial_memories SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, memoryId);
    const row = this.db.prepare("SELECT * FROM editorial_memories WHERE id = ?").get(memoryId) as EditorialMemoryRow | undefined;
    return row ? this.editorialMemoryFromRow(row) : undefined;
  }

  deleteEditorialMemory(memoryId: string) {
    return this.db.prepare("DELETE FROM editorial_memories WHERE id = ?").run(memoryId).changes > 0;
  }

  recordFeedback(input: Omit<FeedbackEventRecord, "id" | "createdAt">): FeedbackEventRecord {
    const event: FeedbackEventRecord = {
      ...structuredClone(input),
      id: `feedback_${randomUUID()}`,
      createdAt: this.now(),
    };
    this.db.prepare(`
      INSERT INTO feedback_events(id, type, subject_type, subject_id, reason, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.type,
      event.subjectType,
      event.subjectId,
      event.reason ?? null,
      event.payload === undefined ? null : json(event.payload),
      event.createdAt,
    );
    return event;
  }

  listFeedback(subjectType?: FeedbackEventRecord["subjectType"], subjectId?: string, limit = 500): FeedbackEventRecord[] {
    const cap = Math.max(1, Math.min(2_000, Math.floor(limit)));
    const rows = subjectType && subjectId
      ? this.db.prepare(`
        SELECT * FROM feedback_events
        WHERE subject_type = ? AND subject_id = ?
        ORDER BY created_at DESC, rowid DESC LIMIT ?
      `).all(subjectType, subjectId, cap)
      : this.db.prepare(`SELECT * FROM feedback_events ORDER BY created_at DESC, rowid DESC LIMIT ?`).all(cap);
    return (rows as unknown as Array<{
      id: string;
      type: string;
      subject_type: FeedbackEventRecord["subjectType"];
      subject_id: string;
      reason: string | null;
      payload_json: string | null;
      created_at: string;
    }>).map((row) => ({
      id: row.id,
      type: row.type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      reason: row.reason ?? undefined,
      payload: parseJson(row.payload_json),
      createdAt: row.created_at,
    }));
  }

  recordWorkflowEvent(input: Omit<WorkflowEventRecord, "id" | "createdAt">): WorkflowEventRecord {
    const event: WorkflowEventRecord = {
      ...structuredClone(input),
      id: `event_${randomUUID()}`,
      createdAt: this.now(),
    };
    this.db.prepare(`
      INSERT INTO workflow_events(id, type, subject_type, subject_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.type,
      event.subjectType,
      event.subjectId,
      event.payload === undefined ? null : json(event.payload),
      event.createdAt,
    );
    return event;
  }

  listWorkflowEvents(limit = 500): WorkflowEventRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM workflow_events ORDER BY created_at DESC, rowid DESC LIMIT ?
    `).all(Math.max(1, Math.min(2_000, Math.floor(limit)))) as unknown as Array<{
      id: string;
      type: string;
      subject_type: string;
      subject_id: string;
      payload_json: string | null;
      created_at: string;
    }>;
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      subjectType: row.subject_type,
      subjectId: row.subject_id,
      payload: parseJson(row.payload_json),
      createdAt: row.created_at,
    }));
  }

  pruneOperationalHistory(input: {
    terminalJobsOlderThan: string;
    workflowEventsOlderThan: string;
    maxTerminalJobs?: number;
    maxWorkflowEvents?: number;
  }) {
    const maxTerminalJobs = Math.max(0, Math.floor(input.maxTerminalJobs ?? 1_000));
    const maxWorkflowEvents = Math.max(0, Math.floor(input.maxWorkflowEvents ?? 5_000));
    let terminalJobs = 0;
    let workflowEvents = 0;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      terminalJobs += Number(this.db.prepare(`
        DELETE FROM workflow_jobs
        WHERE status IN ('complete','failed','cancelled') AND updated_at < ?
      `).run(input.terminalJobsOlderThan).changes);
      terminalJobs += Number(this.db.prepare(`
        DELETE FROM workflow_jobs WHERE id IN (
          SELECT id FROM workflow_jobs
          WHERE status IN ('complete','failed','cancelled')
          ORDER BY updated_at DESC, rowid DESC
          LIMIT -1 OFFSET ?
        )
      `).run(maxTerminalJobs).changes);
      workflowEvents += Number(this.db.prepare(`
        DELETE FROM workflow_events WHERE created_at < ?
      `).run(input.workflowEventsOlderThan).changes);
      workflowEvents += Number(this.db.prepare(`
        DELETE FROM workflow_events WHERE id IN (
          SELECT id FROM workflow_events
          ORDER BY created_at DESC, rowid DESC
          LIMIT -1 OFFSET ?
        )
      `).run(maxWorkflowEvents).changes);
      this.db.exec("COMMIT");
      return { terminalJobs, workflowEvents };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  /** Create a transactionally consistent, WAL-independent SQLite snapshot. */
  createSnapshot(destinationPath: string) {
    this.db.prepare("VACUUM INTO ?").run(destinationPath);
  }

  close() {
    this.db.close();
  }
}
