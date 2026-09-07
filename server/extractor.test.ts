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
} from "./extractor.js";

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
