import type { ArticleOptimizationChange } from "./types";

export interface EditableDraftText {
  title: string;
  paragraphs: string[];
  take: string;
}

export interface OptimizationPatchConflict {
  id: string;
  reason: string;
}

const normalized = (value: string) => value.replace(/\s+/g, " ").trim();

const currentBlockText = (draft: EditableDraftText, blockId: string) => {
  if (blockId === "title") return draft.title;
  if (blockId === "take") return draft.take;
  const paragraphIndex = /^paragraph:(\d+)$/.exec(blockId)?.[1];
  return paragraphIndex === undefined ? undefined : draft.paragraphs[Number(paragraphIndex)];
};

const setBlockText = (draft: EditableDraftText, blockId: string, value: string) => {
  if (blockId === "title") {
    draft.title = value;
    return true;
  }
  if (blockId === "take") {
    draft.take = value;
    return true;
  }
  const paragraphIndex = /^paragraph:(\d+)$/.exec(blockId)?.[1];
  if (paragraphIndex === undefined || draft.paragraphs[Number(paragraphIndex)] === undefined) return false;
  draft.paragraphs[Number(paragraphIndex)] = value;
  return true;
};

export const applyOptimizationChanges = (
  current: EditableDraftText,
  changes: ArticleOptimizationChange[],
  options: { safeOnly?: boolean } = {},
) => {
  const draft: EditableDraftText = {
    title: current.title,
    paragraphs: [...current.paragraphs],
    take: current.take,
  };
  const appliedIds: string[] = [];
  const conflicts: OptimizationPatchConflict[] = [];
  const touchedBlocks = new Set<string>();

  for (const change of changes) {
    if (options.safeOnly && !change.factCheckPassed) {
      conflicts.push({ id: change.id, reason: change.factWarnings[0] || "该修改未通过事实保护检查" });
      continue;
    }
    if (touchedBlocks.has(change.blockId)) {
      conflicts.push({ id: change.id, reason: "同一段存在多项互相覆盖的修改" });
      continue;
    }
    const currentText = currentBlockText(draft, change.blockId);
    if (currentText === undefined) {
      conflicts.push({ id: change.id, reason: "目标段落已经不存在" });
      continue;
    }
    if (normalized(currentText) !== normalized(change.before)) {
      conflicts.push({ id: change.id, reason: "草稿已被修改，建议内容不再匹配" });
      continue;
    }
    if (!setBlockText(draft, change.blockId, change.after.trim())) {
      conflicts.push({ id: change.id, reason: "无法定位目标段落" });
      continue;
    }
    touchedBlocks.add(change.blockId);
    appliedIds.push(change.id);
  }

  return { draft, appliedIds, conflicts };
};

/**
 * Patch only the exact rich-text blocks accepted by the user. Unchanged nodes,
 * headings, images, links and captions remain structurally intact; inline
 * formatting is flattened only inside a block that is replaced.
 */
export const applyOptimizationChangesToHtml = (
  currentHtml: string,
  changes: ArticleOptimizationChange[],
) => {
  const parsed = new DOMParser().parseFromString(`<article>${currentHtml}</article>`, "text/html");
  const article = parsed.querySelector("article")!;
  const candidates = [...article.querySelectorAll("p,h1,h2,h3,h4,blockquote,li")].filter((node) => {
    const previous = node.previousElementSibling;
    return !(node.tagName === "P" && previous?.tagName === "IMG" && normalized(node.textContent || "").startsWith("图："));
  });
  const appliedIds: string[] = [];
  const conflicts: OptimizationPatchConflict[] = [];

  for (const change of changes) {
    if (change.blockId === "title") {
      appliedIds.push(change.id);
      continue;
    }
    const matches = candidates.filter((node) => normalized(node.textContent || "") === normalized(change.before));
    if (matches.length !== 1) {
      conflicts.push({
        id: change.id,
        reason: matches.length ? "正文中有多个相同片段，未自动覆盖" : "富文本正文已变化，未找到原片段",
      });
      continue;
    }
    if (change.after.trim()) matches[0].textContent = change.after.trim();
    else matches[0].remove();
    appliedIds.push(change.id);
  }
  return { html: article.innerHTML, appliedIds, conflicts };
};
