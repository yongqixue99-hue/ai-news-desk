import assert from "node:assert/strict";
import test from "node:test";
import { runGenerationProviderObserved } from "./provider-runtime.js";
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
