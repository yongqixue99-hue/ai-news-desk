import type { ExtractedPage } from "./types.js";

// Only line-ending spelling and outside blank lines may differ. Trimming
// spaces or tabs would erase code indentation and empty table cells.
const comparableText = (text: string) => text.replace(/\r\n?/gu, "\n").replace(/^\n+|\n+$/gu, "");

/** Legacy snapshots may contain partial blocks alongside a complete text body. */
export const sourceReadingContent = (page: Pick<ExtractedPage, "text" | "blocks" | "extractionWarnings">) => {
  const text = page.text;
  const warnings = [...(page.extractionWarnings ?? [])];
  const completeBlocks = page.blocks?.length
    ? comparableText(page.blocks.map((block) => block.text).join("\n\n")) === comparableText(text)
    : false;
  if (page.blocks?.length && !completeBlocks) {
    warnings.push("正文结构块与完整文字不一致，已保留完整文字并停用不完整结构；代码和表格布局仍需核对原文。");
  }
  return {
    text,
    blocks: completeBlocks ? structuredClone(page.blocks) : undefined,
    extractionWarnings: [...new Set(warnings)],
  };
};
