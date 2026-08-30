import type { ArticleDraft } from "./types";

export const draftStatusLabel: Record<ArticleDraft["status"], string> = {
  editing: "待编辑",
  reviewing: "待核验",
  "needs-images": "待配图",
  ready: "可填入",
  filled: "已填入",
  published: "已发布",
  shelved: "已搁置",
};

export const manualDraftStatuses: ArticleDraft["status"][] = [
  "editing",
  "reviewing",
  "needs-images",
  "ready",
  "shelved",
];
