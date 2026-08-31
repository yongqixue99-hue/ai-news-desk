import { hydrateStoryDiscussion } from "./community-intelligence.js";
import type { LocalDatabase } from "./local-database.js";
import { buildContentPackage, freezeContentPackageAssets } from "./package-desk.js";
import type { AssignmentMode, ContentPackage, DiscussionSample } from "./product-types.js";
import { getLocalDatabase, readState } from "./storage.js";
import type { WorkflowState } from "./types.js";
import { hydrateStoryAssets, type VisualHydrationResult } from "./visual-desk.js";

interface ContentPackageDeskDependencies {
  readState: () => Promise<WorkflowState>;
  getDatabase: () => Promise<LocalDatabase>;
  hydrateAssets: (
    storyId: string,
    minimumImages: number,
    options: { progress?: (value: number, stage: string) => void },
  ) => Promise<VisualHydrationResult>;
  hydrateDiscussion: (storyId: string) => Promise<DiscussionSample[]>;
  freezeAssets: typeof freezeContentPackageAssets;
}

export const createContentPackageDesk = (overrides: Partial<ContentPackageDeskDependencies> = {}) => {
  const dependencies: ContentPackageDeskDependencies = {
    readState,
    getDatabase: getLocalDatabase,
    hydrateAssets: hydrateStoryAssets,
    hydrateDiscussion: hydrateStoryDiscussion,
    freezeAssets: freezeContentPackageAssets,
    ...overrides,
  };

  return {
    async buildAndSave(
      storyId: string,
      requestedMode: Exclude<AssignmentMode, "watch" | "skip"> | undefined,
      progress?: (value: number, stage: string) => void,
      minimumImages = 2,
    ) {
      const [visualResult, discussionSamples] = await Promise.all([
        dependencies.hydrateAssets(storyId, minimumImages, { progress }),
        dependencies.hydrateDiscussion(storyId),
      ]);
      progress?.(0.88, "整理事实、社区证据与相关素材");
      const builtPackage = buildContentPackage(await dependencies.readState(), {
        storyId,
        mode: requestedMode,
        discussionSamples,
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
