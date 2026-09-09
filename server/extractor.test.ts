import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

import {
  extractArticleFromModuleSource,
  extractImageUrlsFromModuleSource,
  extractArticleImageCandidates,
  downloadSourceImage,
  extractPageContent,
  extractPage,
  extractArticleBlocks,
} from "./extractor.js";
import { readQwenArticleSource } from "./qwen-article-source.js";

test("table spans keep values aligned with both header levels and retain caption and footer conditions", async () => {
  const html = '<article><table><caption>Price per million tokens</caption><thead><tr><th rowspan="2">Model</th><th colspan="2">Price</th></tr><tr><th>Input</th><th>Output</th></tr></thead><tbody><tr><th rowspan="2">Nova</th><td>$1</td><td>$2</td></tr><tr><td>$3</td><td>$4</td></tr></tbody><tfoot><tr><td colspan="3">Introductory billing only.</td></tr></tfoot></table></article>';
  const page = await extractPageContent(html, new URL("https://publisher.example/model"));
  const table = page.blocks?.find((block) => block.kind === "table")?.text ?? "";
  assert.match(table, /Model\tPrice\tPrice\nModel\tInput\tOutput/u);
  assert.match(table, /Nova\t\$1\t\$2\nNova\t\$3\t\$4/u);
  assert.match(table, /Price per million tokens/u);
  assert.equal(table.match(/Introductory billing only\./gu)?.length, 1);
  assert.match(page.text, /\$1\s+\$2/u, "adjacent cells must not concatenate into a different number");
});

test("referenced article footnotes survive an aside without admitting related stories or page footer text", async () => {
  const html = `<article><p>Input costs $1<sup><a href="#fn-price" id="fnref-price">1</a></sup>.</p>
    <aside class="footnotes"><ol><li id="fn-price" role="doc-footnote">Price applies through December 31, 2026 only.<a role="doc-backlink" href="#fnref-price">↩</a></li></ol></aside>
    <aside><p>Suggested unrelated price $99.</p></aside><section class="related-articles"><p>Other model price $999.</p></section>
    <footer><p>Footer campaign costs $888.</p></footer></article>`;
  const page = await extractPageContent(html, new URL("https://publisher.example/model"));
  assert.match(page.text, /\[1\].*Price applies through December 31, 2026 only\./su);
  assert.ok(page.blocks?.some((block) => block.text.includes("Price applies through December 31, 2026 only.")));
  assert.doesNotMatch(page.text, /\$99|\$999|\$888|↩/u);
  assert.equal(page.extractionWarnings?.length ?? 0, 0);
});

test("footnote references cannot pull evidence from another article or a navigation footer", async () => {
  const html = `<main><article><p>Reported score 80<sup><a href="#fn-external">1</a></sup> and cost 2<sup><a href="#fn-promo">2</a></sup>.</p>
    <footer><p id="fn-promo">Unrelated offer $999.</p></footer></article>
    <article><p id="fn-external" role="doc-footnote">Different event tested 99 times.</p></article></main>`;
  const page = await extractPageContent(html, new URL("https://publisher.example/model"));
  assert.doesNotMatch(page.text, /Different event|\$999/u);
  assert.ok(page.extractionWarnings?.some((warning) => /脚注/u.test(warning)));
  assert.doesNotMatch(page.text, /801/u, "footnote labels must not merge with the preceding number");
});

