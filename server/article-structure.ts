import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { AnyNode } from "domhandler";
import type { ExtractedPage } from "./types.js";

type ArticleBlock = NonNullable<ExtractedPage["blocks"]>[number];
const maximumTextLength = 30_000;
const maximumBlocks = 500;
const maximumTableRows = 200;
const maximumTableColumns = 40;
const maximumCellLength = 4_000;
const maximumFooterRows = 20;
const excluded = "script,style,nav,footer,form,button,input,select,textarea,noscript,svg,[hidden],[aria-hidden='true'],[role='navigation'],[aria-label*='Related' i],[class*='related-'],[class*='recommendation'],[class*='author-'],[class*='authorBio'],[class*='byline'],[class*='most-read'],[class*='MostRead'],[class*='share-dropdown'],[class~='article-tags'],[class$='meta-aside-divider']";
const space = (value: string) => value.replace(/\s+/gu, " ").trim();
const footnoteId = /^(?:user-content-)?(?:fn(?:[-_:]|\d)|footnote(?:[-_:]|\d)|cite_note[-_:])/iu;
const blockTags = new Set(["h1", "h2", "h3", "h4", "h5", "h6", "p", "blockquote", "li", "pre", "table", "figcaption"]);
const containerTags = new Set(["article", "main", "body", "section", "div", "ul", "ol", "figure", "details", "summary", "dl", "dt", "dd"]);
const structureSelector = [...blockTags, ...containerTags].join(",");

const visibleText = (node: Cheerio<AnyNode>) => {
  const copy = node.clone();
  copy.find("br").replaceWith(" ");
  copy.find("p,div,li").append(" ");
  return space(copy.text());
};

const referencedFootnotes = ($: CheerioAPI, root: Cheerio<AnyNode>, pageUrl?: string) => {
  const targets = new Map<string, AnyNode[]>();
  for (const node of root.find("[id]")) {
    const id = $(node).attr("id")!;
    targets.set(id, [...(targets.get(id) ?? []), node]);
  }
  // Some publishers render the endnote component beside the article. Only
  // accept a specifically marked component in the same main, with an exact
  // backlink to a reference inside this article. Never search other stories.
  const main = root.is("article") ? root.closest("main,[role='main']") : $([]);
  const identityCounts = new Map<string, number>();
  for (const node of (main.length ? main : root).find("[id]")) {
    const id = $(node).attr("id")!;
    identityCounts.set(id, (identityCounts.get(id) ?? 0) + 1);
  }
  const externalTargets = main.find("uni-footnotes [id],[role='doc-endnotes'] [id],[data-footnotes] [id]")
    .filter((_index, node) => !$(node).closest("article").length && !$(node).closest(excluded).length);
  const rescued = new Map<string, { label: string; text: string }>();
  const missing = new Set<string>();
  for (const element of root.find("a[href]")) {
    const link = $(element);
    if (link.parents("aside").length || link.is("[role='doc-backlink'],[data-footnote-backref]")) continue;
    const href = link.attr("href") ?? "";
    let id: string | undefined;
    try {
      if (href.startsWith("#")) id = decodeURIComponent(href.slice(1));
      else if (pageUrl) {
        const base = new URL(pageUrl);
        const target = new URL(href, base);
        if (target.origin === base.origin && target.pathname === base.pathname && target.search === base.search) id = decodeURIComponent(target.hash.slice(1));
      }
    } catch { /* An unreadable reference is reported below when it is explicitly marked as a footnote. */ }
    const explicit = link.is("[role='doc-noteref'],[data-footnote-ref],[class*='footnote-ref']") || link.parents("sup").length > 0;
    if (!explicit && (!id || !footnoteId.test(id))) continue;
    const label = space(link.text()).replace(/^\[(.*)\]$/u, "$1").slice(0, 40) || "注";
    const referenceId = link.attr("id");
    link.replaceWith($("<span>").text(` [${label}] `));
    if (id && rescued.has(id)) continue;
    let matches = id ? targets.get(id) : undefined;
    if (!matches?.length && id && referenceId && identityCounts.get(referenceId) === 1) {
      matches = externalTargets.filter((_index, node) => $(node).attr("id") === id
        && $(node).find("a[href]").toArray().some((back) => $(back).attr("href") === `#${referenceId}`)).toArray();
    }
    if (id && identityCounts.get(id) !== 1) matches = undefined;
    const target = matches?.length === 1 ? $(matches[0]!) : undefined;
    const aside = target?.closest("aside");
    const permittedAside = !aside?.length || footnoteId.test(id ?? "")
      || target?.is("[role='doc-footnote']") || aside.is("[role='doc-endnotes'],[class*='footnote']");
    if (!target?.length || target.closest(excluded).length || !permittedAside) { missing.add(label); continue; }
    const copy = target.clone();
    copy.find(`${excluded},aside,a[role='doc-backlink'],a[data-footnote-backref],a[href^='#fnref'],a[href^='#user-content-fnref']`).remove();
    if (referenceId) copy.find("a[href]").filter((_index, back) => $(back).attr("href") === `#${referenceId}`).remove();
    const note = visibleText(copy);
    if (!note) { missing.add(label); continue; }
    rescued.set(id!, { label, text: note });
    target.remove();
  }
  root.find("aside").remove();
  for (const { label, text } of rescued.values()) root.append($("<p>").text(`[${label}] ${text}`));
  return missing.size ? [`正文引用的脚注 ${[...missing].slice(0, 6).join("、")} 未在本篇正文中读取到，相关条件仍需核对。`] : [];
};

