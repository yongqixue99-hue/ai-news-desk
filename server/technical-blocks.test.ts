import assert from "node:assert/strict";
import test from "node:test";
import { extractArticleBlocks } from "./extractor.js";

test("technical extraction preserves ordered headings, exact code indentation and comparison tables", () => {
  const blocks = extractArticleBlocks('<main><h2>Run the example</h2><p>Use this code.</p><pre><code class="language-python">for item in items:\n    print(&quot;&lt;ok&gt;&quot;)\n</code></pre><table><tr><th>Mode</th><th>Limit</th></tr><tr><td>Basic</td><td>5</td></tr></table></main>');
  assert.deepEqual(blocks.map(block => block.kind), ["heading", "paragraph", "code", "table"]);
  assert.equal(blocks[2]!.text, 'for item in items:\n    print("<ok>")\n');
  assert.equal(blocks[2]!.language, "python");
  assert.equal(blocks[3]!.text, 'Mode\tLimit\nBasic\t5');
});
