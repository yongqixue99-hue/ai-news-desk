import assert from "node:assert/strict";
import test from "node:test";
import type { ProductJob } from "./api.js";
import { beginStarterDraft, starterDraftActionCopy } from "./starter-draft.js";
import type { ArticleDraft } from "./types.js";

const queuedJob = {
  id: "job-generated-draft",
  type: "draft-from-package",
  status: "queued",
  payload: { packageId: "package-1" },
  progress: 0,
  attempts: 0,
  maxAttempts: 3,
  createdAt: "2026-09-04T00:00:00.000Z",
  updatedAt: "2026-09-04T00:00:00.000Z",
} as ProductJob;

test("the primary Today action requests a generated starter draft and reports its background job", async () => {
  const requestedPackages: string[] = [];
  const result = await beginStarterDraft("package-1", async (packageId) => {
    requestedPackages.push(packageId);
    return { job: queuedJob, reused: false };
  });

  assert.deepEqual(requestedPackages, ["package-1"]);
  assert.deepEqual(result, { kind: "queued", job: queuedJob });
  assert.equal(starterDraftActionCopy.primary, "生成基础稿并开始修改");
  assert.equal(starterDraftActionCopy.blank, "从空白开始");
});

test("the starter-draft flow opens an immediately available generated draft", async () => {
  const draft = { id: "draft-generated" } as ArticleDraft;
  const result = await beginStarterDraft("package-1", async () => ({
    job: { ...queuedJob, status: "complete", result: { draftId: draft.id } },
    draft,
    reused: true,
  }));

  assert.deepEqual(result, { kind: "ready", draft, reused: true });
});
