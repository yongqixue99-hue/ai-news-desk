import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildCandidateBriefingEvidence } from "./candidate-briefing.js";
import type { AiProviderConfig, Candidate } from "./types.js";

// The service writes its task files under the workflow root, which is resolved at import time.
const root = await mkdtemp(path.join(os.tmpdir(), "newsdesk-briefing-service-"));
process.env.AI_NEWS_DESK_WORKFLOW_ROOT = root;
await mkdir(path.join(root, "jobs"), { recursive: true });
const { generateCandidateBriefings } = await import("./candidate-briefing-service.js");

const provider: AiProviderConfig = {
  id: "cancelled-provider",
  name: "Cancelled provider",
  vendor: "Test",
  description: "test",
  kind: "openai-compatible",
  model: "test-model",
  baseUrl: "http://127.0.0.1:9999/v1",
  supportsVision: false,
  apiKeyConfigured: true,
};

test("candidate briefing generation honors cancellation before creating AI work", async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    generateCandidateBriefings("cancelled-run", provider, [{
      candidateId: "candidate-1",
      basis: "title",
      text: "原标题：Example",
    }], { signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === "AbortError",
  );
});

test("one ungrounded summary is recorded as a failure without discarding the grounded siblings", async () => {
  const candidate = (id: string, title: string, excerpt: string) => ({
    id, rawId: id, title, url: `https://example.com/${id}`, sourceName: "Example", sourceType: "rss",
    publishedAt: "2026-10-08T00:00:00.000Z", excerpt, score: 10, selected: false, status: "new", images: [], imageCount: 0, evidence: "一手来源",
  }) as unknown as Candidate;
  const evidence = buildCandidateBriefingEvidence([
    candidate("bad", "A Python guide", "A Python guide."),
    candidate("good", "NVIDIA releases an inference tool", "NVIDIA releases an inference tool."),
  ]);
  const completedAt = "2026-10-08T00:01:00.000Z";
  const result = await generateCandidateBriefings("grounding-run", provider, evidence, {
    runProvider: async () => ({
      output: JSON.stringify({ items: [
        { candidateId: "bad", titleZh: "Python 调试指南", summaryZh: "Google 推出调试工具。" },
        { candidateId: "good", titleZh: "英伟达发布推理工具", summaryZh: "英伟达推出推理工具。" },
      ] }),
      meta: { completedAt },
    }) as never,
  });
  assert.deepEqual(result.items.map((item) => item.candidateId), ["good"]);
  assert.match(result.failures[0] ?? "", /bad/);
  assert.equal(result.traces.length, 1);
  assert.equal(result.traces[0]!.status, "succeeded");
  assert.equal(result.traces[0]!.errors.length, 1);
});
