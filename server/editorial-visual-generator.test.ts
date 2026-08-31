import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import test from "node:test";
import {
  createGeneratedEditorialFallback,
  createGroundedEditorialCover,
} from "./editorial-visual-generator.js";
import type { SourceImage } from "./types.js";

test("a premium identity cover preserves the real portrait and its governance", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-news-grounded-cover-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const portraitPath = path.join(directory, "geoffrey-hinton.png");
  await sharp({
    create: { width: 600, height: 800, channels: 3, background: "#d7b49e" },
  }).png().toFile(portraitPath);
  const portrait: SourceImage = {
    id: "commons_101",
    url: "/media/story/portrait.png",
    localPath: portraitPath,
    publicPath: "/media/story/portrait.png",
    caption: "Geoffrey Hinton at UCL",
    attribution: "Jane Example / Wikimedia Commons",
    sourceUrl: "https://commons.wikimedia.org/wiki/File:Geoffrey_Hinton_at_UCL.jpg",
    width: 600,
    height: 800,
    selected: true,
    rights: "licensed",
    evidenceNote: "Commons 文件页确认 CC BY 4.0。",
    licenseId: "CC-BY-4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
    modificationNote: "在线检索并缓存，尚未进行内容性修改。",
    allowedPlatforms: ["wechat", "xiaoheihe"],
    entityTags: ["Geoffrey Hinton"],
    editorialPriority: 3,
    editorialOrigin: "entity-library",
  };

  const cover = await createGroundedEditorialCover({
    source: portrait,
    storyTitle: "诺贝尔奖得主 Geoffrey Hinton 警告 AI 风险",
    assetDirectory: directory,
    publicDirectory: "/media/story",
  });

  assert.equal(cover.editorialPriority, 3);
  assert.equal(cover.editorialOrigin, "entity-library");
  assert.equal(cover.rights, "licensed");
  assert.equal(cover.licenseId, "CC-BY-4.0");
  assert.equal(cover.sourceUrl, portrait.sourceUrl);
  assert.match(cover.modificationNote || "", /主体未由 AI 重绘/u);
  assert.match(cover.caption, /保持来源原貌/u);
  assert.match(cover.fingerprint || "", /^[a-f0-9]{64}$/u);
  const metadata = await sharp(await readFile(cover.localPath!)).metadata();
  assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 1600, height: 900 });
});

test("a live generated fallback is explicitly non-documentary and stays at priority five", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ai-news-generated-cover-"));
  context.after(() => rm(directory, { recursive: true, force: true }));

  const generated = await createGeneratedEditorialFallback({
    storyId: "story-no-image",
    storyTitle: "一种新的模型训练方法",
    sourceUrl: "https://example.com/research/story",
    assetDirectory: directory,
    publicDirectory: "/media/story",
  });

  assert.equal(generated.editorialPriority, 5);
  assert.equal(generated.editorialOrigin, "generated-fallback");
  assert.equal(generated.rights, "owned");
  assert.deepEqual(generated.allowedPlatforms, ["*"]);
  assert.match(generated.caption, /非事件现场/u);
  assert.match(generated.evidenceNote || "", /不包含合成人脸|不冒充新闻现场/u);
  const metadata = await sharp(generated.localPath!).metadata();
  assert.deepEqual({ width: metadata.width, height: metadata.height }, { width: 1600, height: 900 });
});