const tableText = ($: CheerioAPI, table: Cheerio<AnyNode>, warn: (message: string) => void, truncated: () => void) => {
  const lines: string[] = [];
  const fullCaption = visibleText(table.children("caption"));
  const caption = fullCaption.slice(0, maximumCellLength);
  if (caption) lines.push(caption);
  let remainingRows = maximumTableRows;
  let limited = fullCaption.length > maximumCellLength;
  const cellText = (node: Cheerio<AnyNode>) => {
    const copy = node.clone();
    if (copy.find("table").length) {
      copy.find("table").remove();
      warn("表格中的嵌套表格未展开，内部数值仍需核对原表。");
      truncated();
    }
    const value = visibleText(copy);
    if (value.length > maximumCellLength) limited = true;
    return value.slice(0, maximumCellLength);
  };
  const groups = [...table.children("thead"), ...table.children("tbody"), ...table.children("tr")];
  for (const group of groups) {
    const groupNode = $(group);
    const allRows = groupNode.is("tr") ? groupNode.toArray() : groupNode.children("tr").toArray();
    const rows = allRows.slice(0, remainingRows);
    if (rows.length < allRows.length) limited = true;
    remainingRows -= rows.length;
    const grid: Array<Array<string | undefined>> = rows.map(() => []);
    for (const [rowIndex, row] of rows.entries()) {
      let column = 0;
      for (const cell of $(row).children("th,td")) {
        const node = $(cell);
        while (grid[rowIndex]![column] !== undefined && column < maximumTableColumns) column += 1;
        if (column >= maximumTableColumns) { limited = true; break; }
        const rawColumns = node.attr("colspan") ?? "1";
        const rawRows = node.attr("rowspan") ?? "1";
        const declaredColumns = /^\d+$/u.test(rawColumns) ? Math.max(1, Number(rawColumns)) : 1;
        const declaredRows = /^\d+$/u.test(rawRows) ? Number(rawRows) : 1;
        const columns = Math.min(maximumTableColumns - column, declaredColumns);
        const rowSpan = Math.min(rows.length - rowIndex, declaredRows === 0 ? allRows.length - rowIndex : Math.max(1, declaredRows));
        if (declaredColumns > columns) limited = true;
        const value = cellText(node);
        for (let r = rowIndex; r < rowIndex + rowSpan; r += 1) {
          for (let c = column; c < column + columns; c += 1) {
            if (grid[r]![c] !== undefined) {
              warn("表格合并单元格存在交叠，已省略该表数值，需核对原表。");
              truncated();
              return caption;
            }
            // A colspan data cell describes one merged region, not several
            // independent numeric observations. Header spans label each column.
            grid[r]![c] = columns > 1 && node.is("td")
              ? c === column ? `[合并 ${declaredColumns} 列] ${value}` : "↔"
              : value;
          }
        }
        column += columns;
      }
    }
    const width = Math.min(maximumTableColumns, Math.max(0, ...grid.map((row) => row.length)));
    lines.push(...grid.map((row) => Array.from({ length: width }, (_, column) => row[column] ?? "").join("\t")));
  }
  // Footer conditions belong to the whole table. Do not repeat a colspan
  // footnote into every data column or discard it when data rows are bounded.
  const footers = table.children("tfoot").children("tr");
  if (footers.length > maximumFooterRows) limited = true;
  for (const row of footers.slice(0, maximumFooterRows)) {
    const cells = $(row).children("th,td");
    if (cells.length > maximumTableColumns) limited = true;
    lines.push(cells.slice(0, maximumTableColumns).map((_index, cell) => cellText($(cell))).get().join("\t"));
  }
  if (limited) {
    warn(`表格超过读取上限（${maximumTableRows} 行、${maximumTableColumns} 列、${maximumFooterRows} 行表注或单元格 ${maximumCellLength} 字符），已截断，未读部分仍需核对。`);
    truncated();
  }
  return lines.filter((line) => line.trim()).join("\n");
};

