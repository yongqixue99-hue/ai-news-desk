import { contentPackageDesk } from "./content-package-desk.js";
import { createDraftFromPackage } from "./draft-desk.js";
import { enrichStoryExplanation } from "./story-explanation-service.js";
import { buildStories } from "./story-desk.js";
import { readState } from "./storage.js";
import type {
  AssignmentMode,
  ContentPackage,
  EditorialIntakeView,
  EditorialIntent,
  EditorialIntentOption,
  StorySignalView,
  StoryView,
} from "./product-types.js";
import type { ArticleDraft, Candidate, WorkflowState } from "./types.js";

export interface EditorialSignalRef {
  runId: string;
  candidateId: string;
}

export interface EditorialDraftRequest extends EditorialSignalRef {
  intent?: EditorialIntent;
}

export interface EditorialDraftResult {
  intake: EditorialIntakeView;
  story: StoryView;
  contentPackage: ContentPackage;
  draft: ArticleDraft;
  reused: boolean;
}

export type EditorialProgressReporter = (progress: number, stage: string) => void;

const signalIdFor = (input: EditorialSignalRef) => `${input.runId}:${input.candidateId}`;

const candidateFor = (state: WorkflowState, input: EditorialSignalRef) => state.runs
  .find((run) => run.id === input.runId)?.candidates
  .find((candidate) => candidate.id === input.candidateId);

const storyFor = (state: WorkflowState, input: EditorialSignalRef, now: string) => buildStories(state, now)
  .find((story) => story.signals.some((signal) => signal.runId === input.runId && signal.candidateId === input.candidateId));

const sourceKindFor = (signal: StorySignalView) => signal.linkedSource
  ? "linked-community" as const
  : signal.isCommunity
    ? "self-contained-community" as const
    : "news-source" as const;

const originalPostLength = (candidate: Candidate) => candidate.excerpt
  .split(/---\s*Top Comments\s*---/iu)[0]!
  .replace(/<[^>]+>/gu, " ")
  .replace(/\s+/gu, " ")
  .trim()
  .length;

const newsModeFor = (story: StoryView): EditorialIntentOption["mode"] => {
  if (story.assignment.mode === "playbook") return "playbook";
  return story.factSourceCount >= 2 ? "synthesis" : "brief";
};

const option = (
  intent: EditorialIntent,
  mode: EditorialIntentOption["mode"],
  available: boolean,
  reason: string,
): EditorialIntentOption => ({
  intent,
  mode,
  available,
  reason,
  workingCopy: intent === "source",
  label: intent === "news" ? "按新闻写" : intent === "source" ? "整理原文" : "分析讨论",
  description: intent === "news"
    ? "以官方或新闻来源建立事实主干，社区只作为发现线索。"
    : intent === "source"
      ? "保留原始材料的顺序和表达，形成需核权的编辑工作副本。"
      : "事实先行，再呈现达到采样门槛的真实观点与分歧。",
});

/**
 * EditorialIntake is the single routing interface shared by news and
 * community callers. It resolves a raw signal into one Story and keeps source
 * channel separate from editorial intent.
 */
