import { inspectPortableArchiveSnapshot, type PortableArchiveInspectionOptions, type PortableArchiveInspectionReport } from "./portable-archive-inspector.js";
import { createPortableArchiveRelocationPlan, type PortableArchiveRelocationPlan } from "./portable-archive-relocation.js";

export interface PortableArchivePreviewReport extends PortableArchiveInspectionReport {
  dryRun: true;
  imported: false;
  credentialsExcluded: true;
  contents: {
    sources: number;
    runs: number;
    drafts: number;
    materials: number;
    mediaFiles: number;
    materialFiles: number;
  };
  relocation: PortableArchiveRelocationPlan;
}

export const previewPortableArchive = async (
  archivePath: string,
  windowsWorkflowRoot: string,
  options: PortableArchiveInspectionOptions = {},
): Promise<PortableArchivePreviewReport> => {
  const inspected = await inspectPortableArchiveSnapshot(archivePath, options);
  const files = inspected.report.manifest.files;
  return {
    ...inspected.report,
    dryRun: true,
    imported: false,
    credentialsExcluded: true,
    contents: {
      sources: inspected.state.sources?.length ?? 0,
      runs: inspected.state.runs?.length ?? 0,
      drafts: inspected.state.drafts?.length ?? 0,
      materials: inspected.state.materials?.length ?? 0,
      mediaFiles: files.filter((file) => file.path.startsWith("media/")).length,
      materialFiles: files.filter((file) => file.path.startsWith("materials/")).length,
    },
    relocation: createPortableArchiveRelocationPlan(inspected.state, inspected.report.manifest, windowsWorkflowRoot),
  };
};