const createReadingBudget = (initialWarnings: string[] = []) => {
  const warnings = [...initialWarnings];
  const blocks: ArticleBlock[] = [];
  const sections: string[] = [];
  let length = 0;
  let textTruncated = false;
  let stopped = false;
  const warn = (message: string) => { if (!warnings.includes(message) && warnings.length < 12) warnings.push(message); };
  const truncated = () => { textTruncated = true; };
  const emit = (block: ArticleBlock) => {
    if (stopped || !block.text.trim()) return;
    if (blocks.length >= maximumBlocks) {
      truncated(); stopped = true; warn(`正文超过 ${maximumBlocks} 个结构块，后续内容已截断，未读条件仍需核对。`); return;
    }
    const available = maximumTextLength - length - (sections.length ? 2 : 0);
    let text = block.text;
    if (text.length > available) {
      truncated(); stopped = true; warn(`正文超过 ${maximumTextLength} 字符，后续内容已截断，未读条件仍需核对。`);
      // A cut table or code block could change a row/value or executable step.
      if (block.kind === "table" || block.kind === "code" || available <= 0) return;
      text = text.slice(0, available).trimEnd();
    }
    if (!text) return;
    if (sections.length) length += 2;
    length += text.length;
    sections.push(text);
    blocks.push({ ...block, text });
  };
  return { emit, warn, truncated, isStopped: () => stopped,
    result: () => ({ blocks, text: sections.join("\n\n"), extractionWarnings: warnings, textTruncated }) };
};

export const boundArticleBlocks = (blocks: ArticleBlock[]) => {
  const budget = createReadingBudget();
  for (const block of blocks) { budget.emit(block); if (budget.isStopped()) break; }
  return budget.result();
};

/** Text and blocks share one root, one traversal and one bounded reading budget. */
export const extractArticleStructure = (html: string, pageUrl?: string) => {
  const $ = load(html);
  $(excluded).remove();
  const root = $("article").first().length ? $("article").first() : $("main,[role='main']").first().length ? $("main,[role='main']").first() : $("body");
  root.find("article").remove();
  const budget = createReadingBudget(referencedFootnotes($, root, pageUrl));
  const { emit, warn, truncated } = budget;
  const visit = (node: AnyNode) => {
    if (budget.isStopped()) return;
    if (node.type === "text") { emit({ kind: "paragraph", text: space(node.data) }); return; }
    if (!("tagName" in node)) return;
    const tag = node.tagName.toLowerCase();
    const selected = $(node);
    if (tag === "table") { emit({ kind: "table", text: tableText($, selected, warn, truncated) }); return; }
    if (tag === "pre") {
      emit({ kind: "code", text: selected.text().replace(/\r\n?/gu, "\n"),
        ...((selected.find("code").attr("class") ?? selected.attr("class") ?? "").match(/language-([a-z0-9+-]+)/iu)?.[1]
          ? { language: (selected.find("code").attr("class") ?? selected.attr("class") ?? "").match(/language-([a-z0-9+-]+)/iu)![1] } : {}) }); return;
    }
    const nestedStructure = selected.find("table,pre,ul,ol,figure,blockquote").length > 0;
    if (blockTags.has(tag) && !nestedStructure) {
      emit({ kind: /^h[1-6]$/u.test(tag) ? "heading" : tag === "blockquote" ? "quote" : tag === "li" ? "list-item" : "paragraph", text: visibleText(selected) }); return;
    }
    let inline = "";
    const flush = () => { if (inline.trim()) emit({ kind: tag === "li" ? "list-item" : tag === "blockquote" ? "quote" : "paragraph", text: space(inline) }); inline = ""; };
    for (const child of selected.contents()) {
      if ("tagName" in child && (blockTags.has(child.tagName.toLowerCase()) || containerTags.has(child.tagName.toLowerCase()) || $(child).find(structureSelector).length)) {
        flush(); visit(child);
      } else if (child.type === "text") inline += child.data;
      else if ("tagName" in child && child.tagName.toLowerCase() !== "img") inline += $(child).text();
    }
    flush();
  };
  if (root[0]) visit(root[0]);
  return budget.result();
};
