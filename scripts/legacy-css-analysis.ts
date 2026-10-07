import postcss, { type Rule, type Container, type Document } from "postcss";

/** Conservative evidence of use. CSS is deliberately not reference material. */
export function auditLegacyCss(css: string, references: string[]) {
  const reference = references.join("\n");
  const prefixes = [...reference.matchAll(/[`"']([^`"'\n]*?)(?:\$\{|["']\s*\+)/gu)]
    .map(match => match[1]!.trim().split(/\s+/u).at(-1)!)
    .filter(prefix => /^[\w-]+$/u.test(prefix));
  const used = (name: string) => reference.includes(name) || prefixes.some(prefix => name.startsWith(prefix));
  const root = postcss.parse(css);
  const removedSelectors: string[] = [];
  root.walkRules(rule => {
    // Unknown syntax is retained. :not(.missing), for example, matches live nodes.
    const selectors: string[] = [rule.selector];
    let ancestor: Container | Document | undefined = rule.parent;
    while (ancestor) {
      if (ancestor.type === "rule") selectors.push((ancestor as Rule).selector);
      ancestor = ancestor.parent;
    }
    rule.walkRules(child => { selectors.push(child.selector); });
    if (selectors.some(selector => /[\\\[(]|layout-|preview-article-title/u.test(selector))) return;
    if (selectors.some(selector => selector.split(",").some(arm => !/\.[\w-]+/u.test(arm)))) return;
    const classes = selectors.flatMap(selector => [...selector.matchAll(/\.([\w-]+)/gu)].map(match => match[1]!));
    if (!classes.length || classes.some(used)) return;
    removedSelectors.push(rule.selector);
    rule.remove();
  });
  const result = root.toString();
  return { css: result, removedSelectors, beforeBytes: Buffer.byteLength(css), afterBytes: Buffer.byteLength(result) };
}
