/** Narrow, inspectable relation checks. Unrecognised prose still needs human review. */
const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[‐‑‒–—−]/gu, "-").replace(/\s+/gu, " ").trim();
export const modelMentions = (text: string) => [...normalized(text).matchAll(/\b(?:gpt|gemini|qwen|claude|deepseek|llama|glm)[ -]*(?:(?:opus|sonnet|haiku)[ -]*)?[rv]?\d+(?:\.\d+)*(?:[ -]*(?:flash|lite|cyber|plus|pro|mini|turbo))*/gu)].map(match => match[0].replace(/[ -]+/gu, ""));
const asserted = (text: string) => !/(?:尚未|不能|无法|没有|未能)确认|\bnot (?:yet )?(?:confirmed|known)\b/iu.test(text);
const transitions = (text: string) => [...normalized(text).matchAll(/(?:从|from)\s*[$¥]?\s*(\d+(?:\.\d+)?)\s*(?:美元|元|%|usd|dollars?)?\s*(?:降(?:低)?[至到]|涨[至到]|升[至到]|调[至到]|变为|增加[至到]|减少[至到]|[至到]|to)\s*[$¥]?\s*(\d+(?:\.\d+)?)/gu)].map(match => [Number(match[1]), Number(match[2])]);
const comparisons = (text: string) => [...normalized(text).matchAll(/([a-z][a-z\d. -]*?)\s*比\s*([a-z][a-z\d. -]*?)\s*(更快|更慢|快|慢|高|低|多|少)/gu)].map(match => ({ left: match[1]!.replace(/\s+/gu,""), right: match[2]!.replace(/\s+/gu,""), direction: /快|高|多/u.test(match[3]!) ? 1 : -1 }));
export const auditFactRelations = (text: string, facts: readonly { text: string }[]) => {
  const errors: string[] = [];
  if (!asserted(text)) return errors;
  const evidence = facts.map(fact => fact.text).join("\n");
  const claimedChanges = transitions(text), sourceChanges = transitions(evidence);
  for (const [from, to] of claimedChanges) if (sourceChanges.length && !sourceChanges.some(([a,b]) => a === from && b === to)) errors.push("变化的起点、终点或方向与冻结事实不符。");
  const sourceComparisons = comparisons(evidence);
  for (const claim of comparisons(text)) if (sourceComparisons.some(source => source.left === claim.right && source.right === claim.left && source.direction === claim.direction
    || source.left === claim.left && source.right === claim.right && source.direction !== claim.direction)) errors.push("比较对象、基线或高低方向与冻结事实相反。");
  const frozenModels = new Set(modelMentions(evidence));
  for (const model of modelMentions(text)) if (!frozenModels.has(model) && [...frozenModels].some(other => other.match(/^[a-z]+/u)?.[0] === model.match(/^[a-z]+/u)?.[0])) errors.push(`型号或版本 ${model} 未出现在本段冻结事实中。`);
  for (const fact of facts) {
    if (/(?:仅限|只限|仅对).{0,18}(?:pro|plus|enterprise|付费|企业)|\bonly (?:for|on|available to).{0,18}(?:pro|paid|enterprise)/iu.test(fact.text)
      && /所有用户|全部用户|免费(?:用户|套餐)|\b(?:all users|free (?:plan|users))\b/iu.test(text)) errors.push("套餐或人群限制被扩大到免费套餐或所有用户。");
    for (const match of fact.text.matchAll(/([^。；\n]{1,24}?)(?:不支持|不允许|不能使用)([^。；\n]{2,35})/gu)) {
      const subject = normalized(match[1]!), object = normalized(match[2]!);
      const claim = normalized(text);
      if (claim.includes(subject) && claim.includes(object) && /(?:支持|允许|可以使用)/u.test(claim) && !/(?:不支持|不允许|不能使用|尚未|未确认)/u.test(claim)) errors.push("冻结事实的否定或功能限制被改成了肯定。");
    }
    const conditions = [...fact.text.matchAll(/(?:仅在|只有在)([^，。；]{2,35}?)(?:条件下|时|情况下)/gu)].map(match => normalized(match[1]!));
    if (/\d/u.test(text) && conditions.some(condition => !normalized(text).includes(condition))) errors.push("量化结果遗漏了冻结事实明确要求的适用条件。");
  }
  return [...new Set(errors)];
};
