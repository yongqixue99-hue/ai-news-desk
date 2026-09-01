import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDraftReadiness } from "./draft-readiness.js";
import type { ArticleDraft } from "./types.js";

const draft = (): ArticleDraft => ({
  id: "draft-1", runId: "run-1", candidateId: "candidate-1",
  createdAt: "2026-08-13T00:00:00.000Z", updatedAt: "2026-08-13T00:00:00.000Z",
  status: "editing", title: "测试", paragraphs: ["正文"], take: "判断", bodyHtml: "<p>正文足够长，用于测试发布准备度。</p>",
  sources: [{ label: "官方", url: "https://example.com/news", kind: "primary", verified: true }],
  factClaims: [{ id: "claim-1", claim: "已正式发布", status: "full-source", sourceUrl: "https://example.com/news", capturedAt: "2026-08-13T00:00:00.000Z" }],
  uncertainties: [], images: [], community: "盒友杂谈", topics: ["AI"],
  provenance: { originalUrl: "https://example.com/news", generatedBy: "test" },
});

test("a fully sourced text draft can proceed without pretending it has images", () => {
  const result = evaluateDraftReadiness(draft(), "xiaoheihe", "2026-08-13T01:00:00.000Z");
  assert.equal(result.ready, true);
  assert.deepEqual(result.blockers, []);
});

test("uncertain facts and unlicensed inserted images block readiness", () => {
  const input = draft();
  input.uncertainties = ["发布日期尚未核实"];
  input.images = [{
    id: "placement-1", afterParagraph: 0, caption: "人物现场",
    image: {
      id: "image-1", url: "/media/image.jpg", localPath: "/tmp/image.jpg",
      caption: "人物现场", attribution: "来源待补充", sourceUrl: "material-library",
      selected: true, rights: "check-required",
    },
  }];
  const result = evaluateDraftReadiness(input, "xiaoheihe", "2026-08-13T01:00:00.000Z");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /发布日期尚未核实/);
  assert.match(result.blockers.join("\n"), /版权状态待确认/);
});

test("known editorial limits and image notes are not mislabeled as unresolved facts", () => {
  const input = draft();
  input.uncertainties = [
    "仍未知：公开资料没有说明项目的生产环境用户数量",
    "部分原图可进入私人编辑草稿，但公众号同步前会被预检拦截，需确认权利或替换",
  ];

  const result = evaluateDraftReadiness(input, "wechat", "2026-08-13T01:00:00.000Z");

  assert.equal(result.ready, true);
  assert.deepEqual(result.factBlockers, []);
});

test("a source working copy remains blocked by its explicit rights state", () => {
  const input = draft();
  input.sourceMaterial = {
    kind: "article",
    mode: "source",
    sourceUrl: "https://example.com/article",
    sourceLabel: "Example",
    rights: "check-required",
    requiresEditorialReview: true,
  };
  input.uncertainties = ["这是来源派生的私有编辑草稿，转载、翻译与图片使用权均需在发布前确认。"];

  const result = evaluateDraftReadiness(input, "wechat", "2026-08-13T01:00:00.000Z");

  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /原文工作副本.*权利/u);
  assert.doesNotMatch(result.blockers.join("\n"), /待确认事实/u);
});

test("a local licensed file is not accepted as its own permission evidence", () => {
  const input = draft();
  input.images = [{
    id: "placement-licensed",
    afterParagraph: 0,
    caption: "人物资料图",
    image: {
      id: "image-licensed",
      url: "/media/person.jpg",
      publicPath: "/media/person.jpg",
      localPath: "C:\\workflow\\media\\person.jpg",
      caption: "人物资料图",
      attribution: "Example Photographer / CC BY 4.0",
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Example.jpg",
      selected: true,
      rights: "licensed",
      allowedPlatforms: ["xiaoheihe"],
    },
  }];

  const result = evaluateDraftReadiness(input, "xiaoheihe", "2026-08-13T01:00:00.000Z");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /缺少授权证据/u);
});

test("an owned image with a stale path cannot make a draft publication-ready", () => {
  const input = draft();
  const migratedPath = process.platform === "win32"
    ? "/Users/old-mac/ai-news-desk/media/owned.jpg"
    : "C:\\Users\\old-windows\\ai-news-desk\\media\\owned.jpg";
  input.images = [{
    id: "placement-owned",
    afterParagraph: 0,
    caption: "自有图片",
    image: {
      id: "image-owned",
      url: "/media/owned.jpg",
      publicPath: "/media/owned.jpg",
      localPath: migratedPath,
      caption: "自有图片",
      attribution: "AI News Desk",
      sourceUrl: "https://example.com/news",
      selected: true,
      rights: "owned",
      allowedPlatforms: ["*"],
    },
  }];

  const result = evaluateDraftReadiness(input, "xiaoheihe", "2026-08-13T01:00:00.000Z");

  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /其他操作系统|不是绝对路径/u);
});
