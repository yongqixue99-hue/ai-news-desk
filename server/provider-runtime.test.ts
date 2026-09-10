import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const fixtureRoot = mkdtempSync(path.join(tmpdir(), "provider-boundary-"));
const schemaPath = path.join(fixtureRoot, "schema.json");
writeFileSync(schemaPath, JSON.stringify({ type: "object", required: ["ok"], additionalProperties: false, properties: { ok: { type: "boolean" } } }));
process.on("exit", () => rmSync(fixtureRoot, { recursive: true, force: true }));
import {
  buildCodexExecRequest,
  codexTaskEnvironment,
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
  schemaPath,
  outputPath: "unused.output.json",
  apiKey: "test-key",
};

test("Codex vision requests pipe a non-empty prompt instead of letting --image consume it", () => {
  const request = buildCodexExecRequest({
    model: "gpt-5.6-sol",
    reasoningEffort: "xhigh",
    schemaPath: "C:\\tmp\\screenshot.schema.json",
    outputPath: "C:\\tmp\\screenshot.output.json",
    imagePath: "C:\\tmp\\token-chart.png",
    prompt: "请提取图片里的表格和结论",
  });

  assert.deepEqual(request.args.slice(-4), [
    "--output-last-message",
    "C:\\tmp\\screenshot.output.json",
    "--image",
    "C:\\tmp\\token-chart.png",
  ]);
  assert.equal(request.stdin, "请提取图片里的表格和结论");
  assert.ok(request.stdin.trim().length > 0);
});

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
        choices: [{ finish_reason: "stop", message: { content: "{\"ok\":true}" } }],
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
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "补全一句。" } }] });
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
      return Response.json({ choices: [{ finish_reason: "stop", message: { content: "补全两段。" } }] });
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
          controller.enqueue(encoder.encode('\ndata: {"choices":[{"delta":{"content":"句话。"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
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
        controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"补全。"}}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    })),
  });

  assert.deepEqual(previews, ["安全", "安全补全。"]);
  assert.equal(output, "安全补全。");
});

for (const reason of ["length", "content_filter", undefined]) {
  test(`structured output rejects non-completion ${reason}`, async () => {
    await assert.rejects(runGenerationProviderObserved({ ...input,
      fetcher: async () => Response.json({ choices: [{ finish_reason: reason, message: { content: '{"ok":true}' } }] }),
    }), /完成|截断/);
  });
}
test("every provider validates nested JSON locally without coercion", async () => {
  await assert.rejects(runGenerationProviderObserved({ ...input,
    fetcher: async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"ok":"true"}' } }] }),
  }), /结构校验/);
});
for (const ending of ["", 'data: {"choices":[{"finish_reason":"length"}]}\n\ndata: [DONE]\n\n', 'data: [DONE]\n\n']) {
  test(`incomplete stream cannot become insertable: ${ending}`, async () => {
    await assert.rejects(streamInlineCompletionProvider({ provider, systemPrompt: "s", userPrompt: "u", apiKey: "fake", onText() {},
      fetcher: async () => new Response('data: {"choices":[{"delta":{"content":"可以使用，但仅限"}}]}\n\n' + ending),
    }), /完成|截断|中断/);
  });
}
test("Codex generation has an explicit isolated read-only task directory", () => {
  const request = buildCodexExecRequest({ model: "test", reasoningEffort: "low", schemaPath: "/tmp/task/schema.json", outputPath: "/tmp/task/output.json", prompt: "hello" });
  assert.equal(request.args[request.args.indexOf("-s") + 1], "read-only");
  assert.notEqual(request.args[request.args.indexOf("-C") + 1], process.cwd());
  assert.ok(request.args.includes("--ignore-user-config"));
  assert.ok(request.args.includes("--ignore-rules"));
  assert.ok(request.args.includes('web_search="disabled"'));
});

test("Codex task environment drops inherited tokens, shell hooks and proxy configuration", () => {
  assert.deepEqual(codexTaskEnvironment({ HOME: "/native-auth-home", PATH: "/usr/bin", NODE_OPTIONS: "malicious-loader", OPENAI_API_KEY: "secret", GH_TOKEN: "secret", HTTPS_PROXY: "https://unexpected.example" }), { HOME: "/native-auth-home", PATH: "/usr/bin", NO_COLOR: "1" });
});

test("Codex actually starts in a disposable directory with only explicit task files", { skip: process.platform === "win32" }, async () => {
  const executable = path.join(fixtureRoot, "probe-cli");
  const reportPath = path.join(fixtureRoot, "probe-report.json");
  const marker = "NEWS_DESK_TEST_SECRET";
  const previous = process.env[marker]; process.env[marker] = "must-not-reach-child";
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const report = { cwd: process.cwd(), files: fs.readdirSync(process.cwd()), secret: process.env.NEWS_DESK_TEST_SECRET, args };
let prompt = ''; process.stdin.on('data', c => prompt += c); process.stdin.on('end', () => {
  report.prompt = prompt;
  fs.writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(report));
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], '{"ok":true}');
});
`); chmodSync(executable, 0o700);
  try {
    const result = await runGenerationProviderObserved({ ...input, provider: { ...provider, kind: "codex-cli" }, codexExecutable: executable });
    assert.equal(result.output, '{"ok":true}');
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.notEqual(report.cwd, process.cwd());
    assert.deepEqual(report.files, ["schema.json"]);
    assert.equal(report.secret, undefined);
    assert.match(report.prompt, /system[\s\S]*user/);
    assert.equal(existsSync(report.cwd), false, "temporary evidence directory is removed after completion");
  } finally { if (previous === undefined) delete process.env[marker]; else process.env[marker] = previous; }
});
