import assert from "node:assert/strict";
import test from "node:test";
import { sourceReadingContent } from "./source-reading-content.js";

test("complete source reading retains code indentation and table row and column boundaries", () => {
  const code = "    print('<source>')\n    assert price < 2";
  const table = "Model\tInput\tOutput\nModel X\t$0.2\t$0.8\t";
  const text = `${code}\n\n${table}`;
  const blocks = [{ kind: "code" as const, text: code, language: "python" }, { kind: "table" as const, text: table }];
  const result = sourceReadingContent({ text, blocks });
  assert.equal(result.text, text);
  assert.deepEqual(result.blocks, blocks);
  assert.deepEqual(result.extractionWarnings, []);
  blocks[0]!.text = "changed after read";
  assert.equal(result.blocks?.[0]?.text, code);
});

test("missing indentation or an empty final table cell cannot be normalized into complete structure", () => {
  for (const [text, blockText, kind] of [
    ["    print('source')", "print('source')", "code"],
    ["Model\tValue\t", "Model\tValue", "table"],
  ] as const) {
    const result = sourceReadingContent({ text, blocks: [{ kind, text: blockText }] });
    assert.equal(result.text, text);
    assert.equal(result.blocks, undefined);
    assert.match(result.extractionWarnings.join(" "), /结构/u);
  }
});

test("line endings and outside blank lines may differ without losing complete blocks", () => {
  const text = "\r\nModel\tPrice\r\nModel X\t$2\r\n";
  const block = { kind: "table" as const, text: "Model\tPrice\nModel X\t$2" };
  const result = sourceReadingContent({ text, blocks: [block] });
  assert.equal(result.text, text);
  assert.deepEqual(result.blocks, [block]);
  assert.deepEqual(result.extractionWarnings, []);
});

test("equal length text or flattened table boundaries do not establish block identity", () => {
  for (const blockText of ["Model\tPrice\nModel X\t$9", "Model Price Model X $2"]) {
    const text = "Model\tPrice\nModel X\t$2";
    const result = sourceReadingContent({ text, blocks: [{ kind: "table", text: blockText }],
      extractionWarnings: ["图片文字尚未核对"] });
    assert.equal(result.text, text);
    assert.equal(result.blocks, undefined);
    assert.equal(result.extractionWarnings[0], "图片文字尚未核对");
    assert.match(result.extractionWarnings[1] ?? "", /结构/u);
  }
});
