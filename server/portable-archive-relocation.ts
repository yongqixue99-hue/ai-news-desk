import path from "node:path";
import type { PortableBackupManifest } from "./data-management.js";
import type { WorkflowState } from "./types.js";

export type PortableArchiveRelocationStatus = "relocatable" | "missing" | "blocked" | "unchanged";

export interface PortableArchiveRelocationEntry {
  ownerType: string;
  ownerId: string;
  field: string;
  sourcePath: string;
  archivePath?: string;
  targetPath?: string;
  status: PortableArchiveRelocationStatus;
  reason: string;
}

export interface PortableArchiveRelocationPlan {
  counts: Record<PortableArchiveRelocationStatus, number>;
  entries: PortableArchiveRelocationEntry[];
}

const decodedArchivePath = (publicPath: string | undefined) => {
  if (!publicPath) return undefined;
  const match = publicPath.match(/^\/(media|materials)\/(.+)$/u);
  if (!match) return undefined;
  try {
    const decodedSegments = match[2]!.split("/").map((segment) => decodeURIComponent(segment));
    if (decodedSegments.some((segment) => segment.includes("/") || segment.includes("\\"))) return undefined;
    const relative = decodedSegments.join("/");
    if (!relative || relative.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
      return undefined;
    }
    return `${match[1]}/${relative}`;
  } catch {
    return undefined;
  }
};

const archivePathFromManagedLocalPath = (sourcePath: string) => {
  const normalized = sourcePath.replace(/\\/gu, "/");
  const match = normalized.match(/(?:^|\/)\.workflow\/(media|materials)\/(.+)$/u);
  if (!match || !match[2] || match[2].split("/").some((segment) => !segment || segment === "." || segment === "..")) {
    return undefined;
  }
  return `${match[1]}/${match[2]}`;
};

const targetFor = (workflowRoot: string, archivePath: string) =>
  path.win32.join(workflowRoot, ...archivePath.split("/"));

