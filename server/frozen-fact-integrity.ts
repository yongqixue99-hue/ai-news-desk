/**
 * A bounded contradiction detector, not semantic entailment. It checks typed
 * quantities/dates and a few explicit scope reversals against selected frozen
 * facts. Passing says nothing about unrecognised names, causality or prose.
 */
export interface FrozenFactIntegrityIssue {
  code: "quantity-not-supported" | "date-not-supported" | "scope-contradiction" | "attribution-missing";
  message: string;
}

export interface FrozenFactIntegrityReport {
  passed: boolean;
  errors: FrozenFactIntegrityIssue[];
  warnings: FrozenFactIntegrityIssue[];
  checkedQuantities: number;
}

const numberSource = "(?:\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万亿]+|one|two|three|four|five|six|seven|eight|nine|ten)";
const scaleSource = "(?:thousand|million|billion|trillion|[kmbt]|千|万|亿)";
const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const numeric = (input: string): number => {
  const value = input.toLowerCase().replace(/,/gu, "");
  if (/^\d/u.test(value)) return Number(value);
  if (words.includes(value)) return words.indexOf(value);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000, 亿: 100000000 };
  let total = 0; let section = 0; let digit = 0;
  for (const character of value) {
    if (character in digits) { digit = digits[character]!; continue; }
    const unit = units[character];
    if (!unit) return NaN;
    if (unit < 10000) { section += (digit || 1) * unit; digit = 0; }
    else if (unit === 10000) { total += (section + digit || 1) * unit; section = 0; digit = 0; }
    else { total = (total + section + digit || 1) * unit; section = 0; digit = 0; }
  }
  return total + section + digit;
};
const scale = (input = "") => ({ k: 1e3, thousand: 1e3, 千: 1e3, 万: 1e4,
  m: 1e6, million: 1e6, b: 1e9, billion: 1e9, 亿: 1e8, t: 1e12, trillion: 1e12,
})[input.toLowerCase() as "k"] ?? 1;
const normal = (input: string) => input.normalize("NFKC").replace(/https?:\/\/[^\s<>]+/giu, " ");

