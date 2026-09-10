import assert from "node:assert/strict";
import test from "node:test";
import { assessPracticeOpportunity } from "./practice-opportunity.js";
import { rawItemTimeRejectionReason } from "./scoring.js";
import { sourceHealthLayers } from "./source-health.js";
test("practice angle requires concrete process and a traceable material, without claiming use", () => {
  const result = assessPracticeOpportunity({ title: "How I built an offline AI game assistant", excerpt: "Code and demo describe the setup and constraints.", urls: ["https://github.com/example/game"] });
  assert.equal(result?.kind, "project"); assert.equal(result?.materials[0]?.url, "https://github.com/example/game");
  assert.match(result?.limitations ?? "", /未验证|核对/u);
  assert.equal(assessPracticeOpportunity({ title: "Weekly AI tools roundup", excerpt: "", urls: ["https://example.com"] }), undefined);
  assert.equal(assessPracticeOpportunity({ title: "How I built an AI game", excerpt: "", urls: ["javascript:alert(1)"] }), undefined);
});
test("concrete practice gets 30 days while dates and explicit user range remain authoritative", () => {
  const row = { id: "p", source_type: "rss", title: "How I built an offline AI assistant", url: "https://example.com/project", content: "Code and demo explain the process.", published_at: "2026-08-20T00:00:00Z" };
  const options = { now: Date.parse("2026-09-10T00:00:00Z"), windowHours: 48 };
  assert.equal(rawItemTimeRejectionReason(row, {}, options), undefined);
  assert.equal(rawItemTimeRejectionReason(row, { dateFrom: "2026-09-09" }, options), "outside-date-range");
  assert.equal(rawItemTimeRejectionReason({ ...row, title: "Company launches an AI model" }, {}, options), "outside-window");
  assert.equal(rawItemTimeRejectionReason({ ...row, published_at: undefined }, {}, options), "missing-published-at");
});
test("source health distinguishes transport, candidates and unread originals", () => {
  const layers = sourceHealthLayers({ sourceId: "s", sourceName: "S", status: "warning", healthImpact: "success", rawCount: 12, candidateCount: 0, detail: "No eligible rows" }, []);
  assert.equal(layers.connection, "ok"); assert.equal(layers.selection, "empty"); assert.equal(layers.originals, "unknown");
});

test("a concrete older practice can qualify independently of breaking-news timeliness", async () => {
  const { rawItemToCandidate, rankCandidatesWithDiagnostics } = await import("./scoring.js");
  const candidate = rawItemToCandidate({ id:"practice",source_type:"rss",title:"How I built an offline AI assistant",content:"Code and demo explain the setup and process.",url:"https://example.com/project",published_at:"2026-08-20T00:00:00Z" },48,["ai"]);
  candidate.score=5;candidate.scoreBreakdown.relevance=2;
  assert.equal(rankCandidatesWithDiagnostics([candidate]).candidates.length,1);
});