const buildPortableArchiveRelocationPlan = (
  state: WorkflowState,
  manifest: PortableBackupManifest,
  windowsWorkflowRoot: string,
  applyRelocations: boolean,
): PortableArchiveRelocationPlan => {
  const manifestPaths = new Set(manifest.files.map((file) => file.path));
  const entries: PortableArchiveRelocationEntry[] = [];
  const add = (input: {
    ownerType: string;
    ownerId: string;
    field: string;
    sourcePath?: string;
    publicPath?: string;
    replacePath?: (targetPath: string) => void;
  }) => {
    const sourcePath = input.sourcePath?.trim();
    if (!sourcePath) return;
    const publicArchivePath = decodedArchivePath(input.publicPath);
    const archivePath = publicArchivePath ?? archivePathFromManagedLocalPath(sourcePath);
    if (!archivePath || !manifestPaths.has(archivePath)) {
      entries.push({
        ownerType: input.ownerType,
        ownerId: input.ownerId,
        field: input.field,
        sourcePath,
        ...(archivePath ? { archivePath } : {}),
        status: archivePath ? "missing" : "blocked",
        reason: archivePath
          ? `归档缺少${publicArchivePath ? " publicPath" : "原工作流路径"} 对应的素材文件`
          : "路径不属于可验证的归档素材，必须人工重新绑定",
      });
      return;
    }
    const targetPath = targetFor(windowsWorkflowRoot, archivePath);
    const unchanged = path.win32.normalize(sourcePath).toLocaleLowerCase("en-US")
      === path.win32.normalize(targetPath).toLocaleLowerCase("en-US");
    if (applyRelocations) input.replacePath?.(targetPath);
    entries.push({
      ownerType: input.ownerType,
      ownerId: input.ownerId,
      field: input.field,
      sourcePath,
      archivePath,
      targetPath,
      status: unchanged ? "unchanged" : "relocatable",
      reason: unchanged
        ? "路径已经指向当前 Windows 工作流目录"
        : `归档包含${publicArchivePath ? " publicPath" : "原工作流路径"} 对应的素材文件`,
    });
  };

  for (const material of state.materials ?? []) {
    add({
      ownerType: "material", ownerId: material.id, field: "localPath", sourcePath: material.localPath,
      publicPath: material.publicPath, replacePath: (targetPath) => { material.localPath = targetPath; },
    });
    add({
      ownerType: "material",
      ownerId: material.id,
      field: "evidencePath",
      sourcePath: material.evidencePath,
      publicPath: material.evidencePath === material.localPath ? material.publicPath : undefined,
      replacePath: (targetPath) => { material.evidencePath = targetPath; },
    });
  }
  for (const run of state.runs ?? []) {
    add({
      ownerType: "run", ownerId: run.id, field: "intake.sourceAssetPath", sourcePath: run.intake?.sourceAssetPath,
      replacePath: (targetPath) => { if (run.intake) run.intake.sourceAssetPath = targetPath; },
    });
    for (const candidate of run.candidates ?? []) {
      for (const image of candidate.images ?? []) {
        add({
          ownerType: "run-image", ownerId: image.id, field: "localPath", sourcePath: image.localPath,
          publicPath: image.publicPath, replacePath: (targetPath) => { image.localPath = targetPath; },
        });
        add({
          ownerType: "run-image",
          ownerId: image.id,
          field: "evidencePath",
          sourcePath: image.evidencePath,
          publicPath: image.evidencePath === image.localPath ? image.publicPath : undefined,
          replacePath: (targetPath) => { image.evidencePath = targetPath; },
        });
      }
    }
  }
  for (const draft of state.drafts ?? []) {
    add({
      ownerType: "draft", ownerId: draft.id, field: "intake.sourceAssetPath", sourcePath: draft.intake?.sourceAssetPath,
      replacePath: (targetPath) => { if (draft.intake) draft.intake.sourceAssetPath = targetPath; },
    });
    add({
      ownerType: "draft", ownerId: draft.id, field: "fillResult.diagnosticScreenshot", sourcePath: draft.fillResult?.diagnosticScreenshot,
      replacePath: (targetPath) => { if (draft.fillResult) draft.fillResult.diagnosticScreenshot = targetPath; },
    });
    add({
      ownerType: "draft", ownerId: draft.id, field: "publisherReceipt.diagnosticScreenshot", sourcePath: draft.publisherReceipt?.diagnosticScreenshot,
      replacePath: (targetPath) => { if (draft.publisherReceipt) draft.publisherReceipt.diagnosticScreenshot = targetPath; },
    });
    for (const placement of draft.images ?? []) {
      const image = placement.image;
      add({
        ownerType: "draft-image", ownerId: image.id, field: "localPath", sourcePath: image.localPath,
        publicPath: image.publicPath, replacePath: (targetPath) => { image.localPath = targetPath; },
      });
      add({
        ownerType: "draft-image",
        ownerId: image.id,
        field: "evidencePath",
        sourcePath: image.evidencePath,
        publicPath: image.evidencePath === image.localPath ? image.publicPath : undefined,
        replacePath: (targetPath) => { image.evidencePath = targetPath; },
      });
    }
  }
  for (const revision of state.draftRevisions ?? []) {
    for (const placement of revision.snapshot.images ?? []) {
      const image = placement.image;
      add({
        ownerType: "draft-revision-image", ownerId: image.id, field: "localPath", sourcePath: image.localPath,
        publicPath: image.publicPath, replacePath: (targetPath) => { image.localPath = targetPath; },
      });
      add({
        ownerType: "draft-revision-image",
        ownerId: image.id,
        field: "evidencePath",
        sourcePath: image.evidencePath,
        publicPath: image.evidencePath === image.localPath ? image.publicPath : undefined,
        replacePath: (targetPath) => { image.evidencePath = targetPath; },
      });
    }
  }
  for (const review of state.intakeReviews ?? []) {
    add({
      ownerType: "intake-review", ownerId: review.id, field: "bundle.source.assetPath", sourcePath: review.bundle.source.assetPath,
      publicPath: review.bundle.source.publicPath, replacePath: (targetPath) => { review.bundle.source.assetPath = targetPath; },
    });
    add({
      ownerType: "intake-review", ownerId: review.id, field: "pendingFile.localPath", sourcePath: review.pendingFile?.localPath,
      publicPath: review.pendingFile?.publicPath, replacePath: (targetPath) => { if (review.pendingFile) review.pendingFile.localPath = targetPath; },
    });
    for (const image of review.bundle.imageCandidates ?? []) {
      add({
        ownerType: "intake-review-image", ownerId: image.id, field: "localPath", sourcePath: image.localPath,
        publicPath: image.publicPath, replacePath: (targetPath) => { image.localPath = targetPath; },
      });
    }
  }
  for (const skill of state.aiSettings?.skills ?? []) {
    add({
      ownerType: "skill", ownerId: skill.id, field: "sourcePath", sourcePath: skill.sourcePath,
      replacePath: (targetPath) => { skill.sourcePath = targetPath; },
    });
  }
  for (const receipt of state.publisherReceipts ?? []) {
    add({
      ownerType: "publisher-receipt", ownerId: receipt.attemptId, field: "diagnosticScreenshot", sourcePath: receipt.diagnosticScreenshot,
      replacePath: (targetPath) => { receipt.diagnosticScreenshot = targetPath; },
    });
  }
  const counts: PortableArchiveRelocationPlan["counts"] = {
    relocatable: 0,
    missing: 0,
    blocked: 0,
    unchanged: 0,
  };
  for (const entry of entries) counts[entry.status] += 1;
  return { counts, entries };
};

export const createPortableArchiveRelocationPlan = (
  state: WorkflowState,
  manifest: PortableBackupManifest,
  windowsWorkflowRoot: string,
) => buildPortableArchiveRelocationPlan(state, manifest, windowsWorkflowRoot, false);

export const rebasePortableArchiveState = (
  state: WorkflowState,
  manifest: PortableBackupManifest,
  windowsWorkflowRoot: string,
): { state: WorkflowState; plan: PortableArchiveRelocationPlan } => {
  const migratedState = structuredClone(state);
  const plan = buildPortableArchiveRelocationPlan(migratedState, manifest, windowsWorkflowRoot, true);
  return { state: migratedState, plan };
};
