import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { snapshotDraft } from "./draft-revisions.js";
import { draftReworkChanges, summarizeReworkObservations } from "./draft-rework.js";
import { buildWorkflowPerformance } from "./workflow-performance.js";
import type { WorkflowEventRecord } from "./local-database.js";

test("saved rework compares ordered paragraphs with a captured baseline without changing the draft or factual scores", () => {
  const draft = createBlankDraftInState(createDefaultState()); draft.title = "原稿"; draft.bodyHtml = "<p>一</p><p>二</p><p>二</p>";
  draft.editorialBaseline = { initial: { snapshot: snapshotDraft(draft), capturedAt: "2026-10-02T00:00:00Z", origin: "initial" } };
  draft.title = "当前稿"; draft.bodyHtml = "<p>一</p><p>二</p><p>三</p>";
  const before = JSON.stringify(draft), changes = draftReworkChanges(draft)!;
  assert.equal(changes.retainedBlocks, 2); assert.equal(changes.changedOrRemovedBlocks, 1); assert.equal(changes.addedOrChangedBlocks, 1);
  assert.equal(changes.titleChanged, true); assert.equal(JSON.stringify(draft), before);
  delete draft.editorialBaseline; assert.equal(draftReworkChanges(draft), null);
});

test("image rework counts visible placements and edited HTML captions rather than the unused image tray", () => {
  const draft = createBlankDraftInState(createDefaultState());
  draft.images = ["one", "two", "tray"].map(id => ({ id, afterParagraph: 0, caption: "原图注", image: { id, caption: "图片", url: `https://example.com/${id}.png`, selected: true, rights: "owned", attribution: "作者", sourceUrl: "https://example.com" } }));
  draft.bodyHtml = '<p>正文</p><img data-media-id="one" src="https://example.com/one.png"><p>图：原图注</p>';
  draft.editorialBaseline = { initial: { snapshot: snapshotDraft(draft), capturedAt: "2026-10-02T00:00:00Z", origin: "initial" } };
  draft.bodyHtml = '<p>正文</p><img data-media-id="one" src="https://example.com/one.png"><p>图：改好的图注</p><img data-media-id="two" src="https://example.com/two.png">';
  const changes = draftReworkChanges(draft)!;
  assert.equal(changes.addedImages, 1); assert.equal(changes.removedImages, 0); assert.equal(changes.changedCaptions, 1);
  draft.contentFormat = "image-post"; draft.imagePostImageIds = ["two"];
  assert.equal(draftReworkChanges(draft)!.removedImages, 1);
});

const event = (id: string, draftId: string, reasons: string[], minutes?: number): WorkflowEventRecord => ({ id, type: "draft.edit-observation", subjectType: "draft", subjectId: `${draftId}:${id}`, createdAt: "2026-10-02T00:00:00Z", payload: { draftId, reasons, userEditMinutes: minutes ?? null, timingBasis: minutes === undefined ? "unmeasured" : "user-reported" } });
test("rework reason frequencies distinguish records and independent drafts, and unknown time never becomes zero", () => {
  const records = [event("one", "d1", ["structure", "structure"]), event("two", "d1", ["structure", "condition"], 12), event("three", "d2", ["structure"], 0)];
  const input = { events: [...records, records[0]!, event("bad", "d1", ["bad-reason"])], total: 15, truncated: true };
  const before = JSON.stringify(input), report = summarizeReworkObservations(input);
  assert.equal(report.records, 3); assert.equal(report.drafts, 2); assert.equal(report.excludedRecords, 1);
  assert.deepEqual(report.reasons[0], { reason: "structure", label: "结构不顺", records: 3, drafts: 2 });
  assert.equal(report.userReportedMinutes, 12); assert.equal(report.measuredRecords, 2); assert.equal(report.unmeasuredRecords, 1);
  assert.equal(report.coverage.truncated, true); assert.equal(JSON.stringify(input), before);
  assert.equal(summarizeReworkObservations({ events: [records[0]!], total: 1, truncated: false }).userReportedMinutes, null);
  assert.equal(summarizeReworkObservations().collected, false);
});
test("performance rework includes only observations within the requested reporting window", () => {
  const older = event("old", "d1", ["fact"]); older.createdAt = "2026-01-01T00:00:00Z";
  const state = createDefaultState(), before = JSON.stringify(state);
  const report = buildWorkflowPerformance(state, { now: "2026-10-02T03:00:00Z", rework: { events: [older, event("now", "d2", ["structure"])], total: 2, truncated: false } });
  assert.equal(report.drafts.rework.records, 1); assert.equal(report.drafts.rework.userReportedMinutes, null);
  assert.equal(report.drafts.confirmedManualSamples, 0); assert.equal(JSON.stringify(state), before);
});
