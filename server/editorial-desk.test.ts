import assert from "node:assert/strict";
import test from "node:test";
import { assignStory, type EditorialAssignmentInput } from "./editorial-desk.js";

const base: EditorialAssignmentInput = {
  title: "Acme 发布 AI 模型",
  ageHours: 2,
  evidenceStrength: "moderate",
  factSourceCount: 1,
  communitySourceCount: 0,
  communitySampleCount: 0,
  longestExcerpt: 500,
  protected: false,
  now: "2026-08-30T00:00:00.000Z",
};

test("EditorialDesk covers all seven assignment outcomes with hard evidence blocks", () => {
  assert.equal(assignStory(base).mode, "brief");
  assert.equal(assignStory({ ...base, factSourceCount: 2 }).mode, "synthesis");
  assert.equal(assignStory({ ...base, communitySourceCount: 1, communitySampleCount: 5 }).mode, "community");
  assert.equal(assignStory({ ...base, title: "AI 模型本地部署教程", communitySourceCount: 1, communitySampleCount: 2 }).mode, "playbook");
  assert.equal(assignStory({ ...base, longestExcerpt: 2_000 }).mode, "curate");
  const watch = assignStory({ ...base, evidenceStrength: "weak", communitySourceCount: 1 });
  assert.equal(watch.mode, "watch");
  assert.equal(watch.canDraft, false);
  assert.match(watch.blockers[0] ?? "", /证据不足/u);
  const skip = assignStory({ ...base, ageHours: 8 * 24 });
  assert.equal(skip.mode, "skip");
  assert.equal(skip.canDraft, false);
});

test("mode choice cannot hide limited community sampling", () => {
  const assignment = assignStory({ ...base, factSourceCount: 2, communitySourceCount: 1, communitySampleCount: 3 });
  assert.equal(assignment.mode, "synthesis");
  assert.match(assignment.warnings[0] ?? "", /不能概括共识/u);
});

test("unhandled stories move to a seven-day backlog before expiring", () => {
  const backlog = assignStory({ ...base, ageHours: 49 });
  const protectedStory = assignStory({ ...base, ageHours: 49, protected: true });

  assert.equal(backlog.mode, "brief");
  assert.equal(backlog.canDraft, true);
  assert.match(backlog.warnings[0] ?? "", /近 7 日补看区/u);
  assert.equal(protectedStory.canDraft, true);
});

test("an official headline and short excerpt are a lead, not a verified article body", () => {
  const assignment = assignStory({ ...base, longestExcerpt: 144, bodyVerified: false });
  assert.equal(assignment.mode, "brief");
  assert.equal(assignment.canDraft, true, "the lead still enters package preparation");
  assert.doesNotMatch(assignment.reason, /证据足够/u);
  assert.match(assignment.warnings.join(" "), /原文待读取/u);
});
