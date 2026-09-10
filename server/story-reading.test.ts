import assert from "node:assert/strict";
import test from "node:test";
import { readStoredStorySources } from "./story-reading.js";
import { discoveryFixture } from "../tests/fixtures/discovery.js";

test("reader prefers frozen wording and never fetches a missing source", () => {
  const { story, contentPackage } = discoveryFixture();
  const materials = readStoredStorySources(story, contentPackage, { getSourceSnapshot: () => { throw new Error("must use frozen evidence"); } });
  assert.equal(materials[0]?.originalText, contentPackage.sourceEvidence![0]!.originalText);
  assert.equal(materials[0]?.truncated, true);
  assert.deepEqual(readStoredStorySources(story, undefined, { getSourceSnapshot: () => undefined }), []);
});

test("stored reader does not substitute a different article or hide a display limit", () => {
  const { story } = discoveryFixture();
  const signal = story.signals[0]!;
  const cached = { urlKey: signal.url, requestedUrl: signal.url, canonicalUrl: signal.url, capturedAt: "2026-09-01T00:00:00Z", page: { url: signal.url, canonicalUrl: "https://example.com/different", title: "fixture", text: "a".repeat(31000), images: [] } };
  const db = { getSourceSnapshot: <T>() => cached as unknown as import("./local-database.js").SourceSnapshotRecord<T> };
  assert.deepEqual(readStoredStorySources(story, undefined, db), []);
  cached.page.canonicalUrl = signal.url;
  const result = readStoredStorySources(story, undefined, db);
  assert.equal(result[0]?.originalText.length, 30000);
  assert.equal(result[0]?.truncated, true);
  assert.equal(result[0]?.capturedAt, cached.capturedAt);
});
