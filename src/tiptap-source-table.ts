import { Node } from "@tiptap/core";

// Small schema for source tables: preserve cells during editing without adding a grid designer.
const SourceTable = Node.create({
  name: "sourceTable", group: "block", content: "sourceTableRow+", isolating: true,
  parseHTML: () => [{ tag: "table" }],
  renderHTML: () => ["table", { class: "source-table" }, ["tbody", 0]],
});
const SourceTableRow = Node.create({
  name: "sourceTableRow", content: "(sourceTableCell | sourceTableHeader)+",
  parseHTML: () => [{ tag: "tr" }], renderHTML: () => ["tr", 0],
});
const SourceTableCell = Node.create({
  name: "sourceTableCell", content: "block+", isolating: true,
  parseHTML: () => [{ tag: "td" }], renderHTML: () => ["td", 0],
});
const SourceTableHeader = Node.create({
  name: "sourceTableHeader", content: "block+", isolating: true,
  parseHTML: () => [{ tag: "th" }], renderHTML: () => ["th", 0],
});
export const sourceTableExtensions = [SourceTable, SourceTableRow, SourceTableCell, SourceTableHeader];
