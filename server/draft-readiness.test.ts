import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import type { ArticleDraft } from "./types.js";

const draft = (): ArticleDraft => ({
  id: "draft-1", runId: "run-1", candidateId: "candidate-1",
  createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
  status: "editing", title: "测试", paragraphs: ["正文"], take: "判断", bodyHtml: "<p>正文足够长，用于测试发布准备度。</p>",
  sources: [{ label: "官方", url: "https://example.com/news", kind: "primary", verified: true }],
  factClaims: [{ id: "claim-1", claim: "已正式发布", status: "full-source", sourceUrl: "https://example.com/news", capturedAt: "2026-08-13T00:00:00.000Z" }],
  uncertainties: [], images: [], community: "盒友杂谈", topics: ["AI"],
  provenance: { originalUrl: "https://example.com/news", generatedBy: "test" },
});

test("a fully sourced text draft can proceed without pretending it has images", () => {
  const result = evaluateDraftReadiness(draft(), "xiaoheihe", "2026-08-13T01:00:00.000Z");
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test("uncertain facts and unlicensed inserted images block readiness", () => {
  const input = draft();
  input.uncertainties = ["发布日期尚未核实"];
  input.images = [{
    id: "placement-1", afterParagraph: 0, caption: "人物现场",
    image: {
      id: "image-1", url: "/media/image.jpg", localPath: "/tmp/image.jpg",
      caption: "人物现场", attribution: "来源待补充", sourceUrl: "material-library",
      selected: true, rights: "check-required",
    },
  }];
  const result = evaluateDraftReadiness(input, "xiaoheihe", "2026-08-13T01:00:00.000Z");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /发布日期尚未核实/);
  assert.match(result.blockers.join("\n"), /版权状态待确认/);
});
