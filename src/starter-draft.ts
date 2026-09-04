import type { ProductJob } from "./api.js";
import type { ArticleDraft } from "./types.js";

export const starterDraftActionCopy = {
  primary: "生成基础稿并开始修改",
  blank: "从空白开始",
} as const;

export type StarterDraftRequest = (packageId: string) => Promise<{
  job: ProductJob;
  draft?: ArticleDraft;
  reused: boolean;
}>;

export type StarterDraftLaunch =
  | { kind: "ready"; draft: ArticleDraft; reused: boolean }
  | { kind: "queued"; job: ProductJob };

/**
 * Starts the default, evidence-bounded writing path. A blank human-first draft
 * is intentionally a separate action so the primary button can never create
 * an empty article while claiming that writing has started.
 */
export const beginStarterDraft = async (
  packageId: string,
  requestGeneratedDraft: StarterDraftRequest,
): Promise<StarterDraftLaunch> => {
  const queued = await requestGeneratedDraft(packageId);
  if (queued.draft) return { kind: "ready", draft: queued.draft, reused: queued.reused };
  if (["failed", "cancelled"].includes(queued.job.status)) {
    throw new Error(queued.job.error || "基础稿生成失败，请重试");
  }
  if (queued.job.status === "complete") {
    throw new Error("基础稿任务已经完成，但没有返回可打开的草稿");
  }
  return { kind: "queued", job: queued.job };
};
