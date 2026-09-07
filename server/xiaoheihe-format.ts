/** Workbench capacity, not a promise about every account's platform limits. */
export const imagePostCapacity = 18;
export const imagePostEditorUrl = "https://www.xiaoheihe.cn/creator/editor/draft/image_text";
export const normalizePublisherTopics = (topics: string[]) => [...new Map(topics.map(topic => {
  const value = topic.trim().replace(/^#+|#+$/gu, "").trim();
  return [value.toLocaleLowerCase(), value] as const;
}).filter(([, value]) => value)).values()];