test("publisher footnote component in the same main is read only when it links back to this article", async () => {
  const html = await readFile(new URL("./fixtures/article-google-external-footnote.html", import.meta.url), "utf8");
  const page = await extractPageContent(html, new URL("https://publisher.example/model"));
  assert.match(page.text, /December 31, 2026/u);
  assert.match(page.text, /January 1, 2027: input \$1\.50\/1M, output \$7\.50\/1M/u);
  assert.ok(page.blocks?.some((block) => block.text.includes("Promotional pricing ends")));
  assert.doesNotMatch(page.text, /\$999|\$888/u);
  assert.equal(page.extractionWarnings?.length ?? 0, 0);
  const mismatched = await extractPageContent(html.replace('href="#footnote-source-1"', 'href="#different-story"'), new URL("https://publisher.example/model"));
  assert.doesNotMatch(mismatched.text, /\$1\.50|\$7\.50/u);
  assert.ok(mismatched.extractionWarnings?.some((warning) => /脚注/u.test(warning)));
  const duplicated = await extractPageContent(html.replace('</uni-footnotes>', '<div id="footnote-1"><a href="#footnote-source-1">1</a>Duplicate note costs $222.</div></uni-footnotes>'), new URL("https://publisher.example/model"));
  assert.doesNotMatch(duplicated.text, /\$1\.50|\$7\.50|\$222/u);
  assert.ok(duplicated.extractionWarnings?.some((warning) => /脚注/u.test(warning)));
  const ambiguousBacklink = await extractPageContent(html.replace('<article><p id="footnote-elsewhere">', '<article><a id="footnote-source-1" href="#footnote-1">1</a><p id="footnote-elsewhere">'), new URL("https://publisher.example/model"));
  assert.doesNotMatch(ambiguousBacklink.text, /\$1\.50|\$7\.50/u);
  assert.ok(ambiguousBacklink.extractionWarnings?.some((warning) => /脚注/u.test(warning)));
});

test("figure captions are evidence blocks exactly once and do not absorb the author biography", async () => {
  const html = `<article><figure><img src="/chart.png"><figcaption><p>Score is measured with a 20-token budget.</p></figcaption></figure>
    <figure><img src="/second.png"><figcaption>Results exclude private tasks.</figcaption></figure>
    <section class="author-mini-bio"><p>Unrelated author biography.</p></section></article>`;
  const page = await extractPageContent(html, new URL("https://publisher.example/model"));
  assert.equal(page.blocks?.filter((block) => block.text === "Score is measured with a 20-token budget.").length, 1);
  assert.equal(page.blocks?.filter((block) => block.text === "Results exclude private tasks.").length, 1);
  assert.doesNotMatch(page.text, /author biography/u);
});

test("long body and large table omissions are explicitly reported instead of claiming a complete read", async () => {
  const page = await extractPageContent(`<article><p>${"word ".repeat(7000)}</p><p>Final constraint.</p></article>`, new URL("https://publisher.example/long"));
  assert.equal(page.textTruncated, true);
  assert.ok(page.text.length <= 30_000);
  assert.ok(page.extractionWarnings?.some((warning) => /截断/u.test(warning)));
  const rows = Array.from({ length: 210 }, (_, index) => `<tr><td>Entry ${index}</td><td>${index}</td></tr>`).join("");
  const tablePage = await extractPageContent(`<article><table><tbody>${rows}</tbody></table></article>`, new URL("https://publisher.example/large-table"));
  assert.ok(tablePage.extractionWarnings?.some((warning) => /表格/u.test(warning)));
  assert.equal(tablePage.textTruncated, true);
});

test("standalone article block extraction retains ordinary paragraphs, code spacing and table boundaries", () => {
  const blocks = extractArticleBlocks('<article><p>First paragraph.</p><pre><code class="language-python">for x in xs:\n    print(x)</code></pre><table><tr><th>Mode</th><th>Limit</th></tr><tr><td>Basic</td><td>5</td></tr></table></article>');
  assert.deepEqual(blocks, [
    { kind: "paragraph", text: "First paragraph." },
    { kind: "code", text: "for x in xs:\n    print(x)", language: "python" },
    { kind: "table", text: "Mode\tLimit\nBasic\t5" },
  ]);
});

test("tables inside publisher custom containers and list items preserve cell boundaries", async () => {
  const page = await extractPageContent('<article><devsite-tabs><section><table><tr><th>Mode</th><th>Price</th></tr><tr><td>Standard</td><td>$2</td></tr></table></section></devsite-tabs><ul><li>Paid tier:<table><tr><td>Limit</td><td>50</td></tr></table><p>Available only in preview.</p></li></ul></article>', new URL("https://publisher.example/model"));
  assert.equal(page.blocks?.filter((block) => block.kind === "table").length, 2);
  assert.match(page.text, /Standard\t\$2/u);
  assert.match(page.text, /Limit\t50/u);
  assert.equal(page.text.match(/Available only in preview\./gu)?.length, 1);
});

