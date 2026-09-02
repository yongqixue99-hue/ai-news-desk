import assert from "node:assert/strict";
import test from "node:test";
import { collectionReadinessLog, mergeCandidateProbeImages, scheduledWindowHoursFor } from "./horizon.js";
import type { SourceImage } from "./types.js";

test("collection readiness does not claim Chinese briefs are ready when generation completed zero items", () => {
  assert.deepEqual(collectionReadinessLog(60, 0), {
    message: "候选列表已准备好；中文摘要生成 0/60 条，可稍后重试补全",
    level: "warning",
  });
});

test("scheduled collection uses a 48-hour minimum without shrinking a larger imported window", () => {
  assert.equal(scheduledWindowHoursFor(24), 48);
  assert.equal(scheduledWindowHoursFor(48), 48);
  assert.equal(scheduledWindowHoursFor(72), 72);
});

test("page probing merges into X media without replacing rights, attribution, or local evidence", () => {
  const xMedia: SourceImage = {
    id: "x-media:photo-1",
    url: "https://pbs.twimg.com/media/photo-1.jpg",
    localPath: "E:/news-assets/x/photo-1.jpg",
    publicPath: "/media/x/photo-1.jpg",
    caption: "Official launch image",
    attribution: "@OpenAI",
    sourceUrl: "https://x.com/OpenAI/status/200",
    selected: false,
    rights: "check-required",
    evidenceNote: "X 原帖素材，发布前核权",
    evidencePath: "E:/news-assets/x/photo-1.evidence.json",
  };
  const duplicateFromPage: SourceImage = {
    id: "page-hash-photo-1",
    url: xMedia.url,
    caption: "来源页面配图",
    attribution: "x.com",
    sourceUrl: "https://x.com/OpenAI/status/200?ref=page",
    selected: true,
    rights: "check-required",
  };
  const newFromPage: SourceImage = {
    id: "page-photo-2",
    url: "https://pbs.twimg.com/media/photo-2.jpg",
    caption: "Second page image",
    attribution: "x.com",
    sourceUrl: "https://x.com/OpenAI/status/200",
    selected: false,
    rights: "check-required",
  };

  const merged = mergeCandidateProbeImages([xMedia], [duplicateFromPage, newFromPage]);
  const preserved = merged.find((image) => image.url === xMedia.url);

  assert.equal(merged.length, 2, "the duplicate URL is not counted twice");
  assert.equal(preserved?.id, xMedia.id);
  assert.equal(preserved?.localPath, xMedia.localPath);
  assert.equal(preserved?.publicPath, xMedia.publicPath);
  assert.equal(preserved?.rights, "check-required");
  assert.equal(preserved?.attribution, "@OpenAI");
  assert.equal(preserved?.sourceUrl, xMedia.sourceUrl);
  assert.equal(preserved?.evidenceNote, xMedia.evidenceNote);
  assert.equal(preserved?.evidencePath, xMedia.evidencePath);
});
