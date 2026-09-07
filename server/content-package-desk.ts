import { hydrateStoryDiscussion } from "./community-intelligence.js";
import type { LocalDatabase } from "./local-database.js";
import { buildContentPackage, freezeContentPackageAssets } from "./package-desk.js";
import type {
  AssignmentMode,
  ContentPackage,
  DiscussionSample,
  EditorialIntent,
  SourceMaterialSnapshot,
} from "./product-types.js";
import { loadSourceMaterialSnapshots } from "./source-material.js";
import { storyById } from "./story-desk.js";
import { preparePackageSourceEvidence } from "./package-source-evidence.js";
import { getLocalDatabase, readState } from "./storage.js";
import type { WorkflowState } from "./types.js";
import { hydrateStoryAssets, type VisualHydrationOptions, type VisualHydrationResult } from "./visual-desk.js";

interface ContentPackageDeskDependencies {
  readState: () => Promise<WorkflowState>;
  getDatabase: () => Promise<LocalDatabase>;
  hydrateAssets: (
    storyId: string,
    minimumImages: number,
    options: VisualHydrationOptions,
  ) => Promise<VisualHydrationResult>;
  hydrateDiscussion: (storyId: string) => Promise<DiscussionSample[]>;
  loadSourceMaterials: (state: WorkflowState, storyId: string) => Promise<SourceMaterialSnapshot[]>;
  freezeAssets: typeof freezeContentPackageAssets;
  prepareArticleEvidence: typeof preparePackageSourceEvidence;
}

export const createContentPackageDesk = (overrides: Partial<ContentPackageDeskDependencies> = {}) => {
  const dependencies: ContentPackageDeskDependencies = {
    readState,
    getDatabase: getLocalDatabase,
    hydrateAssets: hydrateStoryAssets,
    hydrateDiscussion: hydrateStoryDiscussion,
    loadSourceMaterials: loadSourceMaterialSnapshots,
    freezeAssets: freezeContentPackageAssets,
    prepareArticleEvidence: preparePackageSourceEvidence,
    ...overrides,
  };

  return {
    async buildAndSave(
      storyId: string,
      requestedMode: Exclude<AssignmentMode, "watch" | "skip"> | undefined,
      progress?: (value: number, stage: string) => void,
      minimumImages = 2,
      editorial?: { intent: EditorialIntent; reason: string },
    ) {
      const initialState = await dependencies.readState();
      const resolvedMode = requestedMode ?? storyById(initialState, storyId)?.assignment.mode;
      const resolvedIntent = editorial?.intent ?? (resolvedMode === "community" ? "community" : resolvedMode === "curate" ? "source" : "news");
      const [visualResult, discussionSamples, sourceMaterials] = await Promise.all([
        dependencies.hydrateAssets(storyId, minimumImages, { progress, scope: "article" }),
        dependencies.hydrateDiscussion(storyId),
        resolvedIntent === "source"
          ? dependencies.loadSourceMaterials(initialState, storyId)
          : Promise.resolve([]),
      ]);
      const evidenceState = await dependencies.readState();
      const articleEvidence = resolvedIntent === "news"
        ? await dependencies.prepareArticleEvidence(evidenceState, storyId, progress)
        : undefined;
      progress?.(0.88, "整理事实、社区证据与相关素材");
      const builtPackage = buildContentPackage(await dependencies.readState(), {
        storyId,
        mode: requestedMode,
        intent: resolvedIntent,
        intakeReason: editorial?.reason,
        discussionSamples,
        sourceMaterials,
        articleEvidence,
      });
      const database = await dependencies.getDatabase();
      database.recordWorkflowEvent({
        type: "story.assets_hydrated",
        subjectType: "story",
        subjectId: storyId,
        payload: visualResult,
      });
      const existing = database.getContentPackage<ContentPackage>(builtPackage.id);
      progress?.(0.94, existing ? "复用同一证据版本素材包" : "冻结图片与版权证据");
      const contentPackage = existing ?? await dependencies.freezeAssets(builtPackage);
      const saved = existing ?? database.saveContentPackage(contentPackage);
      if (!existing) {
        database.recordFeedback({
          type: "package_created",
          subjectType: "story",
          subjectId: storyId,
          payload: { packageId: saved.id, mode: saved.mode, status: saved.status },
        });
        database.recordWorkflowEvent({
          type: "package.created",
          subjectType: "package",
          subjectId: saved.id,
          payload: { storyId, mode: saved.mode, status: saved.status },
        });
      }
      return { contentPackage: saved, reused: Boolean(existing), visualResult };
    },
  };
};

export const contentPackageDesk = createContentPackageDesk();