export const inspectEditorialIntake = (
  state: WorkflowState,
  input: EditorialSignalRef,
  now = new Date().toISOString(),
): { intake: EditorialIntakeView; story: StoryView } => {
  const candidate = candidateFor(state, input);
  if (!candidate) throw new Error("候选不存在或已经退出当前数据");
  const story = storyFor(state, input, now);
  if (!story) throw new Error("候选尚未归入可读取的 Story");
  const signal = story.signals.find((item) => item.runId === input.runId && item.candidateId === input.candidateId);
  if (!signal) throw new Error("Story 中找不到对应来源信号");
  const sourceKind = sourceKindFor(signal);
  const canWriteNews = story.assignment.canDraft && story.factSourceCount > 0;
  const hasReadableSource = story.explanation.basis === "full-source"
    || (sourceKind === "self-contained-community" && originalPostLength(candidate) >= 80);
  // A traceable author's post can become a private source working copy even
  // when it does not satisfy the evidence threshold for a news article.
  const canPreserveSource = hasReadableSource;
  const canAnalyzeCommunity = story.assignment.canDraft
    && story.factSourceCount > 0
    && story.communitySampleCount >= 5;
  const recommendedIntent: EditorialIntent = story.technicalArticle || sourceKind === "self-contained-community" ? "source" : "news";
  const recommendationReason = story.technicalArticle?.reason ?? (sourceKind === "linked-community"
    ? "这是一条带外部来源的社区线索；应先读取外部页面并把事件写清，评论只作补充。"
    : sourceKind === "self-contained-community"
      ? "主帖本身承载内容；优先保留作者叙事，只有明确选择时才分析评论。"
      : "来源直接描述新闻事件；默认生成简洁、可回指证据的新闻稿。");
  const options = [
    option("news", newsModeFor(story), canWriteNews, canWriteNews
      ? "已有可建立事实主干的来源。"
      : sourceKind === "linked-community"
        ? "需要先读取外部来源正文，社区标题不能单独支持新闻。"
        : story.assignment.blockers[0] || "当前缺少正文级事实来源。"),
    option("source", "curate", canPreserveSource, canPreserveSource
      ? "原始材料已经足够完整，可以保留结构并做最小改写。"
      : "尚未取得足够完整的原始正文，不能假装进行忠实整理。"),
    option("community", "community", canAnalyzeCommunity, canAnalyzeCommunity
      ? `已有 ${story.communitySampleCount} 条有效样本，可呈现有限观点。`
      : story.factSourceCount <= 0
        ? "社区讨论还没有可核验的事件事实主干。"
        : `当前只有 ${story.communitySampleCount} 条有效样本，至少需要 5 条。`),
  ];
  return {
    story,
    intake: {
      storyId: story.id,
      signalId: signalIdFor(input),
      sourceKind,
      recommendedIntent,
      recommendationReason,
      options,
    },
  };
};

interface EditorialIntakeDependencies {
  readState: () => Promise<WorkflowState>;
  enrichExplanation: (storyId: string) => Promise<StoryView>;
  buildPackage: (
    storyId: string,
    mode: Exclude<AssignmentMode, "watch" | "skip">,
    progress: EditorialProgressReporter | undefined,
    minimumImages: number,
    editorial: { intent: EditorialIntent; reason: string },
  ) => Promise<{ contentPackage: ContentPackage; reused: boolean }>;
  createDraft: (packageId: string, progress?: EditorialProgressReporter) => Promise<{ draft: ArticleDraft; reused: boolean }>;
}

export const createEditorialIntakeDesk = (overrides: Partial<EditorialIntakeDependencies> = {}) => {
  const dependencies: EditorialIntakeDependencies = {
    readState,
    enrichExplanation: enrichStoryExplanation,
    buildPackage: contentPackageDesk.buildAndSave,
    createDraft: createDraftFromPackage,
    ...overrides,
  };

  const open = async (input: EditorialSignalRef) => inspectEditorialIntake(await dependencies.readState(), input);

  return {
    open,
    async createDraft(input: EditorialDraftRequest, progress?: EditorialProgressReporter): Promise<EditorialDraftResult> {
      progress?.(0.04, "识别来源与推荐稿型");
      let view = await open(input);
      if ((view.intake.sourceKind === "linked-community" || view.story.technicalArticle) && view.story.explanation.basis !== "full-source") {
        progress?.(0.1, "读取原始来源正文");
        await dependencies.enrichExplanation(view.story.id);
        view = await open(input);
      }
      const intent = input.intent ?? view.intake.recommendedIntent;
      const selected = view.intake.options.find((entry) => entry.intent === intent);
      if (!selected) throw new Error("不支持的内容方向");
      if (!selected.available) throw new Error(selected.reason);
      progress?.(0.18, selected.intent === "news" ? "建立新闻事实主干" : selected.intent === "source" ? "冻结原始材料" : "读取社区观点样本");
      const packageResult = await dependencies.buildPackage(
        view.story.id,
        selected.mode,
        progress,
        2,
        { intent, reason: view.intake.recommendationReason },
      );
      if (packageResult.contentPackage.status !== "ready") {
        throw new Error(packageResult.contentPackage.blockers[0] || "素材包没有达到成稿条件");
      }
      progress?.(0.94, "通过统一素材包生成草稿");
      const draftResult = await dependencies.createDraft(packageResult.contentPackage.id, progress);
      return {
        ...view,
        contentPackage: packageResult.contentPackage,
        draft: draftResult.draft,
        reused: packageResult.reused || draftResult.reused,
      };
    },
  };
};

export const editorialIntakeDesk = createEditorialIntakeDesk();
