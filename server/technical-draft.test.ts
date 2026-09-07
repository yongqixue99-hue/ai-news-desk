import assert from "node:assert/strict";
import test from "node:test";
import { restoreTechnicalSourceBlocks } from "./technical-draft.js";
import type { ContentPackage } from "./product-types.js";
import type { ArticleDraft } from "./types.js";

const pack = { intent: "source", technicalArticle: { adaptation: "faithful" }, sourceMaterials: [{ blocks: [{ kind: "code", text: 'if ready:\n    print("<ok>")\n', language: "python" }] }] } as ContentPackage;
test("technical drafts restore exact code from frozen material and reject omitted or invented blocks", () => {
  const draft = { paragraphs: ["执行以下步骤", "[[SOURCE_BLOCK_1]]"], factClaims: [{ claim: "[[SOURCE_BLOCK_1]]" }], bodyHtml: "<p>执行以下步骤</p><p>[[SOURCE_BLOCK_1]]</p>" } as ArticleDraft;
  restoreTechnicalSourceBlocks(draft, pack);
  assert.match(draft.bodyHtml!, /<pre><code class="language-python">if ready:\n    print\(&quot;&lt;ok&gt;&quot;\)/u);
  assert.equal(draft.paragraphs[1], pack.sourceMaterials![0]!.blocks![0]!.text);
  assert.equal(draft.factClaims![0]!.claim, draft.paragraphs[1]);
  assert.throws(() => restoreTechnicalSourceBlocks({ paragraphs: ["Something else"], bodyHtml: "" } as ArticleDraft, pack), /遗漏/u);
  assert.throws(() => restoreTechnicalSourceBlocks({ paragraphs: ["[[SOURCE_BLOCK_2]]"], bodyHtml: "" } as ArticleDraft, pack), /无效/u);
});
