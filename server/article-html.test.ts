import assert from "node:assert/strict";
import test from "node:test";
import {
  insertedMediaIds,
  legacyDraftBodyHtml,
  normalizedDraftBodyHtml,
  publisherImageCaptions,
  publisherImagePostBodyHtml,
  publisherBodyHtml,
} from "./article-html.js";
import type { ArticleDraft } from "./types.js";

const draft = (): ArticleDraft => ({
  id: "draft_test",
  runId: "run_test",
  candidateId: "candidate_test",
  createdAt: "2026-08-11T00:00:00.000Z",
  updatedAt: "2026-08-11T00:00:00.000Z",
  status: "editing",
  title: "测试文章",
  paragraphs: ["第一段", "第二段"],
  take: "结尾观点",
  sources: [],
  uncertainties: [],
  images: [{
    id: "placement_one",
    afterParagraph: 0,
    caption: "架构图",
    image: {
      id: "image_one",
      url: "https://example.com/architecture.png",
      publicPath: "/media/draft_test/image_one.png",
      localPath: "/tmp/image_one.png",
      caption: "架构图",
      attribution: "example.com",
      sourceUrl: "https://example.com/article",
      selected: true,
      rights: "check-required",
    },
  }],
  community: "盒友杂谈",
  topics: ["AI 人工智能"],
  provenance: {
    originalUrl: "https://example.com/article",
    generatedBy: "codex-cli",
  },
});

test("legacy drafts migrate into one continuous HTML document", () => {
  const next = draft();
  next.images.push({
    ...next.images[0],
    id: "library_only",
    afterParagraph: -1,
    image: { ...next.images[0].image, id: "library_image", url: "https://example.com/library.png" },
  });
  const html = legacyDraftBodyHtml(next);
  assert.match(html, /第一段/);
  assert.match(html, /data-media-id="placement_one"/);
  assert.doesNotMatch(html, /data-media-id="library_only"/);
  assert.match(html, /结尾观点/);
});

test("rich HTML is sanitized while editorial formatting remains", () => {
  const next = draft();
  next.bodyHtml = '<h2>小标题</h2><p onclick="alert(1)">正文<strong>重点</strong></p><script>alert(2)</script><img src="/media/draft_test/image_one.png" data-media-id="placement_one">';
  const html = normalizedDraftBodyHtml(next);
  assert.match(html, /<h2>小标题<\/h2>/);
  assert.match(html, /<strong>重点<\/strong>/);
  assert.doesNotMatch(html, /onclick|script|alert/);
});

test("publisher conversion moves an inserted image caption out of the article body", () => {
  const next = draft();
  next.bodyHtml = '<p>前文</p><img src="/media/draft_test/image_one.png" data-media-id="placement_one"><p>图：架构图</p><p>后文</p>';
  const html = publisherBodyHtml(next);
  assert.match(html, /前文.*data-ai-news-image="placement_one".*后文/s);
  assert.doesNotMatch(html, /<p>图：架构图<\/p>/);
  assert.match(html, /AIIMG:placement_one/);
  assert.match(html, /【待上传配图/);
  assert.equal(publisherImageCaptions(next).get("placement_one"), "架构图");
  assert.deepEqual([...insertedMediaIds(next)], ["placement_one"]);
});

test("publisher caption prefers the edited paragraph over a generic image label", () => {
  const next = draft();
  next.images[0].caption = "image";
  next.images[0].image.caption = "image";
  next.bodyHtml = '<p>前文</p><img src="/media/draft_test/image_one.png" data-media-id="placement_one"><p>图：广告示意图</p><p>后文</p>';

  assert.equal(publisherImageCaptions(next).get("placement_one"), "广告示意图");
  assert.doesNotMatch(publisherBodyHtml(next), /<p>图：广告示意图<\/p>/);
});

test("publisher captions fit Xiaoheihe's native image description limit", () => {
  const next = draft();
  next.bodyHtml = `<p>前文</p><img src="/media/draft_test/image_one.png" data-media-id="placement_one"><p>图：${"很长的图片说明".repeat(12)}（来源：example.com）</p><p>后文</p>`;
  const caption = publisherImageCaptions(next).get("placement_one") || "";

  assert.ok(caption.length > 0);
  assert.ok(caption.length <= 30);
  assert.doesNotMatch(caption, /来源/);
});

test("image-post drafts keep the selected image and short copy without article captions", () => {
  const next = draft();
  next.contentFormat = "image-post";
  next.paragraphs = ["额度用完不用升级、也不用等下周，付 8 美元就能原地重置。", "好家伙，AI 订阅现在连“续命币”都安排上了。"];
  next.take = "";
  next.bodyHtml = '<p>额度用完不用升级、也不用等下周，付 8 美元就能原地重置。</p><p>好家伙，AI 订阅现在连“续命币”都安排上了。</p><img src="/media/draft_test/image_one.png" data-media-id="placement_one">';

  assert.equal(next.contentFormat, "image-post");
  assert.deepEqual([...insertedMediaIds(next)], ["placement_one"]);
  assert.doesNotMatch(normalizedDraftBodyHtml(next), /图：|总结/);
  assert.match(publisherImagePostBodyHtml(next), /额度用完.*续命币/s);
  assert.doesNotMatch(publisherImagePostBodyHtml(next), /待上传配图|AIIMG|<img|图：/);
});
