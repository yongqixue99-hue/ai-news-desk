const normalizedKey = (value: string) => value.trim().toLocaleLowerCase("zh-CN");

export const rememberRecentValues = (
  existing: string[],
  used: string[],
  limit = 20,
) => {
  const seen = new Set<string>();
  const values: string[] = [];
  for (const raw of [...used, ...existing]) {
    const value = raw.trim();
    const key = normalizedKey(value);
    if (!value || seen.has(key)) continue;
    seen.add(key);
    values.push(value);
    if (values.length >= limit) break;
  }
  return values;
};
