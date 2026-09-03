import assert from "node:assert/strict";
import test from "node:test";
import {
  buildManualXPostEvidence,
  normalizeManualXPostInput,
  resolveXPostInput,
} from "./manual-x-intake.js";

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

test("URL-only X intake resolves text through the official unauthenticated oEmbed endpoint", async () => {
  let requestedUrl = "";
  let requestSignal: AbortSignal | null | undefined;
  const resolved = await resolveXPostInput({
    url: "https://x.com/AnthropicAI/status/9876543210",
    text: "",
  }, async (url, init) => {
    requestedUrl = String(url);
    requestSignal = init?.signal;
    return new Response(JSON.stringify({
      author_name: "Anthropic",
      author_url: "https://x.com/AnthropicAI",
      html: '<blockquote class="twitter-tweet"><p lang="en">Claude 5.1 is available today. <a href="https://example.com">Read the model card</a>.</p>&mdash; Anthropic</blockquote>',
    }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.match(requestedUrl, /^https:\/\/publish\.x\.com\/oembed\?/u);
  assert.match(requestedUrl, /omit_script=true/u);
  assert.ok(requestSignal instanceof AbortSignal);
  assert.equal(resolved.url, "https://x.com/AnthropicAI/status/9876543210");
  assert.equal(resolved.author, "@AnthropicAI");
  assert.match(resolved.text, /Claude 5\.1 is available today/u);
  assert.match(resolved.text, /Read the model card/u);
  assert.equal(resolved.acquisition, "official-oembed");
  assert.match(buildManualXPostEvidence(resolved).warnings.join(" "), /官方 oEmbed/u);
});

test("X intake keeps supplied text local and does not call oEmbed", async () => {
  let called = false;
  const resolved = await resolveXPostInput({
    url: "https://x.com/OpenAI/status/1234567890",
    text: "This text was deliberately supplied by the user and is long enough.",
  }, async () => {
    called = true;
    throw new Error("should not fetch");
  });

  assert.equal(called, false);
  assert.equal(resolved.acquisition, "manual-copy");
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
