import assert from "node:assert/strict";
import test from "node:test";
import {
  runGenerationProviderObserved,
  runInlineCompletionProvider,
  streamInlineCompletionProvider,
} from "./provider-runtime.js";
import type { AiProviderConfig } from "./types.js";

const provider: AiProviderConfig = {
  id: "test-provider",
  name: "Test Provider",
  vendor: "Test",
  description: "boundary fake",
  kind: "openai-compatible",
  model: "test-model",
  baseUrl: "http://127.0.0.1:9999/v1",
  supportsVision: false,
  apiKeyConfigured: true,
};

const input = {
  provider,
  codexPrompt: "unused",
  apiSystemPrompt: "system",
  apiUserPrompt: "user",
  schemaPath: "unused.schema.json",
  outputPath: "unused.output.json",
  apiKey: "test-key",
};

test("provider request stops before transport when its signal is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;

  await assert.rejects(
    runGenerationProviderObserved({
      ...input,
      signal: controller.signal,
      fetcher: async () => {
        calls += 1;
        return new Response();
      },
    }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
  assert.equal(calls, 0);
});

test("provider retries a rate limit once and reports HTTP and token usage", async () => {
  let calls = 0;
  const result = await runGenerationProviderObserved({
    ...input,
    fetcher: async () => {
      calls += 1;
      if (calls === 1) {
        return Response.json(
          { error: { message: "slow down" } },
          { status: 429, headers: { "retry-after": "0" } },
        );
      }
      return Response.json({
        choices: [{ message: { content: "{\"ok\":true}" } }],
        usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 },
      });
    },
  });

  assert.equal(calls, 2);
  assert.equal(result.output, "{\"ok\":true}");
  assert.equal(result.meta.httpStatus, 200);
  assert.deepEqual(result.meta.tokens, { input: 12, output: 7, total: 19 });
});

test("inline completion uses one short plain-text request without the long-form retry contract", async () => {
  let calls = 0;
  let body: Record<string, unknown> = {};
  const output = await runInlineCompletionProvider({
    provider,
    systemPrompt: "system",
    userPrompt: "user",
    apiKey: "test-key",
    fetcher: async (_input, init) => {
      calls += 1;
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "补全一句。" } }] });
    },
  });

  assert.equal(output, "补全一句。");
  assert.equal(calls, 1);
  assert.equal(body.response_format, undefined);
  assert.equal(body.max_tokens, 240);
  assert.equal(body.temperature, 0.15);
});

test("inline completion uses the provider's cheap model and disables DeepSeek thinking", async () => {
  let requestUrl = "";
  let body: Record<string, unknown> = {};
  await runInlineCompletionProvider({
    provider: {
      ...provider,
      id: "deepseek",
      vendor: "DeepSeek",
      model: "deepseek-v4-pro",
      inlineCompletionModel: "deepseek-v4-flash",
      baseUrl: "https://api.deepseek.com",
    },
    systemPrompt: "system",
    userPrompt: "user",
    apiKey: "test-key",
    fetcher: async (input, init) => {
      requestUrl = String(input);
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({ choices: [{ message: { content: "补全两段。" } }] });
    },
  });

  assert.equal(requestUrl, "https://api.deepseek.com/chat/completions");
  assert.equal(body.model, "deepseek-v4-flash");
  assert.deepEqual(body.thinking, { type: "disabled" });
  assert.equal(body.max_tokens, 240);
});

test("inline completion streaming emits cumulative text before the final result", async () => {
  const encoder = new TextEncoder();
  let body: Record<string, unknown> = {};
  const previews: string[] = [];
  const output = await streamInlineCompletionProvider({
    provider,
    systemPrompt: "system",
    userPrompt: "user",
    apiKey: "test-key",
    onText: (text) => previews.push(text),
    fetcher: async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"第一"}}]}\n'));
          controller.enqueue(encoder.encode('\ndata: {"choices":[{"delta":{"content":"句话。"}}]}\n\ndata: [DONE]\n\n'));
          controller.close();
        },
      }), { headers: { "content-type": "text/event-stream" } });
    },
  });

  assert.equal(body.stream, true);
  assert.deepEqual(previews, ["第一", "第一句话。"]);
  assert.equal(output, "第一句话。");
});

test("DeepSeek-style SSE keep-alive comments do not interrupt streamed completion", async () => {
  const encoder = new TextEncoder();
  const previews: string[] = [];
  const output = await streamInlineCompletionProvider({
    provider,
    systemPrompt: "system",
    userPrompt: "user",
    apiKey: "test-key",
    onText: (text) => previews.push(text),
    fetcher: async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"安全"}}]}\n\n'));
        controller.enqueue(encoder.encode(": keep-alive\n\n"));
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"补全。"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    })),
  });

  assert.deepEqual(previews, ["安全", "安全补全。"]);
  assert.equal(output, "安全补全。");
});
