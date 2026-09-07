import assert from "node:assert/strict";
import test from "node:test";
import { insertedMediaIds, publisherImagePostBodyHtml, sanitizeDraftHtml } from "./article-html.js";
import { publicationRevisionHash } from "./publication-state.js";
import { snapshotDraft } from "./draft-revisions.js";
import { normalizePublisherTopics } from "./xiaoheihe-format.js";
import { editableDraftContent } from "../src/draft-stability.js";
import type { ArticleDraft } from "./types.js";

test("image-post selection survives save and changes the publication hash without changing article placement", () => {
  const draft = { id: "gallery", runId: "run", candidateId: "candidate", status: "editing", createdAt: "2026-09-07T00:00:00Z", updatedAt: "2026-09-07T00:00:00Z", provenance: { originalUrl: "https://example.com/guide", generatedBy: "human" }, contentFormat: "image-post", imagePostImageIds: ["b", "a"], title: "官方实践图解", bodyHtml: '<p>原文说明</p><img data-media-id="a" src="/media/a.png">', paragraphs: ["原文说明"], take: "", community: "盒友杂谈", topics: ["AI"], sources: [], uncertainties: [], images: ["a", "b"].map(id => ({ id, caption: id, afterParagraph: 0, image: { id, url: `https://example.com/${id}.png`, caption: id, attribution: "Official", sourceUrl: "https://example.com/guide", selected: true, rights: "check-required" } })) } as ArticleDraft;
  assert.deepEqual([...insertedMediaIds(draft)], ["b", "a"]);
  assert.deepEqual(editableDraftContent(draft).imagePostImageIds, ["b", "a"]);
  assert.equal(editableDraftContent(draft).contentFormat, "image-post");
  assert.deepEqual(snapshotDraft(draft).imagePostImageIds, ["b", "a"]);
  const before = publicationRevisionHash(draft, "xiaoheihe");
  draft.imagePostImageIds = ["a", "b"];
  assert.notEqual(publicationRevisionHash(draft, "xiaoheihe"), before);
  assert.match(publisherImagePostBodyHtml(draft), /官方|Official/u);
  draft.contentFormat = "article";
  assert.deepEqual([...insertedMediaIds(draft)], ["a"]);
});

test("topics normalize hashes and case duplicates while source tables and code survive sanitization", () => {
  assert.deepEqual(normalizePublisherTopics([" #AI# ", "ai", "", "Agent"]), ["ai", "Agent"]);
  assert.equal(sanitizeDraftHtml('<table><tbody><tr><th>A</th><td>B</td></tr></tbody></table><pre><code>if ready:\n    run()</code></pre>'), '<table><tbody><tr><th>A</th><td>B</td></tr></tbody></table><pre><code>if ready:\n    run()</code></pre>');
});
