import { confirmDraftInState } from "./draft-confirmation.js";
import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import {
  appendDraftRevision,
  restoreDraftRevision,
  revisionsForDraft,
} from "./draft-revisions.js";
import type { ArticleDraft } from "./types.js";

const makeDraft = (): ArticleDraft => ({
  id: "draft_history",
  runId: "run_history",
  candidateId: "candidate_history",
  createdAt: "2026-08-11T12:00:00.000Z",
  updatedAt: "2026-08-11T12:00:00.000Z",
  status: "editing",
  title: "最初的标题",
  paragraphs: ["正文"],
  take: "观点",
  bodyHtml: "<p>最初的正文</p>",
  layoutTheme: "news-clean",
  sources: [],
  uncertainties: [],
  images: [],
  community: "盒友杂谈",
  topics: ["AI 人工智能"],
  provenance: {
    originalUrl: "https://example.com/news",
    generatedBy: "codex-cli",
  },
});

test("nearby automatic saves roll into one checkpoint", () => {
  const state = createDefaultState();
  const draft = makeDraft();
  appendDraftRevision(state, draft, "auto", new Date("2026-08-11T12:00:00.000Z"));
  draft.title = "两分钟后的标题";
  appendDraftRevision(state, draft, "auto", new Date("2026-08-11T12:02:00.000Z"));

  const revisions = revisionsForDraft(state, draft.id);
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0].snapshot.title, "两分钟后的标题");
  assert.equal(revisions[0].updatedAt, "2026-08-11T12:02:00.000Z");
});

test("manual checkpoints stay distinct and history is capped", () => {
  const state = createDefaultState();
  const draft = makeDraft();
  for (let index = 0; index < 35; index += 1) {
    draft.title = `版本 ${index}`;
    appendDraftRevision(state, draft, "manual", new Date(1_786_444_800_000 + index * 1_000));
  }

  const revisions = revisionsForDraft(state, draft.id);
  assert.equal(revisions.length, 30);
  assert.equal(revisions[0].snapshot.title, "版本 34");
  assert.equal(revisions.at(-1)?.snapshot.title, "版本 5");
});

test("restoring a revision first keeps the current draft as a backup", () => {
  const state = createDefaultState();
  const draft = makeDraft();
  state.drafts.push(draft);
  const oldRevision = appendDraftRevision(
    state,
    draft,
    "manual",
    new Date("2026-08-11T12:00:00.000Z"),
  );
  draft.title = "当前尚未恢复的标题";
  draft.bodyHtml = "<p>当前正文</p>";

  restoreDraftRevision(state, draft, oldRevision, new Date("2026-08-11T12:10:00.000Z"));

  assert.equal(draft.title, "最初的标题");
  const revisions = revisionsForDraft(state, draft.id);
  assert.equal(revisions[0].kind, "restore-backup");
  assert.equal(revisions[0].snapshot.title, "当前尚未恢复的标题");
});

test("image-post revisions preserve the Xiaoheihe editor surface", () => {
  const state = createDefaultState();
  const draft = makeDraft();
  draft.contentFormat = "image-post";
  state.drafts.push(draft);
  const revision = appendDraftRevision(state, draft, "manual", new Date("2026-08-13T00:00:00.000Z"));

  draft.contentFormat = "article";
  restoreDraftRevision(state, draft, revision, new Date("2026-08-13T00:01:00.000Z"));

  assert.equal(draft.contentFormat, "image-post");
});

test("confirmation survives autosave and keeps the immutable initial baseline", () => {
  const state = createDefaultState(); const draft = makeDraft();
  appendDraftRevision(state, draft, "initial");
  const initial = structuredClone(draft.editorialBaseline!.initial.snapshot);
  for (let i = 0; i < 35; i++) { draft.title = `人工修改 ${i}`; appendDraftRevision(state, draft, "auto", new Date(Date.now() + i * 600000)); }
  const result = confirmDraftInState(state, draft, draft.updatedAt);
  assert.equal(result.learningEligible, true);
  assert.deepEqual(result.before, initial);
  assert.equal(result.after?.title, "人工修改 34");
  assert.deepEqual(draft.editorialBaseline!.initial.snapshot, initial);
  assert.ok(state.draftRevisions.some((revision) => revision.kind === "initial"));
  assert.ok(state.draftRevisions.some((revision) => revision.kind === "confirmed"));
  assert.equal(confirmDraftInState(state, draft, draft.updatedAt).reused, true);
  assert.throws(() => confirmDraftInState(state, draft, "old-version"), /版本已变化/);
});

test("AI-assisted cycles do not train preferences; subsequent human edits can", () => {
  const state = createDefaultState(); const draft = makeDraft();
  appendDraftRevision(state, draft, "initial");
  draft.title = "AI 修改的标题"; draft.aiAssistedSinceConfirmation = true;
  appendDraftRevision(state, draft, "auto");
  assert.equal(confirmDraftInState(state, draft, draft.updatedAt).learningEligible, false);
  draft.title = "用户再次修改标题"; appendDraftRevision(state, draft, "auto");
  const confirmed = confirmDraftInState(state, draft, draft.updatedAt);
  assert.equal(confirmed.learningEligible, true);
  assert.equal(confirmed.before?.title, "AI 修改的标题");
  assert.equal(state.draftRevisions.filter((revision) => revision.kind === "confirmed").length, 2);
});

test("legacy drafts disclose missing initial history and only establish a first confirmation baseline", () => {
  const state = createDefaultState(); const draft = makeDraft();
  assert.equal(confirmDraftInState(state, draft, draft.updatedAt).learningEligible, false);
  assert.equal(draft.editorialBaseline?.initial.origin, "legacy");
});

test("source-change review decisions remain attached to their historical document",()=>{
 const state=createDefaultState(),draft=makeDraft();draft.sourceChangeReviews=[{url:"https://example.com",observedHash:"new",packageHash:"p",documentHash:"d",reason:"Reviewed this exact version",reviewedAt:"2026-09-10"}];
 const revision=appendDraftRevision(state,draft,"manual");draft.sourceChangeReviews=[];restoreDraftRevision(state,draft,revision);assert.deepEqual(draft.sourceChangeReviews,revision.snapshot.sourceChangeReviews);assert.equal(draft.sourceChangeReviews?.[0]?.documentHash,"d");
});
