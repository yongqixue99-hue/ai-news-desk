import assert from "node:assert/strict";
import test from "node:test";
import {
  createPortableArchiveImportConfirmationDesk,
  PortableArchiveImportConfirmationError,
} from "./portable-archive-import-confirmation.js";

test("an archive import confirmation is bound to one archive and one workspace revision and can be claimed once", () => {
  const desk = createPortableArchiveImportConfirmationDesk({
    now: () => new Date("2026-09-01T12:00:00.000Z"),
  });
  const issued = desk.issue({
    archiveSha256: "a".repeat(64),
    workspaceChecksum: "b".repeat(64),
  });

  assert.equal(issued.expiresAt, "2026-09-01T12:10:00.000Z");
  assert.doesNotThrow(() => desk.claim(issued.token, {
    archiveSha256: "a".repeat(64),
    workspaceChecksum: "b".repeat(64),
  }));
  assert.throws(
    () => desk.claim(issued.token, {
      archiveSha256: "a".repeat(64),
      workspaceChecksum: "b".repeat(64),
    }),
    (error) => error instanceof PortableArchiveImportConfirmationError && error.code === "confirmation-invalid",
  );
});

test("a mismatched or expired confirmation is consumed and cannot be retried", () => {
  let current = new Date("2026-09-01T12:00:00.000Z");
  const desk = createPortableArchiveImportConfirmationDesk({ now: () => current, ttlMs: 30_000 });
  const changedArchive = desk.issue({ archiveSha256: "a".repeat(64), workspaceChecksum: "b".repeat(64) });
  assert.throws(
    () => desk.claim(changedArchive.token, { archiveSha256: "c".repeat(64), workspaceChecksum: "b".repeat(64) }),
    (error) => error instanceof PortableArchiveImportConfirmationError && error.code === "archive-changed",
  );
  assert.throws(
    () => desk.claim(changedArchive.token, { archiveSha256: "a".repeat(64), workspaceChecksum: "b".repeat(64) }),
    (error) => error instanceof PortableArchiveImportConfirmationError && error.code === "confirmation-invalid",
  );

  const expired = desk.issue({ archiveSha256: "d".repeat(64), workspaceChecksum: "e".repeat(64) });
  current = new Date("2026-09-01T12:00:31.000Z");
  assert.throws(
    () => desk.claim(expired.token, { archiveSha256: "d".repeat(64), workspaceChecksum: "e".repeat(64) }),
    (error) => error instanceof PortableArchiveImportConfirmationError && error.code === "confirmation-expired",
  );
});
