import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import type { PortableBackupManifest } from "./data-management.js";
import { createPortableArchiveRelocationPlan } from "./portable-archive-relocation.js";
import type { SourceImage, WorkflowState } from "./types.js";

const manifestWith = (...paths: string[]): PortableBackupManifest => ({
  format: "ai-news-desk-portable-backup",
  version: 1,
  createdAt: "2026-09-01T00:00:00.000Z",
  databaseSchemaVersion: 1,
  stateVersion: createDefaultState().version,
  stateChecksum: "a".repeat(64),
  secretsIncluded: false,
  files: paths.map((entryPath) => ({ path: entryPath, bytes: 1, sha256: "b".repeat(64) })),
});

test("portable archive preview maps a material's Mac path to its verified Windows archive target", () => {
  const state = createDefaultState();
  state.aiSettings.skills = [];
  state.materials = [{
    id: "material_sony",
    title: "Sony Music logo",
    fileName: "sony.png",
    localPath: "/Users/editor/ai-news-desk/.workflow/materials/sony.png",
    publicPath: "/materials/sony.png",
    attribution: "Sony Music",
    tags: ["Sony Music"],
    rights: "official",
    allowedPlatforms: ["wechat"],
    entityTags: ["Sony Music"],
    fingerprint: "fixture",
    createdAt: "2026-09-01T00:00:00.000Z",
  }];
  const windowsWorkflowRoot = "E:\\Codex-project\\win-project15\\.workflow";

  const plan = createPortableArchiveRelocationPlan(
    state,
    manifestWith("newsdesk.db", "state-backup.json", "materials/sony.png"),
    windowsWorkflowRoot,
  );

  assert.deepEqual(plan.counts, { relocatable: 1, missing: 0, blocked: 0, unchanged: 0 });
  assert.deepEqual(plan.entries[0], {
    ownerType: "material",
    ownerId: "material_sony",
    field: "localPath",
    sourcePath: "/Users/editor/ai-news-desk/.workflow/materials/sony.png",
    archivePath: "materials/sony.png",
    targetPath: path.win32.join(windowsWorkflowRoot, "materials", "sony.png"),
    status: "relocatable",
    reason: "归档包含 publicPath 对应的素材文件",
  });
});

test("portable archive preview never guesses when a managed file is missing or a path is external", () => {
  const state = createDefaultState();
  state.aiSettings.skills = [];
  state.materials = [
    {
      id: "missing",
      title: "Missing",
      fileName: "missing.png",
      localPath: "/Users/editor/ai-news-desk/.workflow/materials/missing.png",
      publicPath: "/materials/missing.png",
      attribution: "Editorial",
      tags: [], rights: "owned", allowedPlatforms: [], entityTags: [], fingerprint: "missing", createdAt: "2026-09-01T00:00:00.000Z",
    },
    {
      id: "external",
      title: "External license",
      fileName: "external.png",
      localPath: "/Users/editor/Desktop/external.png",
      publicPath: "https://example.com/external.png",
      attribution: "Editorial",
      tags: [], rights: "licensed", allowedPlatforms: [], entityTags: [], fingerprint: "external", createdAt: "2026-09-01T00:00:00.000Z",
    },
  ];

  const plan = createPortableArchiveRelocationPlan(
    state,
    manifestWith("newsdesk.db", "state-backup.json"),
    "E:\\desk\\.workflow",
  );

  assert.deepEqual(plan.counts, { relocatable: 0, missing: 1, blocked: 1, unchanged: 0 });
  assert.equal(plan.entries.find((entry) => entry.ownerId === "missing")?.status, "missing");
  assert.equal(plan.entries.find((entry) => entry.ownerId === "external")?.status, "blocked");
  assert.ok(plan.entries.every((entry) => entry.targetPath === undefined));
});

