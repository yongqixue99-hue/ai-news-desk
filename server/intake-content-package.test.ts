import assert from "node:assert/strict";
import test from "node:test";
import { buildScreenshotEvidenceBundle } from "./intake-review.js";
import { buildIntakeContentPackage } from "./intake-content-package.js";
import type { IntakeReviewRecord } from "./types.js";

test("a confirmed screenshot review freezes supported facts for safe Tab completion", () => {
  const bundle = buildScreenshotEvidenceBundle({
    fileName: "token-cost.png",
    sourceAssetPath: "C:\\desk\\token-cost.png",
    sourcePublicPath: "/media/intake-reviews/token-cost.png",
    title: "Token 套餐实测",
    extractedText: [
      "ChatGPT/Codex GPT-5.6 Sol 折算为每亿 Token 12.5 元。",
      "DeepSeek V4 Flash 采用 API 按量计价，每亿 Token 6.4 元。",
    ].join("\n\n"),
    capturedAt: "2026-09-04T10:00:00.000Z",
  });
  const record: IntakeReviewRecord = {
    id: "intake_review_token_cost",
    createdAt: "2026-09-04T10:00:00.000Z",
    updatedAt: "2026-09-04T10:01:00.000Z",
    status: "confirmed",
    providerId: "codex-cli",
    bundle,
    selection: {
      confirmedAt: "2026-09-04T10:01:00.000Z",
      excludedTextBlockIds: [],
      includedNoiseBlockIds: [],
      includedImageIds: [],
    },
  };

  const contentPackage = buildIntakeContentPackage(record);

  assert.equal(contentPackage.status, "ready");
  assert.equal(contentPackage.mode, "brief");
  assert.deepEqual(contentPackage.facts.map((fact) => [fact.status, fact.text]), [
    ["supported", "ChatGPT/Codex GPT-5.6 Sol 折算为每亿 Token 12.5 元。"],
    ["supported", "DeepSeek V4 Flash 采用 API 按量计价，每亿 Token 6.4 元。"],
  ]);
  assert.equal(contentPackage.sources[0]?.basis, "full-source");
  assert.equal(contentPackage.sources[0]?.url, "/media/intake-reviews/token-cost.png");
});
