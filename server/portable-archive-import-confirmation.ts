import { randomBytes } from "node:crypto";

export type PortableArchiveImportConfirmationErrorCode =
  | "confirmation-invalid"
  | "confirmation-expired"
  | "archive-changed"
  | "workspace-changed";

export class PortableArchiveImportConfirmationError extends Error {
  readonly code: PortableArchiveImportConfirmationErrorCode;

  constructor(code: PortableArchiveImportConfirmationErrorCode, message: string) {
    super(message);
    this.name = "PortableArchiveImportConfirmationError";
    this.code = code;
  }
}

interface ConfirmationRecord {
  archiveSha256: string;
  workspaceChecksum: string;
  expiresAt: number;
}

export const createPortableArchiveImportConfirmationDesk = (options: {
  now?: () => Date;
  ttlMs?: number;
} = {}) => {
  const now = options.now ?? (() => new Date());
  const ttlMs = Math.max(30_000, options.ttlMs ?? 10 * 60_000);
  const confirmations = new Map<string, ConfirmationRecord>();
  const clearExpired = () => {
    const timestamp = now().getTime();
    for (const [token, record] of confirmations) if (record.expiresAt <= timestamp) confirmations.delete(token);
  };
  return {
    issue(input: { archiveSha256: string; workspaceChecksum: string }) {
      clearExpired();
      const token = randomBytes(32).toString("base64url");
      const expiresAt = now().getTime() + ttlMs;
      confirmations.set(token, { ...input, expiresAt });
      return { token, expiresAt: new Date(expiresAt).toISOString() };
    },
    claim(token: string, input: { archiveSha256: string; workspaceChecksum: string }) {
      const record = confirmations.get(token);
      if (!record) {
        throw new PortableArchiveImportConfirmationError("confirmation-invalid", "导入确认已使用或不存在，请重新预检归档");
      }
      if (record.expiresAt <= now().getTime()) {
        confirmations.delete(token);
        throw new PortableArchiveImportConfirmationError("confirmation-expired", "导入确认已过期，请重新预检归档");
      }
      // Every presented token is single-use, including a mismatched attempt.
      // A failed comparison must require a fresh preview instead of leaving a
      // confirmation token reusable as an archive/workspace oracle.
      confirmations.delete(token);
      if (record.archiveSha256 !== input.archiveSha256) {
        throw new PortableArchiveImportConfirmationError("archive-changed", "导入文件与刚才预检的归档不一致");
      }
      if (record.workspaceChecksum !== input.workspaceChecksum) {
        throw new PortableArchiveImportConfirmationError("workspace-changed", "预检后工作台数据已发生变化，请重新预检后再导入");
      }
    },
  };
};