test("portable archive preview inventories every persisted path-bearing workflow record", () => {
  const state = createDefaultState();
  state.materials = [];
  const image = (id: string, name: string): SourceImage => ({
    id,
    url: `/media/${name}`,
    localPath: `/Users/editor/desk/.workflow/media/${name}`,
    publicPath: `/media/${name}`,
    caption: name,
    attribution: "Source",
    sourceUrl: "https://example.com/story",
    selected: true,
    rights: "official",
    evidencePath: `/Users/editor/desk/.workflow/media/${name}`,
  });
  state.runs = [{
    id: "run-1", createdAt: "", updatedAt: "", status: "complete", stage: "complete", windowHours: 24,
    sourceIds: [], scheduled: false, rawCount: 1, logs: [],
    intake: { sourceLabel: "Screenshot", sourceAssetPath: "/Users/editor/desk/.workflow/media/intake.png" },
    candidates: [{ id: "candidate-1", images: [image("run-image", "run.png")] }],
  } as unknown as WorkflowState["runs"][number]];
  state.drafts = [{
    id: "draft-1",
    images: [{ id: "placement-1", image: image("draft-image", "draft.png"), afterParagraph: 0, caption: "Draft", inserted: true }],
    intake: { type: "screenshot", sourceAssetPath: "/Users/editor/desk/.workflow/media/intake.png" },
  } as unknown as WorkflowState["drafts"][number]];
  state.draftRevisions = [{
    id: "revision-1", draftId: "draft-1", createdAt: "", updatedAt: "", kind: "manual", label: "Manual",
    snapshot: { images: [{ id: "revision-placement", image: image("revision-image", "revision.png"), afterParagraph: 0, caption: "Revision", inserted: true }] },
  } as unknown as WorkflowState["draftRevisions"][number]];
  state.intakeReviews = [{
    id: "intake-review-1", createdAt: "", updatedAt: "", status: "pending",
    bundle: {
      source: { kind: "screenshot", label: "Input", assetPath: "/Users/editor/desk/.workflow/media/intake.png", publicPath: "/media/intake.png" },
      imageCandidates: [{ id: "crop-1", localPath: "/Users/editor/desk/.workflow/media/crop.png", publicPath: "/media/crop.png" }],
    },
    pendingFile: { localPath: "/Users/editor/desk/.workflow/media/intake.png", publicPath: "/media/intake.png", contentType: "image/png", fileName: "intake.png" },
  } as WorkflowState["intakeReviews"][number]];
  state.aiSettings.skills = [{
    id: "custom-skill", name: "Custom", description: "", sourcePath: "/Users/editor/.codex/skills/custom/SKILL.md",
    enabled: true, builtIn: false, compatibility: "codex-native", importedAt: "",
  }];
  state.publisherReceipts = [{ attemptId: "receipt-1", diagnosticScreenshot: "/Users/editor/desk/.workflow/jobs/failure.png" } as WorkflowState["publisherReceipts"][number]];

  const files = ["run.png", "draft.png", "revision.png", "intake.png", "crop.png"].map((name) => `media/${name}`);
  const plan = createPortableArchiveRelocationPlan(
    state,
    manifestWith("newsdesk.db", "state-backup.json", ...files),
    "E:\\desk\\.workflow",
  );

  const keys = new Set(plan.entries.map((entry) => `${entry.ownerType}:${entry.ownerId}:${entry.field}`));
  for (const expected of [
    "run-image:run-image:localPath",
    "run:run-1:intake.sourceAssetPath",
    "draft-image:draft-image:localPath",
    "draft:draft-1:intake.sourceAssetPath",
    "draft-revision-image:revision-image:localPath",
    "intake-review:intake-review-1:bundle.source.assetPath",
    "intake-review-image:crop-1:localPath",
    "intake-review:intake-review-1:pendingFile.localPath",
    "skill:custom-skill:sourcePath",
    "publisher-receipt:receipt-1:diagnosticScreenshot",
  ]) assert.ok(keys.has(expected), `missing ${expected}`);
  assert.equal(plan.entries.find((entry) => entry.ownerType === "skill")?.status, "blocked");
  assert.equal(plan.entries.find((entry) => entry.ownerType === "publisher-receipt")?.status, "blocked");
});
