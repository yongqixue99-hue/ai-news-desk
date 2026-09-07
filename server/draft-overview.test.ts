import assert from "node:assert/strict";
import test from "node:test";
import { buildDraftOverview } from "./draft-overview.js";
import type { ArticleDraft } from "./types.js";

const draft = (id: string, status: ArticleDraft["status"] = "editing", updatedAt = "2026-09-05T00:00:00Z"): ArticleDraft => ({
  id, candidateId: id, runId: "run", title: id, status, updatedAt, createdAt: updatedAt,
  paragraphs: ["Private article body"], bodyHtml: "<p>Private article body</p>", take: "", sources: [],
  images: [], uncertainties: [], community: "", topics: [],
  provenance: { originalUrl: `https://example.com/${id}`, generatedBy: "codex-cli" },
});

test("resume overview excludes finished and historical drafts and returns newest working drafts without article bodies", () => {
  const superseded = draft("superseded");
  superseded.provenance.supersededByDraftId = "recent";
  const input = [draft("old"), draft("recent", "reviewing", "2026-09-05T02:00:00Z"), draft("published", "published"), draft("shelved", "shelved"), superseded];
  const before = structuredClone(input);
  const overview = buildDraftOverview(input);
  assert.equal(overview.total, 2);
  assert.deepEqual(overview.recent.map((entry) => entry.id), ["recent", "old"]);
  assert.deepEqual(Object.keys(overview.recent[0]).sort(), ["id", "status", "title", "updatedAt"]);
  assert.deepEqual(input, before);
});

test("resume overview is bounded while retaining the total and keeps delivered drafts available to finish", () => {
  const input = Array.from({ length: 8 }, (_, index) => draft(`draft-${index}`, index === 7 ? "filled" : "editing", `2026-09-05T0${index}:00:00Z`));
  const overview = buildDraftOverview(input);
  assert.equal(overview.total, 8);
  assert.equal(overview.recent.length, 3);
  assert.equal(overview.recent[0].id, "draft-7");
  assert.equal(overview.recent[0].status, "filled");
});
