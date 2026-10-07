import assert from "node:assert/strict";
import test from "node:test";
import { areDistinctOfficialUpdates, hasOfficialUpdateAnchor } from "./official-update-url.js";

test("ordinary links skip URL parsing when either side has no fragment", (context) => {
  let parses = 0;
  context.mock.method(globalThis, "URL", new Proxy(URL, {
    construct(target, args, newTarget) {
      parses += 1;
      return Reflect.construct(target, args, newTarget);
    },
  }));
  assert.equal(areDistinctOfficialUpdates("https://example.com/news", "https://example.com/other"), false);
  assert.equal(areDistinctOfficialUpdates("https://api-docs.deepseek.com/updates/#one", "https://api-docs.deepseek.com/updates/"), false);
  assert.equal(areDistinctOfficialUpdates("https://api-docs.deepseek.com/updates/", "https://api-docs.deepseek.com/updates/#two"), false);
  assert.equal(parses, 0);
});

test("fragment fast path preserves official event identity and rejected URL boundaries", () => {
  const urls = [
    "https://api-docs.deepseek.com/updates/#one",
    "https://api-docs.deepseek.com/updates#two",
    "https://ai.google.dev/gemini-api/docs/changelog/#one",
    "https://ai.google.dev/gemini-api/docs/changelog#two",
    "https://platform.claude.com/docs/en/release-notes/overview#one",
    "https://platform.claude.com/docs/en/release-notes/overview#two",
    "https://api-docs.deepseek.com/updates/",
    "https://api-docs.deepseek.com/updates/#",
    "https://api-docs.deepseek.com/updates/%23two",
    "https://api-docs.deepseek.com:443/updates/#two",
    "https://api-docs.deepseek.com:8443/updates/#two",
    "https://user:password@api-docs.deepseek.com/updates/#two",
    "http://api-docs.deepseek.com/updates/#two",
    "https://api-docs.deepseek.com/another-page#two",
    "https://example.com/updates/#one",
    "https://example.com/updates/#two",
    " https://api-docs.deepseek.com/updates/#two\n",
    "malformed#two",
    "",
  ];
  const reference = (left: string, right: string) => {
    try {
      const a = new URL(left);
      const b = new URL(right);
      return hasOfficialUpdateAnchor(a) && hasOfficialUpdateAnchor(b)
        && a.hostname === b.hostname && a.pathname.replace(/\/$/u, "") === b.pathname.replace(/\/$/u, "")
        && a.hash !== b.hash;
    } catch { return false; }
  };
  for (const left of urls) for (const right of urls) {
    assert.equal(areDistinctOfficialUpdates(left, right), reference(left, right), `${left} / ${right}`);
  }
  assert.equal(areDistinctOfficialUpdates(urls[0], urls[1]), true);
  assert.equal(areDistinctOfficialUpdates(urls[2], urls[3]), true);
  assert.equal(areDistinctOfficialUpdates(urls[4], urls[5]), true);
});
