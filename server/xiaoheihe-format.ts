/** Workbench capacity, not a promise about every account's platform limits. */
export const imagePostCapacity = 18;
export const imagePostEditorUrl = "https://www.xiaoheihe.cn/creator/editor/draft/image_text";

export const xiaoheiheTitleLimit = 30;

/** Matches the creator editor counter: Latin-1 is half-width, other UTF-16
 * units are full-width, and the displayed total is rounded down. Verified
 * against the live editor on 2026-09-22, including odd half-width totals. */
export const xiaoheiheTitleLength = (title: string) => Math.floor(
  title.trim().replace(/[^\u0000-\u00ff]/g, "xx").length / 2,
);

export const normalizePublisherTopics = (topics: string[]) => [...new Map(topics.map(topic => {
  const value = topic.trim().replace(/^#+|#+$/gu, "").trim();
  return [value.toLocaleLowerCase(), value] as const;
}).filter(([, value]) => value)).values()];