test("module fallback text and blocks share the same explicit reading limit", async () => {
  const originalFetch = globalThis.fetch;
  const module = Array.from({ length: 7 }, (_, index) => `(0,d.jsx)(t.p,{children:\`${index}: ${"long text ".repeat(1000)}\`})`).join(";");
  globalThis.fetch = async () => new Response(module, { headers: { "content-type": "text/javascript" } });
  try {
    const page = await extractPageContent('<html><head><script type="module" src="/article.js"></script></head><body><p>Loading article.</p></body></html>', new URL("https://8.8.8.8/article"), undefined, 0);
    assert.equal(page.textTruncated, true);
    assert.equal(page.blocks?.map((block) => block.text).join("\n\n"), page.text);
    assert.ok(page.text.length <= 30_000);
    assert.doesNotMatch(page.text, /Loading article/u);
    assert.ok(page.extractionWarnings?.some((warning) => /截断/u.test(warning)));
  } finally { globalThis.fetch = originalFetch; }
});

test("Qwen article reads its exact official index record and retains its own title, date, query identity and tables", async () => {
  const calls: string[] = [];
  const fetcher = async (input: string) => {
    calls.push(input);
    return new Response(JSON.stringify({ data: { articles: [
      { path: "selected-article", title: "Official model evaluation", extra: { date: "2026-09-03", author: "Publisher team" }, content: '<html><head><link rel="canonical" href="https://legacy.example/wrong"></head><body><article><p>Selected evidence.</p><table><tr><th>Budget</th><th>Score</th></tr><tr><td>10</td><td>50</td></tr></table><img src="https://cdn.example/selected.png"></article></body></html>' },
      { path: "other-article", title: "Other event", content: "<p>Unrelated $999.</p>" },
    ] } }), { headers: { "content-type": "application/json" } });
  };
  // The article fixture must not depend on the current machine's DNS or proxy
  // setup. Production callers still use the fail-closed validator and reader.
  const page = await extractPage(
    "https://qwen.ai/blog?id=selected-article&utm_source=test",
    8,
    { validateUrl: async (rawUrl) => new URL(rawUrl), readQwenArticle: (url) => readQwenArticleSource(url, { fetcher }) },
  );
  assert.equal(page.title, "Official model evaluation");
  assert.equal(page.author, "Publisher team");
  assert.equal(page.publishedAt, "2026-09-03T00:00:00.000Z");
  assert.equal(page.canonicalUrl, "https://qwen.ai/blog?id=selected-article");
  assert.equal(page.url, page.canonicalUrl);
  assert.match(page.text, /10\t50/u);
  assert.doesNotMatch(page.text, /Other event|\$999/u);
  assert.equal(page.images[0]?.sourceUrl, page.canonicalUrl);
  assert.equal(calls.length, 1);
  assert.ok(!calls[0]?.startsWith("https://qwen.ai/blog"), "must fetch the fixed official index, not the unreadable SPA shell");
});

test("extractor binds update text, date, canonical URL and images to the selected event", async () => {
  const url = new URL("https://ai.google.dev/gemini-api/docs/changelog#09-02-2026");
  const html = `<html><head><link rel="canonical" href="https://ai.google.dev/gemini-api/docs/changelog"><meta property="og:image" content="https://example.com/unrelated.png"></head>
    <main><article><div class="devsite-article-body"><h2 id="09-03-2026">September 3, 2026</h2><p>Other update costs $999.</p><img src="/other.png">
    <h2 id="09-02-2026">September 2, 2026</h2><p><strong>Aster model launch</strong> is available via API.</p><img src="/selected.png" alt="Selected capability chart">
    <h2 id="09-01-2026">September 1, 2026</h2><p>Older pricing is $444.</p></div></article></main></html>`;
  const page = await extractPageContent(html, new URL("https://ai.google.dev/gemini-api/docs/changelog"), url);
  assert.equal(page.canonicalUrl, url.href);
  assert.equal(page.url, url.href);
  assert.equal(page.publishedAt, "2026-09-02T00:00:00.000Z");
  assert.equal(page.title, "Aster model launch");
  assert.doesNotMatch(page.text, /999|444|Other update|Older pricing/u);
  assert.deepEqual(page.images.map((image) => image.url), ["https://ai.google.dev/selected.png"]);
  assert.ok(page.images.every((image) => image.sourceUrl === url.href));
  await assert.rejects(extractPageContent(html, new URL("https://example.com/redirect"), url), /重定向/u);
  await assert.rejects(extractPageContent(html, new URL("https://ai.google.dev/gemini-api/docs/changelog#missing")), /不存在/u);
});

