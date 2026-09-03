import assert from "node:assert/strict";
import test from "node:test";
import { buildManualXPostEvidence, normalizeManualXPostInput } from "./manual-x-intake.js";

test("manual X intake preserves copied text and flags identity verification without fetching X", () => {
  const input = normalizeManualXPostInput({
    url: "https://twitter.com/OpenAI/status/1234567890?s=20",
    text: "We are releasing a new model today. API access and pricing are available in the linked documentation.",
    author: "@OpenAI",
  });
  const bundle = buildManualXPostEvidence(input, "2026-09-04T10:00:00.000Z");

  assert.equal(input.url, "https://x.com/OpenAI/status/1234567890");
  assert.equal(input.author, "@OpenAI");
  assert.match(bundle.title, /@OpenAI/u);
  assert.equal(bundle.source.canonicalUrl, input.url);
  assert.equal(bundle.source.rawText, input.text);
  assert.match(bundle.cleanedTextBlocks[0]?.text ?? "", /releasing a new model/u);
  assert.match(bundle.warnings.join(" "), /用户复制.*账号身份.*原帖/u);
});

test("manual X intake rejects non-post URLs and empty copied text", () => {
  assert.throws(
    () => normalizeManualXPostInput({ url: "https://example.com/news", text: "这是一段足够长的文字内容。" }),
    /X 原帖链接/u,
  );
  assert.throws(
    () => normalizeManualXPostInput({ url: "https://x.com/OpenAI", text: "这是一段足够长的文字内容。" }),
    /status/u,
  );
  assert.throws(
    () => normalizeManualXPostInput({ url: "https://x.com/OpenAI/status/123", text: "太短" }),
    /正文/u,
  );
});
