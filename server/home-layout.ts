export const homeSources = ["news", "zhihu", "hackernews", "v2ex", "github"] as const;
export type HomeSource = typeof homeSources[number];
export interface HomeColumn { id: string; label: string; source: HomeSource; keyword?: string }
export interface HomeLayout { columns: HomeColumn[]; showDrafts: boolean }
export const defaultHomeLayout: HomeLayout = { showDrafts: true, columns: [
  { id: "news", label: "AI 新闻", source: "news" }, { id: "zhihu", label: "知乎", source: "zhihu" },
  { id: "hackernews", label: "Hacker News", source: "hackernews" }, { id: "v2ex", label: "V2EX", source: "v2ex" },
  { id: "github", label: "GitHub", source: "github" },
] };

export const parseHomeLayout = (raw: unknown): HomeLayout => {
  if (!raw || typeof raw !== "object" || !("columns" in raw) || !Array.isArray(raw.columns) || !raw.columns.length || raw.columns.length > 12) throw new Error("请保留 1 至 12 个栏目");
  if (!("showDrafts" in raw) || typeof raw.showDrafts !== "boolean") throw new Error("稿件显示设置无效");
  const ids = new Set<string>();
  const columns = raw.columns.map((column): HomeColumn => {
    if (!column || typeof column !== "object" || typeof column.id !== "string" || !/^[a-z\d-]{1,64}$/u.test(column.id) || ids.has(column.id)) throw new Error("栏目编号无效或重复");
    ids.add(column.id);
    if (typeof column.label !== "string" || !column.label.trim() || column.label.length > 24) throw new Error("栏目名称请保持在 24 字以内");
    const source = homeSources.find((value) => value === column.source);
    if (!source) throw new Error("请选择已接入的来源");
    if (column.keyword !== undefined && (typeof column.keyword !== "string" || column.keyword.length > 120)) throw new Error("关键词请保持在 120 字以内");
    return { id: column.id, label: column.label.trim(), source, keyword: column.keyword?.trim() || undefined };
  });
  return { columns, showDrafts: raw.showDrafts };
};

export const homeLayoutFor = (raw: unknown): HomeLayout => {
  try { return parseHomeLayout(raw); } catch { return structuredClone(defaultHomeLayout); }
};

export const matchesHomeKeyword = (texts: Array<string | undefined>, keyword?: string) => !keyword?.trim()
  || texts.join(" ").normalize("NFKC").toLocaleLowerCase().includes(keyword.trim().normalize("NFKC").toLocaleLowerCase());