test("official CDN charts served as octet-stream are decoded and saved with their real dimensions", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "news-cdn-chart-"));
  const originalFetch = globalThis.fetch;
  const bytes = await sharp({ create: { width: 800, height: 600, channels: 3, background: "white" } }).webp().toBuffer();
  globalThis.fetch = async () => new Response(bytes, { headers: { "content-type": "application/octet-stream" } });
  try {
    const image = await downloadSourceImage({
      id: "chart", url: "https://8.8.8.8/chart.bin", sourceUrl: "https://publisher.example/release",
      caption: "Model benchmark", attribution: "Publisher", selected: false, rights: "check-required",
    }, "pilot", { mediaRoot: root });
    assert.equal(image.width, 800);
    assert.equal(image.height, 600);
    assert.equal(path.extname(image.localPath!), ".webp");
    assert.equal(image.localPath!.startsWith(root + path.sep), true);
    assert.deepEqual(await readFile(image.localPath!), bytes);
    assert.equal(image.rights, "check-required");
    assert.match(image.fingerprint!, /^[a-f0-9]{64}$/u);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("octet-stream does not allow HTML or an error page to become a source image", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "news-cdn-error-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<html>Access denied</html>", { headers: { "content-type": "application/octet-stream" } });
  try {
    await assert.rejects(downloadSourceImage({
      id: "error", url: "https://8.8.8.8/chart.webp", sourceUrl: "https://publisher.example/release",
      caption: "Model benchmark", attribution: "Publisher", selected: false, rights: "check-required",
    }, "pilot", { mediaRoot: root }));
    assert.deepEqual(await readdir(root), []);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(root, { recursive: true, force: true });
  }
});

test("article images include lazy and picture sources at the largest resolution, excluding related cards", () => {
  const images = extractArticleImageCandidates(`<main><article>
    <figure><img src="data:image/gif;base64,blank" data-src="/bench.png" width="1200" height="280"><figcaption>Model capability benchmark</figcaption></figure>
    <figure><picture><source srcset="/large.webp 1600w, /small.webp 400w"><img src="/placeholder.jpg" alt="Reasoning comparison"></picture></figure>
    <figure><img srcset="/big.png 1200w, /tiny.png 240w" alt="Latency chart" width="1200" height="150"></figure>
    <aside><img src="/advert.jpg" alt="Other article"></aside>
  </article><section aria-label="Related articles"><img src="/related.jpg" alt="Read next"></section></main>`, "https://openai.com/index/example");
  assert.deepEqual(images.map((image) => image.url), ["https://openai.com/bench.png", "https://openai.com/large.webp", "https://openai.com/big.png"]);
  assert.equal(images[0]?.caption, "Model capability benchmark");
});

test("article photo credits do not pull author portraits or most-read recommendations into the image pool", () => {
  const images = extractArticleImageCandidates(`<article>
    <figure><img src="/model-chart.png" alt="Capability comparison"></figure>
    <section class="author-mini-bio"><img src="/AV4.jpg" alt="Photo of Ryan Whitwam"></section>
    <section class="most-read"><img src="/driving-license.jpg" alt="Listing image for first story in Most Read"></section>
  </article>`, "https://publisher.example/release");
  assert.deepEqual(images.map((image) => image.url), ["https://publisher.example/model-chart.png"]);
});