interface Quantity {
  kind: string;
  value: number;
  raw: string;
  perTokens?: number;
  direction?: "input" | "output";
}
interface DateAnchor { value: string; raw: string }
interface Span { start: number; end: number }
const overlap = (start: number, end: number, spans: Span[]) => spans.some((span) => start < span.end && end > span.start);
const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const calendar = (year: number | undefined, month: number, day: number) => {
  const date = new Date(Date.UTC(year ?? 2000, month - 1, day));
  if (date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || (year !== undefined && date.getUTCFullYear() !== year)) return undefined;
  return `${year ?? "--"}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const quantities = (input: string) => {
  const text = normal(input);
  const result: Quantity[] = [];
  const dates: DateAnchor[] = [];
  const occupied: Span[] = [];
  const addDate = (match: RegExpExecArray, value: string | undefined) => {
    if (!value) return;
    dates.push({ value, raw: match[0] });
    occupied.push({ start: match.index, end: match.index + match[0].length });
  };
  for (const match of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/gu)) addDate(match, calendar(Number(match[1]), Number(match[2]), Number(match[3])));
  const chineseDate = new RegExp(`(?:(${numberSource})\\s*年\\s*)?(${numberSource})\\s*月\\s*(${numberSource})\\s*[日号]`, "giu");
  for (const match of text.matchAll(chineseDate)) addDate(match, calendar(match[1] ? numeric(match[1]) : undefined, numeric(match[2]!), numeric(match[3]!)));
  const englishDate = new RegExp(`\\b(${monthNames.join("|")})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`, "giu");
  for (const match of text.matchAll(englishDate)) addDate(match, calendar(Number(match[3]), monthNames.findIndex((month) => month.toLowerCase() === match[1]!.toLowerCase()) + 1, Number(match[2])));

  const denominators: Array<{ value: number; span: Span }> = [];
  const denominatorPattern = new RegExp(`(?:\\bper\\s+|/\\s*|每\\s*)(?:(${numberSource})\\s*)?(${scaleSource})?\\s*(?:input\\s+|output\\s+|输入\\s*|输出\\s*)?(?:tokens?\\b|令牌)`, "giu");
  for (const match of text.matchAll(denominatorPattern)) {
    const span = { start: match.index, end: match.index + match[0].length };
    denominators.push({ value: (match[1] ? numeric(match[1]) : 1) * scale(match[2]), span });
    occupied.push(span);
  }
  const money = new RegExp(`([$¥€£])\\s*(${numberSource})\\s*(${scaleSource})?|(${numberSource})\\s*(${scaleSource})?\\s*(美元|美金|人民币|元|USD\\b|CNY\\b|EUR\\b|GBP\\b|dollars?\\b|euros?\\b)`, "giu");
  for (const match of text.matchAll(money)) {
    const start = match.index; const end = start + match[0].length;
    const prefix = text.slice(0, start);
    const clauseStart = Math.max(prefix.lastIndexOf("。"), prefix.lastIndexOf(";"), prefix.lastIndexOf("；"), prefix.lastIndexOf("，"), prefix.lastIndexOf("\n")) + 1;
    const suffix = text.slice(end).search(/[。;；，\n]/u);
    const clauseEnd = suffix < 0 ? text.length : end + suffix;
    const clause = text.slice(clauseStart, clauseEnd);
    const unit = (match[1] ?? match[6]!).toLowerCase();
    const kind = /^(?:\$|usd|美元|美金|dollars?)$/u.test(unit) ? "USD" : /^(?:€|eur|euros?)$/u.test(unit) ? "EUR" : /^(?:£|gbp)$/u.test(unit) ? "GBP" : "CNY";
    const localDenominators = denominators.filter((entry) => entry.span.start >= clauseStart && entry.span.end <= clauseEnd);
    const perTokens = localDenominators.length === 1 ? localDenominators[0]!.value : undefined;
    const inputPrice = /\binput\b|输入/iu.test(clause);
    const outputPrice = /\boutput\b|输出/iu.test(clause);
    result.push({ kind, value: numeric(match[2] ?? match[4]!) * scale(match[3] ?? match[5]), raw: match[0], perTokens,
      direction: inputPrice !== outputPrice ? inputPrice ? "input" : "output" : undefined });
    occupied.push({ start, end });
  }
  // Only explicit percent/multiplier ranges share a trailing unit here. Check
  // both endpoints; this does not infer interval ordering or other range types.
  const rangeUnits = [
    { kind: "percent", unit: "(?:%|percent\\b|per cent\\b)", label: "%" },
    { kind: "multiplier", unit: "(?:倍|x(?![a-z\\d]))", label: "倍" },
  ];
  for (const { kind, unit, label } of rangeUnits) {
    const patterns = [
      `(?<![a-z\\d.])(${numberSource})\\s*(?:${unit})?\\s*(?:[-–—~～]|至|到|\\bto\\b)\\s*(${numberSource})\\s*${unit}`,
      `(?<![a-z\\d.])between\\s+(${numberSource})\\s*(?:${unit})?\\s+and\\s+(${numberSource})\\s*${unit}`,
    ];
    for (const pattern of patterns) {
      for (const match of text.matchAll(new RegExp(pattern, "giu"))) {
        if (overlap(match.index, match.index + match[0].length, occupied)) continue;
        result.push({ kind, value: numeric(match[1]!), raw: `${match[1]}${label}` },
          { kind, value: numeric(match[2]!), raw: `${match[2]}${label}` });
        occupied.push({ start: match.index, end: match.index + match[0].length });
      }
    }
  }
  const multiplier = new RegExp(`(?<![a-z\\d.])(${numberSource})\\s*(?:倍|x(?![a-z\\d]))`, "giu");
  for (const match of text.matchAll(multiplier)) {
    if (overlap(match.index, match.index + match[0].length, occupied)) continue;
    result.push({ kind: "multiplier", value: numeric(match[1]!), raw: match[0] });
    occupied.push({ start: match.index, end: match.index + match[0].length });
  }
  const percent = new RegExp(`(${numberSource})\\s*(?:%|percent\\b|per cent\\b)|百分之\\s*(${numberSource})`, "giu");
  for (const match of text.matchAll(percent)) {
    if (overlap(match.index, match.index + match[0].length, occupied)) continue;
    result.push({ kind: "percent", value: numeric(match[1] ?? match[2]!), raw: match[0] });
    occupied.push({ start: match.index, end: match.index + match[0].length });
  }
  const parameterLead = new RegExp(`(?:parameters?(?: count)?|参数量|参数规模)\\s*(?:is\\s*|of\\s*|为\\s*|[:：]\\s*)?(${numberSource})\\s*(${scaleSource})?`, "giu");
  for (const match of text.matchAll(parameterLead)) {
    result.push({ kind: "parameters", value: numeric(match[1]!) * scale(match[2]), raw: match[0] });
    occupied.push({ start: match.index, end: match.index + match[0].length });
  }
  const measure = new RegExp(`(${numberSource})[\\s-]*(${scaleSource})?[\\s-]*(tokens?\\b|令牌|parameters?\\b|(?:个)?参数|GB\\b|MB\\b|TB\\b|KB\\b|GiB\\b|MiB\\b|gigabytes?\\b|megabytes?\\b|terabytes?\\b|kilobytes?\\b|milliseconds?\\b|ms\\b|seconds?\\b|minutes?\\b|hours?\\b|days?\\b|weeks?\\b|毫秒|秒钟|秒|分钟|小时|天|周)`, "giu");
  for (const match of text.matchAll(measure)) {
    if (overlap(match.index, match.index + match[0].length, occupied)) continue;
    const unit = match[3]!.toLowerCase();
    let kind = unit; let multiplier = 1;
    if (/^(?:tokens?|令牌)$/u.test(unit)) kind = "tokens";
    else if (/^(?:parameters?|个?参数)$/u.test(unit)) kind = "parameters";
    else if (/^(?:[gmtk]b|[gm]ib|(?:giga|mega|tera|kilo)bytes?)$/u.test(unit)) {
      kind = "bytes"; multiplier = unit === "gib" ? 2 ** 30 : unit === "mib" ? 2 ** 20
        : /^(?:gb|giga)/u.test(unit) ? 1e9 : /^(?:mb|mega)/u.test(unit) ? 1e6 : /^(?:tb|tera)/u.test(unit) ? 1e12 : 1e3;
    } else {
      kind = "seconds";
      multiplier = /^(?:milliseconds?|ms|毫秒)$/u.test(unit) ? .001
        : /^(?:minutes?|分钟)$/u.test(unit) ? 60
          : /^(?:hours?|小时)$/u.test(unit) ? 3600
            : /^(?:days?|天)$/u.test(unit) ? 86400
              : /^(?:weeks?|周)$/u.test(unit) ? 604800 : 1;
    }
    result.push({ kind, value: numeric(match[1]!) * scale(match[2]) * multiplier, raw: match[0] });
  }
  return { values: result.filter((item) => Number.isFinite(item.value)), dates };
};

const equalNumber = (left: number, right: number) => Math.abs(left - right) <= Math.max(Math.abs(left), Math.abs(right), 1) * 1e-10;
const supportedQuantity = (claim: Quantity, fact: Quantity) => {
  if (claim.kind !== fact.kind) return false;
  if (claim.direction && fact.direction && claim.direction !== fact.direction) return false;
  if (claim.perTokens !== undefined) return fact.perTokens !== undefined
    && equalNumber(claim.value / claim.perTokens, fact.value / fact.perTokens);
  return equalNumber(claim.value, fact.value);
};

// Keep the scope rules narrow: "not independently verified" must neither
// trigger a false contradiction nor authorize "independently verified".
const explicitlyAsserted = (text: string, pattern: RegExp) => {
  for (const match of text.matchAll(new RegExp(pattern.source, "giu"))) {
    const prefix = text.slice(Math.max(0, match.index - 28), match.index).split(/[，,。;；\n!?！？]/u).at(-1) ?? "";
    const suffix = text.slice(match.index + match[0].length, match.index + match[0].length + 20);
    if (/(?:并非|不是|不等于|尚未|仍未|暂未|未经|不能|没有|未|不|\bnot|\bwithout)[\p{L}\s]{0,7}$/iu.test(prefix)) continue;
    if (/^\s*(?:的)?(?:结果|价格)?(?:尚|仍|暂)?(?:未|没有|未知|不明确)|^\s+(?:is\s+)?(?:not|unknown)\b/iu.test(suffix)) continue;
    if (/^[^。;；\n]{0,14}[?？]/u.test(suffix)) continue;
    return true;
  }
  return false;
};

export const auditFrozenFactIntegrity = (
  text: string,
  facts: readonly { text: string }[],
  options: { attributionContext?: string } = {},
): FrozenFactIntegrityReport => {
  const claimed = quantities(text);
  const frozen = facts.map((fact) => quantities(fact.text));
  const supported = frozen.flatMap((fact) => fact.values);
  const supportedDates = frozen.flatMap((fact) => fact.dates);
  const errors: FrozenFactIntegrityIssue[] = [];
  const warnings: FrozenFactIntegrityIssue[] = [];
  for (const value of claimed.values) {
    if (!supported.some((fact) => supportedQuantity(value, fact))) errors.push({ code: "quantity-not-supported",
      message: `数量或计量条件“${value.raw}”无法回到本段引用的冻结事实，请核对数值、单位和计费分母。` });
  }
  for (const value of claimed.dates) {
    if (!supportedDates.some((date) => date.value === value.value || (value.value.startsWith("---") && date.value.endsWith(value.value.slice(2))))) {
      errors.push({ code: "date-not-supported", message: `日期“${value.raw}”不符合本段引用的冻结事实。` });
    }
  }
  const evidence = facts.map((fact) => fact.text).join("\n");
  const selfTest = explicitlyAsserted(evidence, /官方自测|厂商自测|内部测试|公司自测|\b(?:our|internal|in-house) (?:tests?|testing|benchmarks?|evaluations?)\b/iu);
  const independent = /第三方(?:实测|评测|验证)|独立(?:实测|评测|验证)|\bindependent (?:tests?|benchmarks?|verification)\b/iu;
  if (selfTest && explicitlyAsserted(text, independent) && !explicitlyAsserted(evidence, independent)) {
    errors.push({ code: "scope-contradiction", message: "冻结事实只有官方自测，正文不能改称第三方或独立验证。" });
  }
  const cacheHit = explicitlyAsserted(evidence, /缓存命中|缓存读取|\bcach(?:e|ed)[ -]?(?:hits?|reads?)\b/iu);
  const cacheMiss = /未命中缓存|缓存未命中|\bcache[ -]miss/iu;
  if (cacheHit && explicitlyAsserted(text, cacheMiss) && !explicitlyAsserted(evidence, cacheMiss)) {
    errors.push({ code: "scope-contradiction", message: "冻结事实描述缓存命中价格，正文不能改成未命中价格。" });
  }
  const previewOnly = /仅.{0,12}(?:预览|测试)|(?:预览|测试)版|\b(?:limited|private|public|research) preview\b/iu.test(evidence);
  const availability = /(?:全面|正式)(?:上线|开放|商用)|\bgenerally available\b/iu;
  if (previewOnly && explicitlyAsserted(text, availability) && !explicitlyAsserted(evidence, availability)) {
    errors.push({ code: "scope-contradiction", message: "冻结事实仍是预览或测试阶段，正文不能升格为正式商用。" });
  }
  const attribution = `${text}\n${options.attributionContext ?? ""}`;
  if (selfTest && claimed.values.length && !/官方|厂商|公司|团队|文中|自测|内部测试|据.{0,30}(?:称|表示|报告|测试)|\b(?:according to|reported|our|internal|vendor)\b/iu.test(attribution)) {
    warnings.push({ code: "attribution-missing", message: "本段量化结果来自官方自测，建议在上下文保留测试方归属。" });
  }
  return { passed: errors.length === 0, errors: errors.filter((issue, index, all) => all.findIndex((other) => other.message === issue.message) === index),
    warnings, checkedQuantities: claimed.values.length + claimed.dates.length };
};
