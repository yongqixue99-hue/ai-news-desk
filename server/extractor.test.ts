import assert from "node:assert/strict";
import test from "node:test";

import {
  extractArticleFromModuleSource,
  extractImageUrlsFromModuleSource,
} from "./extractor.js";

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