test("publisher data-loading JSON selects the real desktop chart instead of its 100-pixel placeholder", () => {
  const images = extractArticleImageCandidates(`<article>
    <img src="/chart.width-100.webp" alt="Model comparison" data-loading='{"mobile":"/chart.width-500.webp","desktop":"/chart.width-1000.webp"}'>
    <img src="/fallback.png" alt="Second chart" data-loading='invalid JSON'>
  </article>`, "https://publisher.example/release");
  assert.deepEqual(images.map((image) => image.url), ["https://publisher.example/chart.width-1000.webp", "https://publisher.example/fallback.png"]);
});

test("finds article images embedded in a client-rendered page module", () => {
  const source = String.raw`
    jsx("img", { src: "https://cdn.example.com/article/openrouter-ranking.png" });
    jsx("img", { src: "https://cdn.example.com/article/intelligence-index.png" });
    jsx("img", { src: "data:image/png;base64,ignored" });
    const icon = "https://cdn.example.com/ui/company-logo.png";
  `;

  assert.deepEqual(
    extractImageUrlsFromModuleSource(source, new URL("https://example.com/assets/article.js")),
    [
      "https://cdn.example.com/article/openrouter-ranking.png",
      "https://cdn.example.com/article/intelligence-index.png",
    ],
  );
});

test("reads prose and headings from a client-rendered MDX module without executing it", () => {
  const source = [
    "function m(e){let t={h2:`h2`,p:`p`,a:`a`,strong:`strong`,...e.components};return(0,d.jsxs)(d.Fragment,{children:[",
    "(0,d.jsx)(t.p,{children:`GLM-5.3-Flash uses 18B active parameters.`}),",
    "(0,d.jsxs)(t.p,{children:[`Before release it ran as `,(0,d.jsx)(t.strong,{children:`ox-alpha`}),` on OpenRouter.`]}),",
    "(0,d.jsx)(t.h2,{children:`Competitive Performance at Flash Cost`}),",
    "(0,d.jsxs)(t.p,{children:[`Open `,(0,d.jsx)(t.a,{href:`https://zcode.z.ai`,children:`ZCode`}),` to try it.`]})",
    "]})}",
    "l.createRoot(document.getElementById(`root`)).render((0,d.jsx)(o,{date:`2026-08-26`,title:`GLM-5.3-Flash: Frontier Intelligence, Flash Cost`,document:`https://docs.z.ai`}));",
  ].join("");

  const article = extractArticleFromModuleSource(source);
  assert.equal(article.title, "GLM-5.3-Flash: Frontier Intelligence, Flash Cost");
  assert.deepEqual(article.blocks, [
    { kind: "paragraph", text: "GLM-5.3-Flash uses 18B active parameters." },
    { kind: "paragraph", text: "Before release it ran as ox-alpha on OpenRouter." },
    { kind: "heading", text: "Competitive Performance at Flash Cost" },
    { kind: "paragraph", text: "Open ZCode to try it." },
  ]);
  assert.equal(article.blocks.some((block) => block.text.includes("https://zcode.z.ai")), false);
});

test("animated heading letters cannot consume the article illustration budget", async () => {
  const letters = Array.from({ length: 26 }, (_, index) => `<span data-letter-index="${index}"><img src="/letter-${index}.png" alt="" width="400" height="400"></span>`).join("");
  const html = `<head><meta property="og:image" content="https://publisher.example/announcement.jpg"></head><main><h1>Image model update</h1><span aria-hidden="true">${letters}</span><p>A model adds editing and poster templates.</p><figure><img src="/poster-example.jpg" alt="Official poster template example" width="1200" height="800"></figure></main>`;
  const page = await extractPageContent(html, new URL("https://publisher.example/update"), undefined, 3);
  assert.equal(page.images.some((image) => /letter-/u.test(image.url)), false);
  assert.ok(page.images.some((image) => /poster-example/u.test(image.url)));
  assert.ok(page.images.some((image) => /announcement/u.test(image.url)));
});
