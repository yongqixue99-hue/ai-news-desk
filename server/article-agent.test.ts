import assert from "node:assert/strict";
import test from "node:test";
import {
  ArticleAgentTraceError,
  parseArticleAnalysis,
  parseArticleOptimization,
  runObservedArticleAgentTask,
} from "./article-agent.js";
import type { AiProviderConfig } from "./types.js";

const provider = {
  id: "openai-main",
  name: "OpenAI",
  vendor: "OpenAI",
  description: "test provider",
  kind: "openai-compatible",
  model: "gpt-5.6",
  baseUrl: "https://api.openai.com/v1",
  supportsVision: true,
  apiKeyConfigured: true,
} satisfies AiProviderConfig;

test("article analysis keeps source-versus-draft comparison structured", () => {
  const result = parseArticleAnalysis(JSON.stringify({
    summary: "这篇文章讲的是一家公司开始测试一项新功能。",
    keyPoints: ["测试范围有限", "尚未全面开放"],
    whyItMatters: "它会改变产品的商业模式，但当前仍只是小范围测试。",
    comparison: {
      accurate: ["草稿正确写明仍在测试"],
      missing: ["草稿没有说明测试范围"],
      potentiallyMisleading: ["不能写成已经全面上线"],
    },
    terms: [{ term: "灰度测试", explanation: "只向少量用户逐步开放。" }],
    uncertainties: ["未公开覆盖用户数量"],
  }));
  assert.equal(result.keyPoints.length, 2);
  assert.equal(result.comparison.missing[0], "草稿没有说明测试范围");
  assert.equal(result.terms[0].term, "灰度测试");
});

test("article optimization rejects an incomplete model response", () => {
  assert.throws(() => parseArticleOptimization(JSON.stringify({
    strategy: "brief",
    editMode: "targeted",
    diagnosis: ["第二段含糊"],
    improvements: ["补充具体动作"],
    diagnostics: [],
    changes: [],
    preservedBlockIds: [],
    factCheckPassed: true,
    rollbackRecommended: false,
    factWarnings: [],
  })), /没有返回完整建议/);
});

test("article optimization can explicitly keep an already good draft", () => {
  const result = parseArticleOptimization(JSON.stringify({
    strategy: "brief",
    editMode: "keep",
    diagnosis: [],
    improvements: [],
    diagnostics: [],
    changes: [],
    preservedBlockIds: ["title", "paragraph:0", "paragraph:1"],
    factCheckPassed: true,
    rollbackRecommended: false,
    factWarnings: [],
  }));
  assert.equal(result.editMode, "keep");
  assert.deepEqual(result.changes, []);
});

test("article optimization can stop when evidence is too weak instead of inventing a rewrite", () => {
  const result = parseArticleOptimization(JSON.stringify({
    strategy: "skip",
    editMode: "rebuild",
    diagnosis: ["当前只有一句采集摘要，无法核对发布日期和开放范围。"],
    improvements: ["先补充原始公告或完整报道。"],
    diagnostics: [{
      id: "insufficient-evidence",
      layer: "content",
      severity: "error",
      message: "证据不足",
      blockId: "paragraph:0",
    }],
    changes: [],
    preservedBlockIds: ["title", "paragraph:0"],
    factCheckPassed: false,
    rollbackRecommended: true,
    factWarnings: ["需要补充来源"],
  }));

  assert.equal(result.strategy, "skip");
  assert.equal(result.changes.length, 0);
  assert.equal(result.rollbackRecommended, true);
});

test("article optimization returns exact paragraph patches and audits facts locally", () => {
  const result = parseArticleOptimization(JSON.stringify({
    strategy: "brief",
    editMode: "targeted",
    diagnosis: ["第二段结论过泛"],
    improvements: ["保留数字，删去空泛总结"],
    diagnostics: [{
      id: "generic-conclusion",
      layer: "surface",
      severity: "warning",
      message: "结尾是通用总结",
      blockId: "paragraph:1",
    }],
    changes: [{
      id: "change-1",
      blockId: "paragraph:1",
      before: "价格下调 30%，这无疑标志着新的里程碑。",
      after: "价格已经下调，但具体影响仍要看后续用量。",
      reason: "删除空泛结论",
      affectedFactIds: ["claim-2"],
    }],
    preservedBlockIds: ["title", "paragraph:0"],
    factCheckPassed: true,
    rollbackRecommended: false,
    factWarnings: [],
  }), {
    title: "API 价格调整",
    paragraphs: ["第一段。", "价格下调 30%，这无疑标志着新的里程碑。"],
    take: "",
    factClaimIds: ["claim-1", "claim-2"],
  });

  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0]?.blockId, "paragraph:1");
  assert.equal(result.changes[0]?.factCheckPassed, false);
  assert.match(result.changes[0]?.factWarnings[0] || "", /30%/);
  assert.equal(result.factCheckPassed, false);
  assert.equal(result.rollbackRecommended, true);
});

test("an article Agent call returns a sanitized provider and skill trace", async () => {
  const times = ["2026-08-13T05:00:00.000Z", "2026-08-13T05:00:02.500Z"];
  const result = await runObservedArticleAgentTask({
    taskKind: "article-analysis",
    subjectId: "draft-1",
    provider,
    skills: [{ id: "ra-human", revision: "7", instructions: "不得进入运行记录的完整指令" }],
    execute: async () => "{\"ok\":true}",
    parse: (rendered) => JSON.parse(rendered) as { ok: boolean },
    clock: () => times.shift() || "2026-08-13T05:00:02.500Z",
  });

  assert.equal(result.value.ok, true);
  assert.equal(result.trace.status, "succeeded");
  assert.equal(result.trace.durationMs, 2500);
  assert.equal(result.trace.requestedProvider.id, "openai-main");
  assert.equal(result.trace.requestedProvider.model, "gpt-5.6");
  assert.deepEqual(result.trace.skillSnapshot.ids, ["ra-human"]);
  assert.doesNotMatch(JSON.stringify(result.trace), /完整指令/);
});

test("a parse failure is returned with a failed trace and never becomes a silent fallback", async () => {
  const times = ["2026-08-13T06:00:00.000Z", "2026-08-13T06:00:01.000Z"];
  await assert.rejects(
    () => runObservedArticleAgentTask({
      taskKind: "article-chat",
      subjectId: "thread-1",
      provider,
      skills: [],
      execute: async () => "not-json",
      parse: () => {
        throw new Error("模型返回 JSON 结构不完整；api_key=sk-test-secret-value");
      },
      clock: () => times.shift() || "2026-08-13T06:00:01.000Z",
    }),
    (error: unknown) => {
      assert.equal(error instanceof ArticleAgentTraceError, true);
      const traced = error as ArticleAgentTraceError;
      assert.equal(traced.trace.status, "failed");
      assert.equal(traced.trace.errors[0]?.category, "invalid-response");
      assert.equal(traced.trace.fallbacks.length, 0);
      assert.equal(traced.trace.retries.length, 0);
      assert.doesNotMatch(JSON.stringify(traced.trace), /sk-test-secret-value/);
      assert.match(traced.message, /JSON 结构不完整/);
      return true;
    },
  );
});
