import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultState } from "./defaults.js";
import { createBlankDraftInState } from "./draft-library.js";
import { addDraftReference, normalizeDraftReferences } from "./draft-references.js";
import { appendDraftRevision, restoreDraftRevision } from "./draft-revisions.js";
import { publisherBodyHtml } from "./article-html.js";
import { readDraftReference } from "./draft-reference-reader.js";
import { editableDraftContent, persistDraftRecoverySnapshot, restoreDraftFromRecovery } from "../src/draft-stability.js";
import { createWorkflowBackup, verifyWorkflowBackup } from "./data-management.js";
import { upgradeState } from "./defaults.js";
import express from "express";
import { registerDraftReferenceRoutes } from "./draft-reference-routes.js";
import { inMemoryHttpRuntime, withHttpRouteServer } from "./http-route-test-support.js";

test("an author can attach a link and notes without changing the article, evidence or delivery", () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state);
  draft.title = "我正在写的文章";
  draft.bodyHtml = "<p>我自己的观点。</p>";
  const before = publisherBodyHtml(draft);
  const next = addDraftReference(draft, { id: "ref-1", kind: "link", url: "https://example.com/article#section", title: "参考原文", text: "只放在资料里的私人笔记", capturedAt: "2026-10-22T00:00:00.000Z" });
  assert.equal(next.references?.[0].url, "https://example.com/article#section");
  assert.equal(next.references?.[0].text, "只放在资料里的私人笔记");
  assert.equal(publisherBodyHtml(next), before);
  assert.deepEqual(next.sources, []);
  assert.deepEqual(next.factClaims, []);
  assert.equal(next.provenance.contentPackageId, undefined);
  assert.equal(draft.references, undefined);
  state.drafts[0] = next;
  const revision = appendDraftRevision(state, next, "manual");
  next.references = [];
  restoreDraftRevision(state, next, revision);
  assert.equal(next.references?.[0].text, "只放在资料里的私人笔记");
});

test("duplicate links keep the first captured source, and private notes survive recovery and backup", () => {
  const state = createDefaultState();
  const original = createBlankDraftInState(state);
  const reference = { id: "first", kind: "link" as const, url: "https://example.com/source", title: "原文", text: "原始摘录", capturedAt: "2026-10-22T00:00:00Z" };
  const withSource = addDraftReference(original, reference);
  const next = addDraftReference(withSource, { ...reference, id: "second", text: "重复输入不能覆盖原文" });
  assert.equal(next.references?.length, 1);
  assert.equal(next.references?.[0].text, "原始摘录");
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); }, removeItem: (key: string) => { data.delete(key); } };
  persistDraftRecoverySnapshot(storage, next, new Date(Date.parse(original.updatedAt) + 1).toISOString());
  assert.deepEqual(restoreDraftFromRecovery(storage, original)?.references, next.references);
  assert.deepEqual(editableDraftContent(next).references, next.references);
  state.drafts[0] = next;
  assert.deepEqual(upgradeState(verifyWorkflowBackup(createWorkflowBackup(state)).state).drafts[0].references, next.references);
});

test("material references cannot contain executable URLs or screenshots from another draft", () => {
  const base = { id: "ref", kind: "link", title: "资料", capturedAt: "2026-10-22T00:00:00Z" };
  for (const url of ["javascript:alert(1)", "file:///private/file", "https://user:secret@example.com/"]) assert.throws(() => normalizeDraftReferences([{ ...base, url }], []));
  assert.throws(() => normalizeDraftReferences([{ ...base, kind: "screenshot", imagePlacementId: "other-draft" }], []), /当前稿件/);
});

test("reference reading endpoint does not modify the draft or require a model/database connection", async () => {
  const state = createDefaultState();
  const draft = createBlankDraftInState(state), before = structuredClone(state);
  const { runtime, touched } = inMemoryHttpRuntime(state), app = express();
  app.use(express.json());
  registerDraftReferenceRoutes(app, runtime, async url => {
    assert.equal(url, "https://example.com/source");
    return { title: "官方原文", text: "供阅读的原始文字", readStatus: "read" };
  });
  await withHttpRouteServer(app, async origin => {
    const response = await fetch(`${origin}/api/drafts/${draft.id}/references/read`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url: "https://example.com/source" }) });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).text, "供阅读的原始文字");
    assert.equal((await fetch(`${origin}/api/drafts/missing/references/read`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 404);
  });
  assert.deepEqual(state, before);
  assert.deepEqual(touched, []);
});

test("reading reference material retains the requested link and attribution without generating facts", async () => {
  const result = await readDraftReference("https://example.com/original", async () => ({
    url: "https://example.com/original", canonicalUrl: "https://example.com/canonical", title: "原始文章标题", author: "原作者",
    text: "来源正文。\n\n这里保留作者的限定条件。", images: [],
  }));
  assert.equal(result.title, "原始文章标题");
  assert.equal(result.author, "原作者");
  assert.equal(result.text, "来源正文。\n\n这里保留作者的限定条件。");
  assert.equal(result.readStatus, "read");
  assert.equal(Object.hasOwn(result, "factClaims"), false);
  await assert.rejects(readDraftReference("https://example.com/blocked", async () => { throw new Error("HTTP 403"); }), /原文/);
});
