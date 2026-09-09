import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { LocalDatabase } from "./local-database.js";
import { readSourceWithSnapshot, sourceSnapshotKey } from "./source-snapshot.js";
import type { ExtractedPage } from "./types.js";

const page: ExtractedPage = {
  url: "https://example.com/article",
  canonicalUrl: "https://example.com/article",
  title: "来源文章",
  text: "这是一段足够长的来源正文，用于验证成功抓取后会保存快照，并在同一个来源临时失败时安全复用。".repeat(3),
  blocks: [{ kind: "paragraph", text: "来源正文" }],
  images: [],
};

test("a fresh exact-URL snapshot survives a temporary source failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-source-snapshot-"));
  const database = await LocalDatabase.open({ workflowRoot: root, initialState: () => ({ version: 12 }) });
  const now = () => new Date("2026-09-01T00:00:00.000Z");
  try {
    const live = await readSourceWithSnapshot({
      url: "https://example.com/article?utm_source=feed",
      imageLimit: 4,
      database,
      now,
      extractor: async () => page,
    });
    assert.equal(live.fromCache, false);

    const fallback = await readSourceWithSnapshot({
      url: "https://example.com/article",
      imageLimit: 4,
      database,
      now,
      extractor: async () => { throw new Error("temporary timeout"); },
    });
    assert.equal(fallback.fromCache, true);
    assert.equal(fallback.liveError, "temporary timeout");
    assert.equal(fallback.page.text, page.text);
    assert.equal(sourceSnapshotKey("https://example.com/article?utm_source=x#top"), "https://example.com/article");
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("an expired snapshot is not silently reused", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-source-expired-"));
  const database = await LocalDatabase.open({ workflowRoot: root, initialState: () => ({ version: 12 }) });
  try {
    database.saveSourceSnapshot({
      urlKey: sourceSnapshotKey(page.url),
      requestedUrl: page.url,
      canonicalUrl: page.canonicalUrl,
      page,
      capturedAt: "2026-08-01T00:00:00.000Z",
    });
    await assert.rejects(() => readSourceWithSnapshot({
      url: page.url,
      imageLimit: 4,
      database,
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      maximumCacheAgeMs: 7 * 24 * 60 * 60 * 1_000,
      extractor: async () => { throw new Error("still offline"); },
    }), /still offline/u);
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("dated official updates keep separate snapshots and never borrow another event on failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-update-snapshot-"));
  const database = await LocalDatabase.open({ workflowRoot: root, initialState: () => ({ version: 12 }) });
  const first = "https://ai.google.dev/gemini-api/docs/changelog#09-03-2026";
  const second = "https://ai.google.dev/gemini-api/docs/changelog#09-04-2026";
  const firstPage = { ...page, url: first, canonicalUrl: first };
  try {
    await readSourceWithSnapshot({ url: first, imageLimit: 4, database, extractor: async () => firstPage });
    await assert.rejects(readSourceWithSnapshot({ url: second, imageLimit: 4, database,
      extractor: async () => { throw new Error("new event unavailable"); } }), /new event unavailable/u);
    const cached = await readSourceWithSnapshot({ url: first, imageLimit: 4, database,
      extractor: async () => { throw new Error("offline"); } });
    assert.equal(cached.fromCache, true);
    assert.equal(cached.page.canonicalUrl, first);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test("official update snapshot rejects mismatched live or cached event identity", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ai-news-update-identity-"));
  const database = await LocalDatabase.open({ workflowRoot: root, initialState: () => ({ version: 12 }) });
  const requested = "https://api-docs.deepseek.com/updates/#date-2026-09-03";
  const wrong = "https://api-docs.deepseek.com/updates/#date-2026-09-04";
  const wrongPage = { ...page, url: wrong, canonicalUrl: wrong };
  try {
    await assert.rejects(readSourceWithSnapshot({ url: requested, imageLimit: 4, database,
      extractor: async () => wrongPage }), /事件/u);
    database.saveSourceSnapshot({ urlKey: sourceSnapshotKey(requested), requestedUrl: requested,
      canonicalUrl: wrong, page: wrongPage, capturedAt: new Date().toISOString() });
    await assert.rejects(readSourceWithSnapshot({ url: requested, imageLimit: 4, database,
      extractor: async () => { throw new Error("offline"); } }), /offline/u);
  } finally { database.close(); await rm(root, { recursive: true, force: true }); }
});

test("snapshot identity preserves case-sensitive paths, query values and non-tracking article keys", () => {
  assert.notEqual(sourceSnapshotKey("https://example.com/Post?id=ABC"), sourceSnapshotKey("https://example.com/post?id=abc"));
  assert.notEqual(sourceSnapshotKey("https://example.com/read?source=article-a"), sourceSnapshotKey("https://example.com/read?source=article-b"));
});
