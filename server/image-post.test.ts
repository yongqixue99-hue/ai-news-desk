import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";
import {
  buildScreenshotImagePostDraft,
  cropScreenshotRegion,
  normalizeImagePostCopy,
} from "./image-post.js";

test("image-post copy stays short, emotional and free of summary scaffolding", () => {
  const copy = normalizeImagePostCopy({
    title: "Codex 用完额度，竟然弹出 8 美元“续命”按钮",
    lines: [
      "额度耗尽后，页面直接出现了“Pay $8 to reset”。",
      "好家伙，AI 订阅现在连“续命币”都安排上了。",
    ],
  });

  assert.equal(copy.lines.length, 2);
  assert.ok(copy.title.length <= 30);
  assert.doesNotMatch(copy.lines.join(""), /总结|综上|总的来说/);
});

test("image-post copy rejects article-length and summary-style input", () => {
  assert.throws(() => normalizeImagePostCopy({
    title: "测试",
    lines: ["第一行", "第二行", "第三行", "第四行"],
  }), /最多 3 行/);
  assert.throws(() => normalizeImagePostCopy({
    title: "测试",
    lines: ["总结：这是结论"],
  }), /不要出现总结/);
});

test("screenshot region is a literal pixel crop and becomes the only image in the draft", async () => {
  const source = await sharp({
    create: { width: 100, height: 80, channels: 3, background: "#ff0000" },
  }).png().toBuffer();
  const cropped = await cropScreenshotRegion(source, {
    left: 10,
    top: 20,
    width: 60,
    height: 40,
  });
  const metadata = await sharp(cropped).metadata();
  assert.equal(metadata.width, 60);
  assert.equal(metadata.height, 40);

  const draft = buildScreenshotImagePostDraft({
    draftId: "draft_image_post_test",
    createdAt: "2026-08-13T00:00:00.000Z",
    title: "Codex 用完额度，竟然弹出 8 美元“续命”按钮",
    lines: [
      "额度耗尽后，页面直接出现了“Pay $8 to reset”。",
      "好家伙，AI 订阅现在连“续命币”都安排上了。",
    ],
    originalLocalPath: "/tmp/source.png",
    originalPublicPath: "/media/draft_image_post_test/source.png",
    cropLocalPath: "/tmp/crop.png",
    cropPublicPath: "/media/draft_image_post_test/crop.png",
    cropFingerprint: "a".repeat(64),
    cropWidth: 60,
    cropHeight: 40,
    community: "盒友杂谈",
    topics: [],
    sourceExcerpt: "Pay $8 to reset",
  });

  assert.equal(draft.contentFormat, "image-post");
  assert.equal(draft.images.length, 1);
  assert.match(draft.bodyHtml || "", /data-media-id=/);
  assert.doesNotMatch(draft.bodyHtml || "", /图：|总结/);
  assert.equal(draft.take, "");
  assert.equal(draft.images[0]?.image.rights, "editorial-screenshot");
  assert.deepEqual(draft.images[0]?.image.allowedPlatforms, ["xiaoheihe"]);
});
