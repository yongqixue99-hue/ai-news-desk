import assert from "node:assert/strict";
import test from "node:test";
import { generateCandidateBriefings } from "./candidate-briefing-service.js";
import type { AiProviderConfig } from "./types.js";

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
